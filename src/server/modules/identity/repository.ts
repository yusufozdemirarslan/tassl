// Repository of the `identity` module (docs/tech/10-backend-spec-modules.md §1): the user row, its
// Better Auth satellites, and the purge job's re-pointing to the per-organization placeholder user
// `deleted-user@<slug>.tassl.local` (D-093). Query bodies only; the service owns the rules.
import { and, asc, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  account,
  auditLogs,
  courses,
  invitation,
  member,
  notifications,
  organization,
  runs,
  sectionMemberships,
  sections,
  session,
  user,
  verification,
  type AuditLog,
  type Notification,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert

/**
 * The transaction boundary of every writing service function (10-backend-spec.md §6). It is
 * re-exported here because the layering policy (`eslint.config.mjs`, 04 §2) lets only a module's
 * repository reach `src/server/db`: database access, the transaction included, enters a module
 * through this file.
 */
export { withTransaction } from '@/server/db/tx'
export type { DbOrTx, Tx } from '@/server/db/tx'

/** Cursor pagination (10-backend-spec.md §11, D-020), re-exported for the same reason. */
export { clampLimit, decodeCursor, encodeCursor, toPage } from '@/server/db/pagination'
export type { Page, PageInput } from '@/server/db/pagination'

/** Display name of the per-organization placeholder that deleted accounts are re-pointed to. */
export const PLACEHOLDER_USER_NAME = 'Deleted user'

/** Ceiling on the collections a data export carries, so one response cannot grow unbounded. */
export const EXPORT_ROW_LIMIT = 1000

export type RepointCounts = { runs: number; runEvents: number; auditLogs: number }
export type AnonymizeCounts = { auditLogs: number; llmCalls: number }

/** One organization the user belongs to, as `MeView.memberships` and the export list it. */
export type MembershipRow = {
  organizationId: string
  name: string
  slug: string
  role: string
  joinedAt: Date
}

/** One section the user is enrolled in or teaches, with the course it belongs to. */
export type SectionMembershipRow = {
  sectionId: string
  sectionName: string
  courseId: string
  courseName: string
  organizationId: string
  role: string
  joinedAt: Date
}

const placeholderEmail = (slug: string): string => `deleted-user@${slug}.tassl.local`

function one<T>(rows: readonly T[]): T {
  const row = rows[0]
  if (row === undefined) throw new AppError('INTERNAL_ERROR', 'The statement returned no row.')
  return row
}

/** postgres-js hands `db.execute` back as an array of rows; the SQL functions return exactly one. */
function firstRow<T>(result: unknown): T | undefined {
  return Array.isArray(result) ? (result[0] as T | undefined) : undefined
}

// ---------------------------------------------------------------------------------------------
// The user row
// ---------------------------------------------------------------------------------------------

export async function findUserById(id: string, dbx: DbOrTx = db): Promise<User | null> {
  const rows = await dbx.select().from(user).where(eq(user.id, id)).limit(1)
  return rows[0] ?? null
}

/** PATCH /me (SYS-003): the profile fields a person may edit. */
export async function updateProfile(
  id: string,
  values: { name: string },
  dbx: DbOrTx = db,
): Promise<User> {
  const rows = await dbx
    .update(user)
    .set({ name: values.name, updatedAt: new Date() })
    .where(eq(user.id, id))
    .returning()
  return one(rows)
}

/** DELETE /me: the soft delete; `deleted_at` is what signs the person out (08 §2.6, D-093). */
export async function softDeleteUser(
  id: string,
  deletedAt: Date,
  dbx: DbOrTx = db,
): Promise<User | null> {
  const rows = await dbx
    .update(user)
    .set({ deleted_at: deletedAt, updatedAt: new Date() })
    .where(and(eq(user.id, id), isNull(user.deleted_at)))
    .returning()
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------------------------
// Memberships, sessions, invitations
// ---------------------------------------------------------------------------------------------

/** The user's institutions with the role they hold, ordered by institution name. */
export async function listMembershipsForUser(
  userId: string,
  dbx: DbOrTx = db,
): Promise<MembershipRow[]> {
  return dbx
    .select({
      organizationId: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
      joinedAt: member.createdAt,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name), asc(organization.id))
}

/**
 * The person's enrolments inside one institution, newest first (export, SYS-004). Tenant-scoped
 * like every read of a **T** table (D-006): the export walks the institutions the person belongs to
 * and asks each one, rather than reading across them.
 */
export async function listSectionMembershipsForUser(
  tenantId: string,
  userId: string,
  dbx: DbOrTx = db,
): Promise<SectionMembershipRow[]> {
  return dbx
    .select({
      sectionId: sections.id,
      sectionName: sections.name,
      courseId: courses.id,
      courseName: courses.name,
      organizationId: sectionMemberships.organizationId,
      role: sectionMemberships.role,
      joinedAt: sectionMemberships.createdAt,
    })
    .from(sectionMemberships)
    .innerJoin(sections, eq(sections.id, sectionMemberships.sectionId))
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .where(
      and(eq(sectionMemberships.organizationId, tenantId), eq(sectionMemberships.userId, userId)),
    )
    .orderBy(desc(sectionMemberships.createdAt), desc(sectionMemberships.id))
    .limit(EXPORT_ROW_LIMIT)
}

/** Deletion removes the person from every institution (08 §2.9). */
export async function deleteMemberships(userId: string, dbx: DbOrTx = db): Promise<number> {
  const rows = await dbx
    .delete(member)
    .where(eq(member.userId, userId))
    .returning({ id: member.id })
  return rows.length
}

/** Deletion also drops the roster rows one institution keeps for the person (D-006, tenant-scoped). */
export async function deleteSectionMemberships(
  tenantId: string,
  userId: string,
  dbx: DbOrTx = db,
): Promise<number> {
  const rows = await dbx
    .delete(sectionMemberships)
    .where(
      and(eq(sectionMemberships.organizationId, tenantId), eq(sectionMemberships.userId, userId)),
    )
    .returning({ id: sectionMemberships.id })
  return rows.length
}

/** Invitations addressed to the deleted account that nobody accepted (08 §2.9). */
export async function deletePendingInvitations(email: string, dbx: DbOrTx = db): Promise<number> {
  const rows = await dbx
    .delete(invitation)
    .where(and(eq(invitation.email, email), eq(invitation.status, 'pending')))
    .returning({ id: invitation.id })
  return rows.length
}

/** Every session of the user; the sweep behind `auth.api.revokeSessions` (08 §2.9). */
export async function deleteSessions(userId: string, dbx: DbOrTx = db): Promise<number> {
  const rows = await dbx
    .delete(session)
    .where(eq(session.userId, userId))
    .returning({ id: session.id })
  return rows.length
}

// ---------------------------------------------------------------------------------------------
// Export collections
// ---------------------------------------------------------------------------------------------

/**
 * The user's notifications, newest first. The `notifications` module owns the table's reads for its
 * own screens; the export needs the whole set in one statement, so it is read here.
 */
export async function listNotificationsForUser(
  userId: string,
  dbx: DbOrTx = db,
): Promise<Notification[]> {
  return dbx
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(EXPORT_ROW_LIMIT)
}

/** Audit rows where the user is the actor (08 §2.9); the log itself is the `admin` module's. */
export async function listAuditEntriesForActor(
  userId: string,
  dbx: DbOrTx = db,
): Promise<AuditLog[]> {
  return dbx
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.actorId, userId))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(EXPORT_ROW_LIMIT)
}

