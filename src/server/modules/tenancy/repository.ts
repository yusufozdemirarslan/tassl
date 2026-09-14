// Repository of the `tenancy` module (docs/tech/10-backend-spec-modules.md §2): institution
// settings and data agreements (DATA-005, DATA-052). Organizations, members, and invitations are
// Better Auth's; the service reaches them through `auth.api`. Query bodies only.
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  dataAgreements,
  institutionSettings,
  invitation,
  member,
  organization,
  session,
  user,
  type BandMapping,
  type DataAgreement,
  type InstitutionSettings,
  type NewDataAgreement,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

// The service may not import `@/server/db` (04 §2), so the row types it hands out, the platform
// default mapping, and the transaction boundary it opens are re-exported by the layer that owns
// database access.
export type { BandMapping, DataAgreement, InstitutionSettings } from '@/server/db/schema'
export { DEFAULT_BAND_MAPPING } from '@/server/db/schema'
export type { DbOrTx, Tx } from '@/server/db/tx'
export { withTransaction } from '@/server/db/tx'

export type OrganizationRow = { id: string; name: string; slug: string }

/** Fields of institution settings the admin may change; omitted fields keep their value. */
export type SettingsPatch = {
  plan?: InstitutionSettings['plan'] | undefined
  defaultMapping?: BandMapping | undefined
}

/** An agreement as the service hands it in; `id` set = update that row, absent = insert. */
export type AgreementInput = Omit<
  NewDataAgreement,
  'organizationId' | 'createdAt' | 'updatedAt' | 'deletedAt'
>

function one<T>(rows: readonly T[]): T {
  const row = rows[0]
  if (row === undefined) throw new AppError('INTERNAL_ERROR', 'The statement returned no row.')
  return row
}

// ---------------------------------------------------------------------------------------------
// Organizations, members, users
//
// Better Auth owns these three tables and the service writes them through `auth.api`. What is left
// for the repository is the reading the API does not offer (a membership list, an organization row
// by id), and the one invitation write the plugin cannot make: an invitation from the Platform Admin,
// who needs no `member` row to act in an institution (D-748) and so has none for the plugin to find.
// ---------------------------------------------------------------------------------------------

/** The institutions the user has a `member` row in; ordered by name for a stable switcher. */
export async function listMembershipsByUser(
  userId: string,
  dbx: DbOrTx = db,
): Promise<OrganizationRow[]> {
  return dbx
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(organization.name, organization.id)
}

/**
 * Every institution on the platform, by name: the Platform Admin's institution list (D-748). Not
 * tenant-scoped, because it is the list of tenants itself.
 */
export async function listOrganizations(dbx: DbOrTx = db): Promise<OrganizationRow[]> {
  return dbx
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .orderBy(organization.name, organization.id)
}

export async function findOrganization(
  tenantId: string,
  dbx: DbOrTx = db,
): Promise<OrganizationRow | null> {
  const rows = await dbx
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, tenantId))
    .limit(1)
  return rows[0] ?? null
}

/** True when the user has a `member` row in the institution. */
export async function hasMember(
  tenantId: string,
  userId: string,
  dbx: DbOrTx = db,
): Promise<boolean> {
  const rows = await dbx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, tenantId), eq(member.userId, userId)))
    .limit(1)
  return rows.length > 0
}

/**
 * Points one session of `userId` at an institution: the plugin's `setActiveOrganization` write, for
 * the admin it refuses for holding no `member` row (D-748). Keyed by the session and its owner, so a
 * session id alone cannot move somebody else's session. Null when no such session exists.
 */
export async function setSessionActiveOrganization(
  sessionId: string,
  userId: string,
  tenantId: string,
  dbx: DbOrTx = db,
): Promise<string | null> {
  const rows = await dbx
    .update(session)
    .set({ activeOrganizationId: tenantId, updatedAt: new Date() })
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .returning({ id: session.id })
  return rows[0]?.id ?? null
}

/** True when an account with this address, matched case-insensitively, is a member. */
export async function hasMemberWithEmail(
  tenantId: string,
  email: string,
  dbx: DbOrTx = db,
): Promise<boolean> {
  const rows = await dbx
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, tenantId), sql`lower(${user.email}) = lower(${email})`))
    .limit(1)
  return rows.length > 0
}

/**
 * The user ids of an institution's members whose platform role is one of `roles` (D-748), for a
 * fan-out that has already established its own permission. It reads no personal data — ids only —
 * so a caller that must not see the roster still cannot.
 */
