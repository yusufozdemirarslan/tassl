// Repository of the `admin` module (docs/tech/10-backend-spec-modules.md §16): the audit log every
// module writes through `audit()`, the platform user list, and platform roles (DATA-048, D-007).
// Neither table is tenant-scoped: audit rows outlive their organization and users span tenants.
import { and, asc, eq, ilike } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  afterCursor,
  clampLimit,
  decodeCursor,
  toPage,
  type Page,
  type PageInput,
  cursorOrder,
} from '@/server/db/pagination'
import {
  auditLogs,
  organization,
  session,
  user,
  type AuditLog,
  type NewAuditLog,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'
import { INSTITUTION_FILTER_LIMIT } from './schema'

// The service may not import `@/server/db` (04 §2), so the types and the transaction boundary it
// needs are re-exported by the layer that owns database access.
export type { AuditAction, AuditLog, AuditLogMetadata, NewAuditLog } from '@/server/db/schema'
export type { DbOrTx, Tx } from '@/server/db/tx'
export { withTransaction } from '@/server/db/tx'

export type UserRow = typeof user.$inferSelect

/** `user.platform_role` values (06 §3.1, D-007). */
export type PlatformRole = 'none' | 'tassl_scenario_editor' | 'admin'

export type ListUsersInput = PageInput & { q?: string | null | undefined }
export type ListAuditLogInput = PageInput & { orgId?: string | null | undefined }

function one<T>(rows: readonly T[]): T {
  const row = rows[0]
  if (row === undefined) throw new AppError('INTERNAL_ERROR', 'The statement returned no row.')
  return row
}

/** Escapes the LIKE metacharacters so a prefix is matched literally. */
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`)

export async function insertAuditLog(values: NewAuditLog, dbx: DbOrTx = db): Promise<AuditLog> {
  const rows = await dbx.insert(auditLogs).values(values).returning()
  return one(rows)
}

/** A page of users, newest first; `q` filters on a case-insensitive email prefix. */
export async function listUsers(input: ListUsersInput, dbx: DbOrTx = db): Promise<Page<UserRow>> {
  const limit = clampLimit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const prefix = input.q?.trim() ?? ''
  const rows = await dbx
    .select()
    .from(user)
    .where(
      and(
        prefix.length > 0 ? ilike(user.email, `${escapeLike(prefix)}%`) : undefined,
        afterCursor({ createdAt: user.createdAt, id: user.id }, cursor),
      ),
    )
    .orderBy(...cursorOrder({ createdAt: user.createdAt, id: user.id }))
    .limit(limit + 1)
  return toPage(rows, limit)
}

/** One user row by id, or null. The platform screens read anybody, including soft-deleted rows. */
export async function findUserById(userId: string, dbx: DbOrTx = db): Promise<UserRow | null> {
  const rows = await dbx.select().from(user).where(eq(user.id, userId)).limit(1)
  return rows[0] ?? null
}

/**
 * Every session of another user, deleted inside the caller's transaction (10 §16: a role change
 * "revokes the user's sessions").
 *
 * `identity` sweeps the actor's *own* sessions through `auth.api.revokeSessions`, which acts on the
 * request's cookie and can say nothing about somebody else's; Better Auth's admin plugin, which
 * could, is not enabled (08 §3 uses the organization plugin alone). So the row that carries the
 * seat and the rows that spend it are written by one statement pair in one transaction here, which
 * is also what makes the revocation and the audit row commit together (D-570).
 */
export async function deleteSessionsOfUser(userId: string, dbx: DbOrTx = db): Promise<number> {
  const rows = await dbx
    .delete(session)
    .where(eq(session.userId, userId))
    .returning({ id: session.id })
  return rows.length
}

export async function setPlatformRole(
  userId: string,
  role: PlatformRole,
  dbx: DbOrTx = db,
): Promise<UserRow | null> {
  const rows = await dbx
    .update(user)
    .set({ platform_role: role })
    .where(eq(user.id, userId))
    .returning()
  return rows[0] ?? null
}

/** A page of audit rows, newest first, optionally limited to one organization. */
export async function listAuditLog(
  input: ListAuditLogInput,
  dbx: DbOrTx = db,
): Promise<Page<AuditLog>> {
  const limit = clampLimit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const rows = await dbx
    .select()
    .from(auditLogs)
    .where(
      and(
        input.orgId ? eq(auditLogs.organizationId, input.orgId) : undefined,
        afterCursor({ createdAt: auditLogs.createdAt, id: auditLogs.id }, cursor),
      ),
    )
    .orderBy(...cursorOrder({ createdAt: auditLogs.createdAt, id: auditLogs.id }))
    .limit(limit + 1)
  return toPage(rows, limit)
}

/**
 * Every institution, by name, for the audit log's filter (UI-050 "filter by org").
 *
 * A platform-wide list and not `tenancy.listMyInstitutions`, which answers the actor's *memberships*
 * — an admin is a seat over Tassl and not a member of the institutions it hosts (08 §4), so the
 * membership list is empty for exactly the person this filter is for. Capped rather than paged: the
 * filter is a control on one screen, and a deployment past the cap gets a filter that names the
 * first two hundred institutions rather than a second pagination to maintain (D-572). The control
 * says so when it is at the cap; the number lives in `./schema` so both sides read one value.
 */
export type InstitutionRef = { id: string; name: string }

export async function listInstitutions(dbx: DbOrTx = db): Promise<InstitutionRef[]> {
  return dbx
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .orderBy(asc(organization.name))
    .limit(INSTITUTION_FILTER_LIMIT)
}