// ---------------------------------------------------------------------------------------------
// Purge (D-093, D-112, D-167)
// ---------------------------------------------------------------------------------------------

/** The organization's placeholder user, matched by its `deleted-user@<slug>.tassl.local` address. */
export async function findPlaceholderUser(orgId: string, dbx: DbOrTx = db): Promise<User | null> {
  const rows = await dbx
    .select({ user })
    .from(user)
    .innerJoin(
      organization,
      eq(user.email, sql`'deleted-user@' || ${organization.slug} || '.tassl.local'`),
    )
    .where(eq(organization.id, orgId))
    .limit(1)
  return rows[0]?.user ?? null
}

/** Creates the organization's placeholder user; returns the existing row when it already exists. */
export async function createPlaceholderUser(orgId: string, dbx: DbOrTx = db): Promise<User> {
  const org = (
    await dbx
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1)
  )[0]
  if (!org) throw new AppError('NOT_FOUND', 'Organization not found.')
  const rows = await dbx
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: PLACEHOLDER_USER_NAME,
      email: placeholderEmail(org.slug),
      emailVerified: true,
    })
    .onConflictDoUpdate({ target: user.email, set: { updatedAt: sql`now()` } })
    .returning()
  return one(rows)
}

/** Users whose soft delete happened strictly before `date` (the purge job's 30-day cut-off). */
export async function listDeletedBefore(date: Date, dbx: DbOrTx = db): Promise<User[]> {
  return dbx
    .select()
    .from(user)
    .where(and(isNotNull(user.deleted_at), lt(user.deleted_at, date)))
    .orderBy(desc(user.createdAt), desc(user.id))
}