export async function listMemberIdsWithPlatformRoles(
  tenantId: string,
  roles: readonly string[],
  dbx: DbOrTx = db,
): Promise<string[]> {
  if (roles.length === 0) return []
  const rows = await dbx
    .select({ userId: member.userId })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, tenantId),
        inArray(user.platform_role, [...roles]),
        isNull(user.deleted_at),
      ),
    )
  return rows.map((row) => row.userId)
}

/**
 * The id of the account holding `email`, case-insensitively. Not tenant-scoped on purpose: the
 * first member of a new institution is resolved before the institution — and therefore the tenant
 * — exists (10 §2 `createInstitution`).
 */
export async function findUserIdByEmail(email: string, dbx: DbOrTx = db): Promise<string | null> {
  const rows = await dbx
    .select({ id: user.id })
    .from(user)
    .where(and(sql`lower(${user.email}) = lower(${email})`, isNull(user.deleted_at)))
    .limit(1)
  return rows[0]?.id ?? null
}

/** One invitation with the institution it is for; the accept screen reads it (UI-005). */
export type InvitationRow = {
  id: string
  organizationId: string
  organizationName: string
  email: string
  status: string
  expiresAt: Date
}

/**
 * The invitation named by its own id. Deliberately not tenant-scoped: the recipient is not a member
 * of the institution yet, so there is no tenant to scope by — the address on the row is the guard,
 * and the service refuses anyone else (08 §2.5).
 */
export async function findInvitation(
  invitationId: string,
  dbx: DbOrTx = db,
): Promise<InvitationRow | null> {
  const rows = await dbx
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      organizationName: organization.name,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .where(eq(invitation.id, invitationId))
    .limit(1)
  return rows[0] ?? null
}

/** An invitation of one institution, without the join the accept screen needs (UI-031). */
export type OrganizationInvitationRow = {
  id: string
  email: string
  status: string
  expiresAt: Date
}

/**
 * The institution's outstanding invitations, newest expiry first — every row Better Auth still
 * holds as `pending`, whether or not its seven days have run out (08 §2.5). The expiry is left on
 * the row rather than filtered here: UI-031 renders pending and expired in one list, and the
 * service is where a date becomes a state. Accepted, rejected, and cancelled rows are history and
 * are not read back. The `invitation_organizationId_idx` index carries the scope.
 *
 * `limit` is a ceiling, not a page: the screen shows the institution's open invitations and a
 * roster screen has no cursor for them, so the query is bounded rather than paged.
 */
