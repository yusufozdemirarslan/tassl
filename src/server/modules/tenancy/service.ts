// Service of the `tenancy` module (docs/tech/10-backend-spec-modules.md §2; 07-api-spec.md §4;
// 08-auth-authz.md §4). Institutions, memberships, invitations, institution settings, and data
// agreements (D-006, D-055, SYS-005).
//
// Four rules shape every function here:
//
//   1. The actor comes first and its permission helper is the first statement (08 §5). Where the
//      resource is addressed by an id that names its tenant (an organization id, an agreement id),
//      the id is resolved first — that lookup is what tells the guard which tenant to check.
//   2. An institution the actor cannot see answers NOT_FOUND, never FORBIDDEN, so an id cannot be
//      probed for existence (07 §1 "Tenancy", 08 §4 "Cross-tenant"). FORBIDDEN is reserved for a
//      member whose platform role does not allow the act — they already know the institution exists.
//   3. A membership is membership (D-748): nothing here reads or writes an institution role. Who may
//      invite is an Instructor of the institution; settings and agreements are the Platform Admin's,
//      who acts in every institution without a `member` row.
//   4. Organizations, members, and invitations are Better Auth's tables. Writes go through
//      `auth.api.*` behind `callAuth`, which is also where the invitation email is sent (the
//      organization plugin's `sendInvitationEmail`, src/server/auth/auth.ts) — so the plugin path of
//      `inviteMember` sends no second copy. The two exceptions are the admin acting without a
//      `member` row, which the plugin refuses by construction: their invitation row and their active
//      institution are written through the repository, and the same email is sent here.
import { AppError, isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { track } from '@/server/analytics/track'
import { MEMBERSHIP_ROLE } from '@/server/auth/access-control-shared'
import { auth } from '@/server/auth/auth'
import {
  hasRole,
  isPlatformAdmin,
  requireMembership as requireMembershipGuard,
  requirePlatformRole,
  TEACHING_ROLES,
} from '@/server/auth/permissions'
import type { PlatformRole, SessionUser } from '@/server/auth/types'
import { env } from '@/server/config'
import { sendEmail } from '@/server/email/send'
import { audit } from '@/server/modules/admin'
import { callAuth } from './errors'
import * as repo from './repository'
import type {
  CreateInstitutionInput,
  DataAgreementInput,
  DataAgreementView,
  Institution,
  InstitutionView,
  InvitationDetail,
  InvitationView,
  InviteMemberInput,
  Mapping,
  Membership,
  MyInstitution,
  UpdateDataAgreementInput,
  UpdateInstitutionSettingsInput,
} from './schema'

// ---------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------

/**
 * Membership in the institution — the admin belongs everywhere — with a non-member answered
 * NOT_FOUND rather than FORBIDDEN (rule 2). When `roles` is given, a member whose platform role is
 * not one of them is FORBIDDEN; the admin always passes.
 */
async function requireVisibleMembership(
  actor: SessionUser,
  orgId: string,
  roles?: readonly PlatformRole[],
): Promise<PlatformRole> {
  try {
    await requireMembershipGuard(actor, orgId)
  } catch (error) {
    if (isAppError(error) && error.code === 'FORBIDDEN') throw new AppError('NOT_FOUND')
    throw error
  }
  if (roles && !hasRole(actor, roles)) throw new AppError('FORBIDDEN')
  return actor.platformRole
}

/** Settings and data agreements: the Platform Admin only (D-748); members are refused, others 404. */
async function requireInstitutionAdmin(actor: SessionUser, orgId: string): Promise<void> {
  await requireVisibleMembership(actor, orgId, [])
}

/** The institution row, or NOT_FOUND. */
async function requireOrganization(orgId: string): Promise<repo.OrganizationRow> {
  const org = await repo.findOrganization(orgId)
  if (!org) throw new AppError('NOT_FOUND')
  return org
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
 * The institutions the actor belongs to (10 §2); for the Platform Admin, who has full access in
 * every one, all of them (D-748). No permission helper: the actor is the scope.
 */
export async function listMyInstitutions(actor: SessionUser): Promise<MyInstitution[]> {
  const rows = isPlatformAdmin(actor)
    ? await repo.listOrganizations()
    : await repo.listMembershipsByUser(actor.id)
  return rows.map(toInstitution)
}

/**
 * Points the session's `active_organization_id` at an institution the actor belongs to (10 §2).
 * The plugin refuses anyone without a `member` row, so the admin acting without one has the session
 * row written through the repository instead (rule 4); every session read skips the cookie cache,
 * so the next request sees it.
 */
export async function setActiveInstitution(
  actor: SessionUser,
  orgId: string,
  headers: Headers,
): Promise<MyInstitution> {
  await requireVisibleMembership(actor, orgId)
  const org = await requireOrganization(orgId)
  if (isPlatformAdmin(actor) && !(await repo.hasMember(orgId, actor.id))) {
    const current = await callAuth(() =>
      auth.api.getSession({ headers, query: { disableCookieCache: true } }),
    )
    if (!current) throw new AppError('UNAUTHENTICATED')
    await repo.setSessionActiveOrganization(current.session.id, actor.id, orgId)
  } else {
    await callAuth(() =>
      auth.api.setActiveOrganization({ body: { organizationId: orgId }, headers }),
    )
  }
  return toInstitution(org)
}

/** The tenancy module's name for the membership guard (08 §5); the check itself lives there. */
export async function requireMembership(
  actor: SessionUser,
  orgId: string,
  roles?: readonly PlatformRole[],
): Promise<PlatformRole> {
  return requireMembershipGuard(actor, orgId, roles)
}

/**
 * Creates an institution (admin only, 08 §4). Better Auth creates the organization and stamps the
 * named account as its first member, with the plugin's one membership role (D-748); the settings
 * row is written beside it. That account must already exist — an institution with nobody in it is
 * not a state this build has a screen for.
 */
export async function createInstitution(
  actor: SessionUser,
  input: CreateInstitutionInput,
): Promise<Institution> {
  requirePlatformRole(actor, 'admin')

  const firstMemberId = await repo.findUserIdByEmail(input.programLeadEmail)
  if (!firstMemberId) {
    throw new AppError(
      'NOT_FOUND',
      t('tenancy.programLeadNotFound', { email: input.programLeadEmail }),
    )
  }

  // No `headers`: this is a server-side creation on behalf of the named account, so Better Auth
  // takes the `userId` path and the admin's own session is left untouched (no active organization
  // switch, no membership row the admin does not need).
  const organization = await callAuth(() =>
    auth.api.createOrganization({
      body: { name: input.name, slug: input.slug, userId: firstMemberId },
    }),
  )
  if (!organization) throw new AppError('CONFLICT', t('tenancy.slugTaken'))

  await repo.upsertSettings(organization.id, {})

  return { id: organization.id, name: organization.name, slug: organization.slug }
}

// ---------------------------------------------------------------------------------------------
// Invitations (SYS-005)
// ---------------------------------------------------------------------------------------------

/** Invitations live seven days (08 §2.5, `invitationExpiresIn` in auth.ts). */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Invites one email to the institution: an Instructor of it, or the Platform Admin (D-748). The
 * invitation makes the person a member and names no role — what they may do is the platform role on
 * their account.
 *
 * Through the plugin, which writes the `invitation` row, sets the seven-day expiry (08 §2.5), and
 * sends the email; this function adds the check and the audit row. The admin without a `member` row
 * cannot pass the plugin's inviter check, so for them the same row is written here — a pending
 * invitation to the address has its expiry renewed, as the plugin's `resend` does — and the same
 * `invitation` email is sent.
 */
export async function inviteMember(
  actor: SessionUser,
  orgId: string,
  input: InviteMemberInput,
  headers: Headers,
): Promise<InvitationView> {
  await requireVisibleMembership(actor, orgId, TEACHING_ROLES)

  const invitation =
    isPlatformAdmin(actor) && !(await repo.hasMember(orgId, actor.id))
      ? await inviteAsPlatformAdmin(actor, orgId, input.email)
      : await callAuth(() =>
          auth.api.createInvitation({
            body: {
              email: input.email,
              role: MEMBERSHIP_ROLE,
              organizationId: orgId,
              resend: true,
            },
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
    }),
  )

  return {
    id: invitation.id,
    organizationId: orgId,
    email: invitation.email,
    status: invitation.status,
    expiresAt: iso(invitation.expiresAt),
  }
}

/** The plugin's invitation, written for the admin who holds no `member` row (rule 4). */
async function inviteAsPlatformAdmin(
  actor: SessionUser,
  orgId: string,
  email: string,
): Promise<repo.OrganizationInvitationRow> {
  const org = await requireOrganization(orgId)
  if (await repo.hasMemberWithEmail(orgId, email)) {
    throw new AppError('CONFLICT', t('tenancy.alreadyMember'))
  }
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS)
  const invitation = await repo.withTransaction(async (tx) => {
    const pending = await repo.findPendingInvitation(orgId, email, tx)
    const row = pending
      ? await repo.extendInvitation(orgId, pending.id, expiresAt, tx)
      : await repo.insertInvitation(
          orgId,
          { email, role: MEMBERSHIP_ROLE, inviterId: actor.id, expiresAt },
          tx,
        )
    if (!row) throw new AppError('NOT_FOUND', t('tenancy.invitationNotFound'))
    return row
  })
  await sendEmail({
    to: invitation.email,
    template: 'invitation',
    props: {
      url: `${env.NEXT_PUBLIC_APP_URL}/invitations/${invitation.id}`,
      organizationName: org.name,
      inviterName: actor.name,
    },
  })
  return invitation
}

/**
 * How many outstanding invitations the roster reads. An institution with more open invitations
 * than this has a problem no roster screen solves, and the list is bounded rather than paged.
 */
const INVITATION_LIST_LIMIT = 200

/**
 * The institution's outstanding invitations (UI-031). Better Auth owns the `invitation` table and
 * offers no list of its own, so the rows are read through the repository the way every other
 * tenancy read is, and the seat that may create one is the seat that may see them: an Instructor of
 * the institution, or the admin.
 *
 * A stored row is `pending` until it is accepted, rejected, or cancelled; whether its seven days
 * have run out is a fact about the clock, not about the row, so the expiry is resolved here and
 * the view carries `expired`. Deciding it on the server is also what keeps a server render and its
 * hydration in agreement — the client is handed a state, never a deadline to compare against
 * `Date.now()` (D-177).
 */
export async function listInvitations(
  actor: SessionUser,
  orgId: string,
): Promise<InvitationView[]> {
  await requireVisibleMembership(actor, orgId, TEACHING_ROLES)
  const rows = await repo.listInvitations(orgId, INVITATION_LIST_LIMIT)
  const now = Date.now()
  return rows.map((row) => ({
    id: row.id,
    organizationId: orgId,
    email: row.email,
    status: row.expiresAt.getTime() <= now ? 'expired' : 'pending',
    expiresAt: iso(row.expiresAt),
  }))
}

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
  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    email: row.email,
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
  // AN-002 (17 §5.2): fired after the membership row exists, never before.
  const invitedAt = accepted.invitation?.expiresAt
  track(
    'invitation_accepted',
    {
      invitation_id: invitationId,
      // The invitation carries only its expiry; the age is measured back from it (7 days, 08 §2.5).
      ms_since_invited: invitedAt
        ? Math.max(0, INVITATION_TTL_MS - (new Date(invitedAt).getTime() - Date.now()))
        : 0,
    },
    { userId: actor.id, organizationId: org.id },
  )
  return { organizationId: org.id, name: org.name }
}

