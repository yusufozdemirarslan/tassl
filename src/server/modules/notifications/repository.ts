// Module `notifications` — repository (docs/tech/10-backend-spec-modules.md §15; table
// notifications, 06-data-model.md §3.6). Query bodies only: the e-mail copies are the service's job.
// notifications is not a tenant table (organization_id is an optional label); every read and write
// is scoped to the owning user id the service takes from the session. The database handle is always
// the last parameter (10 §6).
import { and, eq, isNull, sql } from 'drizzle-orm'
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
import { notifications, type NewNotification, type Notification } from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

/** `?cursor&limit&unread?` of GET /notifications (07-api-spec.md). */
export type NotificationListInput = PageInput & { unread?: boolean | null | undefined }

/** One row per recipient; an empty list is a no-op. */
export async function insertNotifications(
  values: NewNotification[],
  dbx: DbOrTx = db,
): Promise<Notification[]> {
  if (values.length === 0) return []
  return dbx.insert(notifications).values(values).returning()
}

/** The user's notifications, newest first, cursor-paginated on (created_at, id) (D-020). */
export async function listNotifications(
  userId: string,
  input: NotificationListInput = {},
  dbx: DbOrTx = db,
): Promise<Page<Notification>> {
  const limit = clampLimit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const rows = await dbx
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        input.unread ? isNull(notifications.readAt) : undefined,
        afterCursor({ createdAt: notifications.createdAt, id: notifications.id }, cursor),
      ),
    )
    .orderBy(...cursorOrder({ createdAt: notifications.createdAt, id: notifications.id }))
    .limit(limit + 1)
  return toPage(rows, limit)
}

/** Marks one of the user's notifications read (idempotent: the first read_at stays). */
export async function markRead(
  userId: string,
  id: string,
  dbx: DbOrTx = db,
): Promise<Notification | undefined> {
  const rows = await dbx
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning()
  return rows[0]
}

/** Marks every unread notification of the user read; returns how many changed. */
export async function markAllRead(userId: string, dbx: DbOrTx = db): Promise<number> {
  const rows = await dbx
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id })
  return rows.length
}
