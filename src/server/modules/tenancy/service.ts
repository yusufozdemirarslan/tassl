// Service of the `tenancy` module (docs/tech/10-backend-spec-modules.md §2; 07-api-spec.md §4;
// 08-auth-authz.md §4). Institutions, memberships, invitations, institution settings, and data
// agreements (D-006, D-055, FR-234, SYS-005).
//
// Three rules shape every function here:
//
//   1. The actor comes first and its permission helper is the first statement (08 §5). Where the
//      resource is addressed by an id that names its tenant (an organization id, an agreement id),
//      the id is resolved first — that lookup is what tells the guard which tenant to check.
//   2. An institution the actor cannot see answers NOT_FOUND, never FORBIDDEN, so an id cannot be
//      probed for existence (07 §1 "Tenancy", 08 §4 "Cross-tenant"). FORBIDDEN is reserved for a
//      member who holds the wrong role — they already know the institution exists.
//   3. Organizations, members, and invitations are Better Auth's tables. Every write to them goes
//      through `auth.api.*` behind `callAuth`, which is also where the invitation email is sent
//      (the organization plugin's `sendInvitationEmail`, configured in src/server/auth/auth.ts) —
//      so `inviteMember` must not send a second copy.
import { AppError, isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { track } from '@/server/analytics/track'
import type { OrganizationRole } from '@/server/auth/access-control-shared'
import { auth } from '@/server/auth/auth'
import {
  canReadIdentifiedRecords as canReadIdentifiedRecordsGuard,
  requireMembership as requireMembershipGuard,
  requirePlatformRole,
} from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
import { audit } from '@/server/modules/admin'
import { callAuth } from './errors'
import * as repo from './repository'
import {
  OrganizationRoleSchema,
  type CreateInstitutionInput,
  type DataAgreementInput,
  type DataAgreementView,
  type Institution,
  type InstitutionView,
  type InvitationDetail,
  type InvitationView,
  type Mapping,
  type Membership,
  type MyInstitution,
  type OrganizationRoleValue,
  type UpdateDataAgreementInput,
  type UpdateInstitutionSettingsInput,
} from './schema'

/** Organization roles that may invite (08 §4 "Manage section roster; invite members"). */
const INVITE_ROLES: readonly OrganizationRole[] = ['instructor', 'program_lead']

/** Organization roles that may change institution settings and data agreements (07 §4). */
const INSTITUTION_ADMIN_ROLES: readonly OrganizationRole[] = ['program_lead']

// ---------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------

/** Membership in the institution, with a non-member answered NOT_FOUND rather than FORBIDDEN. */
async function requireVisibleMembership(
  actor: SessionUser,
  orgId: string,
): Promise<OrganizationRole> {
  try {
    return await requireMembershipGuard(actor, orgId)
  } catch (error) {
    if (isAppError(error) && error.code === 'FORBIDDEN') throw new AppError('NOT_FOUND')
    throw error
  }
}

/** The institution row, or NOT_FOUND. Used where the platform admin acts without a membership. */
async function requireOrganization(orgId: string): Promise<repo.OrganizationRow> {
  const org = await repo.findOrganization(orgId)
  if (!org) throw new AppError('NOT_FOUND')
  return org
}

/**
 * One of `roles` in the institution — or the platform admin, where 08 §4 gives the admin the
 * operation (institution settings and data agreements; never invitations, which are the
 * institution's own).
 */
async function requireOrgRole(
  actor: SessionUser,
  orgId: string,
  roles: readonly OrganizationRole[],
  options: { platformAdmin?: boolean } = {},
): Promise<void> {
  if (options.platformAdmin === true && actor.platformRole === 'admin') {
    await requireOrganization(orgId)
    return
  }
  const role = await requireVisibleMembership(actor, orgId)
  if (!roles.includes(role)) throw new AppError('FORBIDDEN')
}

/**
 * Reading agreements: the program lead, the platform admin, and a platform editor for the
 * institutions they hold a membership in ("own org rows", 08 §4, FR-234).
 */
async function requireAgreementReader(actor: SessionUser, orgId: string): Promise<void> {
  if (actor.platformRole === 'admin') {
    await requireOrganization(orgId)
    return
  }
  const role = await requireVisibleMembership(actor, orgId)
  if (role === 'program_lead') return
  if (actor.platformRole === 'tassl_scenario_editor') return
  throw new AppError('FORBIDDEN')
}

// ---------------------------------------------------------------------------------------------
// Business rules that carry their own error code
// ---------------------------------------------------------------------------------------------

/** A band mapping is four positive, finite numbers (07 §4 `MAPPING_INVALID`). */
function assertMapping(mapping: Mapping | undefined): void {
  if (!mapping) return
  const values = [mapping.novice, mapping.developing, mapping.proficient, mapping.professional]
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new AppError('MAPPING_INVALID')
  }
}