// ---------------------------------------------------------------------------------------------
// Institution settings
// ---------------------------------------------------------------------------------------------

/** The institution with its settings; any member, and the admin, may read them (07 §4). */
export async function getInstitutionSettings(
  actor: SessionUser,
  orgId: string,
): Promise<InstitutionView> {
  await requireVisibleMembership(actor, orgId)
  const org = await requireOrganization(orgId)
  return toInstitutionView(org, await repo.findSettings(orgId))
}

/** Plan label and default band mapping; the Platform Admin only (07 §4, D-748). */
export async function updateInstitutionSettings(
  actor: SessionUser,
  orgId: string,
  input: UpdateInstitutionSettingsInput,
): Promise<InstitutionView> {
  await requireInstitutionAdmin(actor, orgId)
  assertMapping(input.defaultMapping)

  const org = await requireOrganization(orgId)
  const settings = await repo.upsertSettings(orgId, {
    plan: input.plan,
    defaultMapping: input.defaultMapping,
  })
  return toInstitutionView(org, settings)
}

// ---------------------------------------------------------------------------------------------
// Data agreements (DATA-052): the Platform Admin's records of what an institution has signed
// ---------------------------------------------------------------------------------------------

export async function listDataAgreements(
  actor: SessionUser,
  orgId: string,
): Promise<DataAgreementView[]> {
  await requireInstitutionAdmin(actor, orgId)
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
  await requireInstitutionAdmin(actor, orgId)
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
  await requireInstitutionAdmin(actor, orgId)

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

/**
 * The user ids of an institution's members whose platform role is one of `roles` (D-748), for a
 * fan-out whose caller has already established its own permission — `confirmVersion` telling the
 * institution's instructors and editors a package is assignable (10 §4). Ids only: nothing here
 * reads a name, an address, or a role, so a caller that must not see the roster still cannot.
 */
export async function listMemberIdsWithPlatformRoles(
  orgId: string,
  roles: readonly PlatformRole[],
): Promise<string[]> {
  return repo.listMemberIdsWithPlatformRoles(orgId, roles)
}
