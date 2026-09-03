// Repository of the `identity` module (docs/tech/10-backend-spec-modules.md §1): the user row, its
// Better Auth satellites, and the purge job's re-pointing to the per-organization placeholder user
// `deleted-user@<slug>.tassl.local` (D-093). Query bodies only; the service owns the rules.
import { and, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  account,
  auditLogs,
  organization,
  runEvents,
  runs,
  session,
  user,
  verification,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert

/** Display name of the per-organization placeholder that deleted accounts are re-pointed to. */
export const PLACEHOLDER_USER_NAME = 'Deleted user'

export type RepointCounts = { runs: number; runEvents: number; auditLogs: number }

const placeholderEmail = (slug: string): string => `deleted-user@${slug}.tassl.local`

function one<T>(rows: readonly T[]): T {
  const row = rows[0]
  if (row === undefined) throw new AppError('INTERNAL_ERROR', 'The statement returned no row.')
  return row
}

export async function findUserById(id: string, dbx: DbOrTx = db): Promise<User | null> {
  const rows = await dbx.select().from(user).where(eq(user.id, id)).limit(1)
  return rows[0] ?? null
}

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
 * Within one organization, moves every reference to `fromId` onto `toId` (the placeholder): the
 * student column of the run rows, the actor column of their trace events, and the actor column of
 * the audit rows. Tenant-scoped because the placeholder is per organization (D-093).
 */
export async function repointUserReferences(
  tenantId: string,
  fromId: string,
  toId: string,
  dbx: DbOrTx = db,
): Promise<RepointCounts> {
  const tenantRunIds = dbx
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.organizationId, tenantId))
  const eventRows = await dbx
    .update(runEvents)
    .set({ actorId: toId })
    .where(and(eq(runEvents.actorId, fromId), inArray(runEvents.runId, tenantRunIds)))
    .returning({ id: runEvents.id })
  const runRows = await dbx
    .update(runs)
    .set({ studentId: toId })
    .where(and(eq(runs.organizationId, tenantId), eq(runs.studentId, fromId)))
    .returning({ id: runs.id })
  const auditRows = await dbx
    .update(auditLogs)
    .set({ actorId: toId })
    .where(and(eq(auditLogs.organizationId, tenantId), eq(auditLogs.actorId, fromId)))
    .returning({ id: auditLogs.id })
  return { runs: runRows.length, runEvents: eventRows.length, auditLogs: auditRows.length }
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