/** An agreement admits at least one purpose (07 §4 `AGREEMENT_PURPOSES_INVALID`, D-055). */
function assertPurposes(purposes: readonly string[]): void {
  if (purposes.length === 0) throw new AppError('AGREEMENT_PURPOSES_INVALID')
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

const iso = (value: Date | string): string => new Date(value).toISOString()

const toInstitution = (org: repo.OrganizationRow): Institution => ({
  id: org.id,
  name: org.name,
  slug: org.slug,
})

/**
 * An institution without a settings row reads as the platform defaults rather than writing one:
 * a GET never creates a row, and `updateInstitutionSettings` inserts it on the first change.
 */
function toInstitutionView(
  org: repo.OrganizationRow,
  settings: repo.InstitutionSettings | null,
): InstitutionView {
  return {
    ...toInstitution(org),
    settings: {
      plan: settings?.plan ?? 'pilot',
      defaultMapping: settings?.defaultMapping ?? repo.DEFAULT_BAND_MAPPING,
    },
  }
}

const toAgreement = (row: repo.DataAgreement): DataAgreementView => ({
  id: row.id,
  organizationId: row.organizationId,
  counterparty: row.counterparty,
  permittedPlatformRoles: row.permittedPlatformRoles,
  purposes: row.purposes,
  recordTypesCovered: row.recordTypesCovered,
  recordTypesExcluded: row.recordTypesExcluded,
  retentionDays: row.retentionDays,
  documentReference: row.documentReference,
  signedAt: iso(row.signedAt),
  endsAt: row.endsAt === null ? null : iso(row.endsAt),
})

// ---------------------------------------------------------------------------------------------
// Institutions and membership
// ---------------------------------------------------------------------------------------------

/**
 * The institutions the actor belongs to, with the role held in each (10 §2). No permission helper:
 * the actor is the scope, and the query is keyed by their own id.
 */
export async function listMyInstitutions(actor: SessionUser): Promise<MyInstitution[]> {
  const rows = await repo.listMembershipsByUser(actor.id)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: row.role as OrganizationRoleValue,
  }))
}

/** Points the session's `active_organization_id` at an institution the actor belongs to (10 §2). */
export async function setActiveInstitution(
  actor: SessionUser,
  orgId: string,
  headers: Headers,
): Promise<MyInstitution> {
  const role = await requireVisibleMembership(actor, orgId)
  await callAuth(() => auth.api.setActiveOrganization({ body: { organizationId: orgId }, headers }))
  const org = await requireOrganization(orgId)
  return { ...toInstitution(org), role: role as OrganizationRoleValue }
}

/** The tenancy module's name for the membership guard (08 §5); the check itself lives there. */
export async function requireMembership(
  actor: SessionUser,
  orgId: string,
  roles?: readonly OrganizationRole[],
): Promise<OrganizationRole> {
  return requireMembershipGuard(actor, orgId, roles)
}

/** D-055 / FR-234; the check itself lives in src/server/auth/permissions.ts. */
export async function canReadIdentifiedRecords(
  actor: SessionUser,
  orgId: string,
): Promise<boolean> {
  return canReadIdentifiedRecordsGuard(actor, orgId)
}

/**
 * Creates an institution (admin only, 08 §4). Better Auth creates the organization and stamps its
 * creator as a member; 08 §3 does not use the built-in `owner` role for people, so the creator is
 * the program lead and their role is set to `program_lead` in the same transaction as the settings
 * row. The program lead must already have an account — an institution with no one to lead it is
 * not a state this build has a screen for.
 */
export async function createInstitution(
  actor: SessionUser,
  input: CreateInstitutionInput,
): Promise<Institution> {
  requirePlatformRole(actor, 'admin')

  const programLeadId = await repo.findUserIdByEmail(input.programLeadEmail)
  if (!programLeadId) {
    throw new AppError(
      'NOT_FOUND',
      t('tenancy.programLeadNotFound', { email: input.programLeadEmail }),
    )
  }

  // No `headers`: this is a server-side creation on behalf of the program lead, so Better Auth
  // takes the `userId` path and the admin's own session is left untouched (no active organization
  // switch, no membership in an institution they do not belong to).
  const organization = await callAuth(() =>
    auth.api.createOrganization({
      body: { name: input.name, slug: input.slug, userId: programLeadId },
    }),
  )
  if (!organization) throw new AppError('CONFLICT', t('tenancy.slugTaken'))

  await repo.withTransaction(async (tx) => {
    await repo.updateMemberRole(organization.id, programLeadId, 'program_lead', tx)
    await repo.upsertSettings(organization.id, {}, tx)
  })

  return { id: organization.id, name: organization.name, slug: organization.slug }
}