export async function listInvitations(
  tenantId: string,
  limit: number,
  dbx: DbOrTx = db,
): Promise<OrganizationInvitationRow[]> {
  return dbx
    .select({
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .where(and(eq(invitation.organizationId, tenantId), eq(invitation.status, 'pending')))
    .orderBy(desc(invitation.expiresAt), desc(invitation.id))
    .limit(limit)
}

/**
 * The pending invitation to `email` whose seven days have not run out, read the way the plugin's own
 * `findPendingInvitation` reads it (lower-cased address, `pending`, expiry in the future).
 */
export async function findPendingInvitation(
  tenantId: string,
  email: string,
  dbx: DbOrTx = db,
): Promise<OrganizationInvitationRow | null> {
  const rows = await dbx
    .select({
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, tenantId),
        eq(invitation.email, email.toLowerCase()),
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(invitation.expiresAt), desc(invitation.id))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Writes an invitation row as the organization plugin writes one (D-748): used only for the Platform
 * Admin, who acts without a `member` row and so cannot pass the plugin's inviter check. `role` is the
 * plugin's single membership role, which the table's check constraint pins.
 */
export async function insertInvitation(
  tenantId: string,
  values: { email: string; role: string; inviterId: string; expiresAt: Date },
  dbx: DbOrTx = db,
): Promise<OrganizationInvitationRow> {
  const rows = await dbx
    .insert(invitation)
    .values({
      id: crypto.randomUUID(),
      organizationId: tenantId,
      email: values.email.toLowerCase(),
      role: values.role,
      status: 'pending',
      expiresAt: values.expiresAt,
      inviterId: values.inviterId,
    })
    .returning({
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    })
  return one(rows)
}

/** Moves a pending invitation's expiry, the plugin's `resend` behaviour; null when none matched. */
export async function extendInvitation(
  tenantId: string,
  invitationId: string,
  expiresAt: Date,
  dbx: DbOrTx = db,
): Promise<OrganizationInvitationRow | null> {
  const rows = await dbx
    .update(invitation)
    .set({ expiresAt })
    .where(
      and(
        eq(invitation.organizationId, tenantId),
        eq(invitation.id, invitationId),
        eq(invitation.status, 'pending'),
      ),
    )
    .returning({
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    })
  return rows[0] ?? null
}

export async function findSettings(
  tenantId: string,
  dbx: DbOrTx = db,
): Promise<InstitutionSettings | null> {
  const rows = await dbx
    .select()
    .from(institutionSettings)
    .where(eq(institutionSettings.organizationId, tenantId))
    .limit(1)
  return rows[0] ?? null
}

/** Creates the settings row with the platform defaults, or applies the patch to the existing row. */
export async function upsertSettings(
  tenantId: string,
  patch: SettingsPatch,
  dbx: DbOrTx = db,
): Promise<InstitutionSettings> {
  const rows = await dbx
    .insert(institutionSettings)
    .values({ organizationId: tenantId, plan: patch.plan, defaultMapping: patch.defaultMapping })
    .onConflictDoUpdate({
      target: institutionSettings.organizationId,
      set: { plan: patch.plan, defaultMapping: patch.defaultMapping, updatedAt: sql`now()` },
    })
    .returning()
  return one(rows)
}

/** The most recently signed agreement that is neither deleted nor ended (D-055). */
export async function findActiveAgreement(
  tenantId: string,
  dbx: DbOrTx = db,
): Promise<DataAgreement | null> {
  const rows = await dbx
    .select()
    .from(dataAgreements)
    .where(
      and(
        eq(dataAgreements.organizationId, tenantId),
        isNull(dataAgreements.deletedAt),
        or(isNull(dataAgreements.endsAt), gt(dataAgreements.endsAt, sql`now()`)),
      ),
    )
    .orderBy(desc(dataAgreements.signedAt), desc(dataAgreements.createdAt), desc(dataAgreements.id))
    .limit(1)
  return rows[0] ?? null
}

/**
 * One live agreement of this institution. `PATCH /agreements/{agreementId}` names the agreement
 * without its institution, so the service supplies the tenant from the session's active
 * organization (D-006 keeps every read here tenant-scoped) and an agreement belonging to another
 * institution simply is not found.
 */
export async function findAgreement(
  tenantId: string,
  agreementId: string,
  dbx: DbOrTx = db,
): Promise<DataAgreement | null> {
  const rows = await dbx
    .select()
    .from(dataAgreements)
    .where(
      and(
        eq(dataAgreements.id, agreementId),
        eq(dataAgreements.organizationId, tenantId),
        isNull(dataAgreements.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function listAgreements(tenantId: string, dbx: DbOrTx = db): Promise<DataAgreement[]> {
  return dbx
    .select()
    .from(dataAgreements)
    .where(and(eq(dataAgreements.organizationId, tenantId), isNull(dataAgreements.deletedAt)))
    .orderBy(desc(dataAgreements.createdAt), desc(dataAgreements.id))
}

/**
 * Inserts the agreement, or updates the row named by `input.id` when it belongs to the tenant and
 * is not deleted. Null means the id exists but is not this tenant's live agreement.
 */
export async function upsertAgreement(
  tenantId: string,
  input: AgreementInput,
  dbx: DbOrTx = db,
): Promise<DataAgreement | null> {
  const rows = await dbx
    .insert(dataAgreements)
    .values({ ...input, organizationId: tenantId })
    .onConflictDoUpdate({
      target: dataAgreements.id,
      set: {
        counterparty: input.counterparty,
        permittedPlatformRoles: input.permittedPlatformRoles,
        purposes: input.purposes,
        recordTypesCovered: input.recordTypesCovered,
        recordTypesExcluded: input.recordTypesExcluded,
        retentionDays: input.retentionDays,
        documentReference: input.documentReference,
        signedAt: input.signedAt,
        endsAt: input.endsAt,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${dataAgreements.organizationId} = ${tenantId} and ${dataAgreements.deletedAt} is null`,
    })
    .returning()
  return rows[0] ?? null
}

export async function softDeleteAgreement(
  tenantId: string,
  id: string,
  dbx: DbOrTx = db,
): Promise<DataAgreement | null> {
  const rows = await dbx
    .update(dataAgreements)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(dataAgreements.id, id),
        eq(dataAgreements.organizationId, tenantId),
        isNull(dataAgreements.deletedAt),
      ),
    )
    .returning()
  return rows[0] ?? null
}
