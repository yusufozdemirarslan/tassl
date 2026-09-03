// Cursor pagination on (created_at, id) (docs/tech/10-backend-spec.md §11, D-020). List queries sort
// `created_at desc, id desc`, fetch `limit + 1` rows, and hand the rows to toPage().
import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { AppError } from '@/lib/errors'

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100

export type Cursor = { createdAt: Date; id: string }
export type Page<T> = { items: T[]; nextCursor: string | null }
export type PageInput = { cursor?: string | null | undefined; limit?: number | null | undefined }

/** Opaque, URL-safe cursor: base64url of `<iso created_at>|<id>`. */
export function encodeCursor(row: Cursor): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url')
}

/** Inverse of encodeCursor; a malformed cursor is a validation error, never a crash. */
export function decodeCursor(cursor: string | null | undefined): Cursor | null {
  if (!cursor) return null
  const text = Buffer.from(cursor, 'base64url').toString('utf8')
  const separator = text.indexOf('|')
  if (separator < 1) throw new AppError('VALIDATION_ERROR', 'Invalid cursor.')
  const createdAt = new Date(text.slice(0, separator))
  const id = text.slice(separator + 1)
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Invalid cursor.')
  }
  return { createdAt, id }
}

/** 1 ≤ limit ≤ MAX_LIMIT; missing or invalid values fall back to the default. */
export function clampLimit(limit: number | null | undefined): number {
  if (limit === null || limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)))
}

/**
 * `created_at` truncated to the millisecond the cursor can carry (Postgres keeps microseconds,
 * JavaScript dates do not; D-166). Lists order by this expression so pages never skip rows that
 * share the boundary row's millisecond.
 */
export const createdAtMs = (column: PgColumn): SQL => sql`date_trunc('milliseconds', ${column})`

/** ORDER BY for every cursor-paginated list: `created_at desc, id desc` at cursor precision. */
export function cursorOrder(columns: { createdAt: PgColumn; id: PgColumn }): SQL[] {
  return [desc(createdAtMs(columns.createdAt)), desc(columns.id)]
}

/** Keyset condition for rows strictly after the cursor in cursorOrder(). */
export function afterCursor(
  columns: { createdAt: PgColumn; id: PgColumn },
  cursor: Cursor | null,
): SQL | undefined {
  if (!cursor) return undefined
  const boundary = createdAtMs(columns.createdAt)
  // An expression has no column type for Drizzle to serialize a Date through, so the cursor's
  // timestamp travels as text cast to the column's own type (Better Auth's tables use a plain
  // timestamp, ours timestamptz; mixing the two would apply the session time zone, D-162).
  const type = columns.createdAt.getSQLType().includes('with time zone')
    ? 'timestamptz'
    : 'timestamp'
  const at = sql`${cursor.createdAt.toISOString()}::${sql.raw(type)}`
  return or(lt(boundary, at), and(eq(boundary, at), lt(columns.id, cursor.id)))
}

/** Trims a `limit + 1` result set to a page and derives the next cursor from the last item. */
export function toPage<T extends Cursor>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  const nextCursor = rows.length > limit && last ? encodeCursor(last) : null
  return { items, nextCursor }
}