/**
 * Every institution on the platform, oldest first. The purge asks each one whether it still holds
 * anything of the person's: D-006 keeps every read of a **T** table tenant-scoped, so the tenant
 * list comes from the tenants themselves, never from a cross-tenant scan of their data. The loop is
 * bounded by the institution count and happens once per purged account.
 */
export async function listOrganizationIds(dbx: DbOrTx = db): Promise<string[]> {
  const rows = await dbx
    .select({ id: organization.id })
    .from(organization)
    .orderBy(asc(organization.createdAt), asc(organization.id))
  return rows.map((row) => row.id)
}

/**
 * How many rows of this institution still name the user as the student of a run or the actor of an
 * audit entry. Zero means the institution needs no placeholder seat.
 */
export async function countUserReferences(
  tenantId: string,
  userId: string,
  dbx: DbOrTx = db,
): Promise<number> {
  const [runRow] = await dbx
    .select({ count: sql<number>`count(*)::int` })
    .from(runs)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.studentId, userId)))
  const [auditRow] = await dbx
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, tenantId), eq(auditLogs.actorId, userId)))
  return Number(runRow?.count ?? 0) + Number(auditRow?.count ?? 0)
}

/**
 * Within one organization, moves every reference to `fromId` onto `toId` (the placeholder): the
 * student column of the run rows, the actor column of their trace events, and the actor column of
 * the audit rows.
 *
 * The three updates are one call to the `repoint_user_references` SQL function: migration 0009
 * revokes UPDATE on `run_events` and `audit_logs` from `tassl_app`, so the rewrite runs inside a
 * `SECURITY DEFINER` function owned by the migration role, which is the only privilege the
 * application role is granted over those columns (D-167).
 */
export async function repointUserReferences(
  tenantId: string,
  fromId: string,
  toId: string,
  dbx: DbOrTx = db,
): Promise<RepointCounts> {
  // The third argument is the tenant filter: the function updates only rows whose organizationId
  // (`runs.organization_id`, `audit_logs.organization_id`, and the run behind each event) is this
  // institution, so a re-point can never cross a tenant boundary.
  const organizationId = tenantId
  const result = await dbx.execute(
    sql`select * from repoint_user_references(${fromId}, ${toId}, ${organizationId})`,
  )
  const row = firstRow<{
    runs_updated: number | string
    run_events_updated: number | string
    audit_logs_updated: number | string
  }>(result)
  return {
    runs: Number(row?.runs_updated ?? 0),
    runEvents: Number(row?.run_events_updated ?? 0),
    auditLogs: Number(row?.audit_logs_updated ?? 0),
  }
}

/**
 * Drops the last references an append-only table holds to the purged user: audit rows that belong
 * to no organization (so they have no placeholder to move to) and every `llm_calls` row. Both
 * tables are insert-only for `tassl_app`, so this too runs inside the definer function (D-112).
 */
export async function anonymizeUserReferences(
  fromId: string,
  dbx: DbOrTx = db,
): Promise<AnonymizeCounts> {
  const result = await dbx.execute(sql`select * from anonymize_user_references(${fromId})`)
  const row = firstRow<{
    audit_logs_anonymized: number | string
    llm_calls_anonymized: number | string
  }>(result)
  return {
    auditLogs: Number(row?.audit_logs_anonymized ?? 0),
    llmCalls: Number(row?.llm_calls_anonymized ?? 0),
  }
}

/** Hard-deletes the user with its accounts, sessions, and verification rows; null when absent. */
export async function deleteUser(id: string, dbx: DbOrTx = db): Promise<User | null> {
  const existing = await findUserById(id, dbx)
  if (!existing) return null
  await dbx.delete(verification).where(eq(verification.identifier, existing.email))
  await dbx.delete(account).where(eq(account.userId, id))
  await dbx.delete(session).where(eq(session.userId, id))
  const rows = await dbx.delete(user).where(eq(user.id, id)).returning()
  return rows[0] ?? null
}

/** The purge removes the person's own notifications; nothing else reads them (D-093). */
export async function deleteNotifications(userId: string, dbx: DbOrTx = db): Promise<number> {
  const rows = await dbx
    .delete(notifications)
    .where(eq(notifications.userId, userId))
    .returning({ id: notifications.id })
  return rows.length
}