// ---------------------------------------------------------------------------------------------
// Invitations (SYS-005)
// ---------------------------------------------------------------------------------------------

/**
 * Invites one email to the institution. The organization plugin writes the `invitation` row, sets
 * the seven-day expiry (08 §2.5), and sends the invitation email through `sendEmail`; this
 * function adds the permission check and the audit row and sends nothing itself.
 */
export async function inviteMember(
  actor: SessionUser,
  orgId: string,
  input: { email: string; role: OrganizationRoleValue },
  headers: Headers,
): Promise<InvitationView> {
  await requireOrgRole(actor, orgId, INVITE_ROLES)

  const invitation = await callAuth(() =>
    auth.api.createInvitation({
      body: { email: input.email, role: input.role, organizationId: orgId, resend: true },
      headers,
    }),
  )

  await repo.withTransaction((tx) =>
    audit(tx, {
      actorId: actor.id,
      orgId,
      action: 'invitation.create',
      targetType: 'invitation',
      targetId: invitation.id,
      // The invited address is on the row itself; audit metadata carries no email (10 §3 redaction).
      metadata: { role: input.role },
    }),
  )

  return {
    id: invitation.id,
    organizationId: orgId,
    email: invitation.email,
    role: input.role,
    status: invitation.status,
    expiresAt: iso(invitation.expiresAt),
  }
}

