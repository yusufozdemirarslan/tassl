// Repository of the `admin` module (docs/tech/10-backend-spec-modules.md §16): the audit log every
// module writes through `audit()`, the platform user list, and platform roles (DATA-048, D-007).
// Neither table is tenant-scoped: audit rows outlive their organization and users span tenants.
import { and, eq, ilike } from 'drizzle-orm'
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
import { auditLogs, user, type AuditLog, type NewAuditLog } from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

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