/** Invitations live seven days (08 §2.5, `invitationExpiresIn` in auth.ts). */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The invitation the accept screen renders (UI-005), read the way Better Auth's own
 * `get-invitation` reads it, with the same two refusals so the screen can tell them apart:
 *
 *   - missing, already spent, or past its expiry → NOT_FOUND (the screen's "expired" state);
 *   - addressed to another email → INVITATION_EMAIL_MISMATCH (the screen's "wrong account" state).
 *
 * The mismatch refusal carries nothing about the invitation, so a signed-in stranger holding the
 * link learns neither the institution nor the invited address.
 */
export async function getInvitation(
  actor: SessionUser,
  invitationId: string,
): Promise<InvitationDetail> {
  const row = await repo.findInvitation(invitationId)
  if (!row || row.status !== 'pending' || row.expiresAt.getTime() <= Date.now()) {
    throw new AppError('NOT_FOUND', t('tenancy.invitationNotFound'))
  }
  if (row.email.toLowerCase() !== actor.email.toLowerCase()) {
    throw new AppError('INVITATION_EMAIL_MISMATCH')
  }
  // Better Auth's `invitation.role` is a free-text column; a role outside 08 §3 reads as the
  // least-privileged seat rather than failing the screen (the accept itself keeps the stored role).
  const role = OrganizationRoleSchema.safeParse(row.role)
  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    email: row.email,
    role: role.success ? role.data : 'student',
    status: row.status,
    expiresAt: iso(row.expiresAt),
  }
}

/**
 * Accepts an invitation addressed to the actor's own email (10 §2). Better Auth compares the
 * addresses; a mismatch is `INVITATION_EMAIL_MISMATCH` and an expired or spent invitation is
 * NOT_FOUND (`./errors.ts` maps both).
 */
export async function acceptInvitation(
  actor: SessionUser,
  invitationId: string,
  headers: Headers,
): Promise<Membership> {
  const accepted = await callAuth(() =>
    auth.api.acceptInvitation({ body: { invitationId }, headers }),
  )
  const membership = accepted?.member
  if (!membership) throw new AppError('NOT_FOUND', t('tenancy.invitationNotFound'))

  const org = await requireOrganization(membership.organizationId)
  const role = membership.role as OrganizationRoleValue
  // AN-002 (17 §5.2): fired after the membership row exists, never before.
  const invitedAt = accepted.invitation?.expiresAt
  track(
    'invitation_accepted',
    {
      invitation_id: invitationId,
      role,
      // The invitation carries only its expiry; the age is measured back from it (7 days, 08 §2.5).
      ms_since_invited: invitedAt
        ? Math.max(0, INVITATION_TTL_MS - (new Date(invitedAt).getTime() - Date.now()))
        : 0,
    },
    { userId: actor.id, organizationId: org.id },
  )
  return { organizationId: org.id, name: org.name, role }
}

// ---------------------------------------------------------------------------------------------
// Institution settings
// ---------------------------------------------------------------------------------------------

/** The institution with its settings; any member may read them (07 §4). */
export async function getInstitutionSettings(
  actor: SessionUser,
  orgId: string,
): Promise<InstitutionView> {
  await requireVisibleMembership(actor, orgId)
  const org = await requireOrganization(orgId)
  return toInstitutionView(org, await repo.findSettings(orgId))
}

/** Plan label and default band mapping; program lead or platform admin (07 §4). */
export async function updateInstitutionSettings(
  actor: SessionUser,
  orgId: string,
  input: UpdateInstitutionSettingsInput,
): Promise<InstitutionView> {
  await requireOrgRole(actor, orgId, INSTITUTION_ADMIN_ROLES, { platformAdmin: true })
  assertMapping(input.defaultMapping)

  const org = await requireOrganization(orgId)
  const settings = await repo.upsertSettings(orgId, {
    plan: input.plan,
    defaultMapping: input.defaultMapping,
  })
  return toInstitutionView(org, settings)
}

// ---------------------------------------------------------------------------------------------
// Data agreements (DATA-052, FR-234)
// ---------------------------------------------------------------------------------------------

export async function listDataAgreements(
  actor: SessionUser,
  orgId: string,
): Promise<DataAgreementView[]> {
  await requireAgreementReader(actor, orgId)
  const rows = await repo.listAgreements(orgId)
  return rows.map(toAgreement)
}

/**
 * Writes an agreement: a new row, or the row named by `input.id` when it belongs to `orgId`. The
 * audit row is appended in the same transaction as the change (08 §5).
 */
export async function upsertDataAgreement(
  actor: SessionUser,
  orgId: string,
  input: DataAgreementInput & { id?: string | undefined },
): Promise<DataAgreementView> {
  await requireOrgRole(actor, orgId, INSTITUTION_ADMIN_ROLES, { platformAdmin: true })
  assertPurposes(input.purposes)

  const values: repo.AgreementInput = {
    ...(input.id === undefined ? {} : { id: input.id }),
    counterparty: input.counterparty,
    permittedPlatformRoles: [...input.permittedPlatformRoles],
    purposes: [...input.purposes],
    ...(input.recordTypesCovered === undefined
      ? {}
      : { recordTypesCovered: input.recordTypesCovered }),
    ...(input.recordTypesExcluded === undefined
      ? {}
      : { recordTypesExcluded: input.recordTypesExcluded }),
    retentionDays: input.retentionDays,
    documentReference: input.documentReference,
    signedAt: input.signedAt,
    endsAt: input.endsAt ?? null,
  }

  return repo.withTransaction(async (tx) => {
    const row = await repo.upsertAgreement(orgId, values, tx)
    if (!row) throw new AppError('NOT_FOUND')
    await audit(tx, {
      actorId: actor.id,
      orgId,
      action: 'agreement.upsert',
      targetType: 'data_agreement',
      targetId: row.id,
      metadata: {
        purposes: row.purposes,
        permittedPlatformRoles: row.permittedPlatformRoles,
        retentionDays: row.retentionDays,
        endsAt: row.endsAt === null ? null : iso(row.endsAt),
      },
    })
    return toAgreement(row)
  })
}

/**
 * `PATCH /agreements/{agreementId}`: the agreement is addressed without its institution, so the
 * tenant comes from the session's active organization — every repository read stays tenant-scoped
 * (D-006), and an agreement belonging to another institution is NOT_FOUND rather than FORBIDDEN.
 * Callers set the active institution the way the shell does, through `setActiveInstitution`.
 *
 * The patch is merged onto the stored row, so a partial write cannot blank a field.
 */
export async function updateDataAgreement(
  actor: SessionUser,
  agreementId: string,
  patch: UpdateDataAgreementInput,
): Promise<DataAgreementView> {
  const orgId = actor.activeOrganizationId
  if (!orgId) throw new AppError('NOT_FOUND')
  await requireOrgRole(actor, orgId, INSTITUTION_ADMIN_ROLES, { platformAdmin: true })

  const existing = await repo.findAgreement(orgId, agreementId)
  if (!existing) throw new AppError('NOT_FOUND')

  const merged: DataAgreementInput & { id: string } = {
    id: existing.id,
    counterparty: patch.counterparty ?? existing.counterparty,
    permittedPlatformRoles:
      patch.permittedPlatformRoles ??
      (existing.permittedPlatformRoles as DataAgreementInput['permittedPlatformRoles']),
    purposes: patch.purposes ?? existing.purposes,
    recordTypesCovered: patch.recordTypesCovered ?? existing.recordTypesCovered,
    recordTypesExcluded: patch.recordTypesExcluded ?? existing.recordTypesExcluded,
    retentionDays: patch.retentionDays ?? existing.retentionDays,
    documentReference: patch.documentReference ?? existing.documentReference,
    signedAt: patch.signedAt ?? existing.signedAt,
    endsAt: 'endsAt' in patch ? (patch.endsAt ?? null) : existing.endsAt,
  }
  return upsertDataAgreement(actor, existing.organizationId, merged)
}
