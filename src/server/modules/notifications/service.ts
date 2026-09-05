// Service of the `notifications` module (docs/tech/10-backend-spec-modules.md §15, UI-011).
//
// Notifications have one rule: owner only. `notifications` is not a tenant table (its
// `organization_id` is a label, 06 §3.6), so the scope of every read and write is the actor's own
// user id, taken from the session and never from the input — a row that is not theirs simply is not
// found. That is why no permission helper appears here: the actor *is* the query key.
//
// `notify()` is the writer 10 §15 specifies: it fans an event out to its recipients inside the
// caller's transaction, so a notification exists exactly when the thing it announces happened.
// Email copies are specified for five run and generation types (`generation_complete`,
// `generation_failed`, `run_scored`, `run_held`, `bands_confirmed`); none of them is raised yet,
// and the phase that raises the first one brings the template it needs with it.
import { AppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import type { SessionUser } from '@/server/auth/types'
import * as repo from './repository'
import {
  notificationTypeSchema,
  type ListNotificationsInput,
  type NotifyInput,
  type MarkAllReadResult,
  type NotificationPage,
  type NotificationView,
} from './schema'

const iso = (value: Date): string => value.toISOString()
const isoOrNull = (value: Date | null): string | null => (value === null ? null : iso(value))

/**
 * A row a future migration adds a type to would otherwise crash the list; an unknown type reads as
 * the generic kind the list renders with the neutral icon rather than dropping the row.
 */
function toView(row: repo.Notification): NotificationView {
  const type = notificationTypeSchema.safeParse(row.type)
  return {
    id: row.id,
    type: type.success ? type.data : 'export_ready',
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: isoOrNull(row.readAt),
    createdAt: iso(row.createdAt),
  }
}

/**
 * Writes one notification per recipient (10 §15). `tx` is the caller's transaction: a notification
 * that announces a write belongs to that write, and rolls back with it.
 *
 * The actor is absent on purpose — this is a fan-out to other people, and the permission that made
 * it legitimate was checked by the caller before it opened its transaction.
 */
export async function notify(
  tx: Parameters<typeof repo.insertNotifications>[1],
  input: NotifyInput,
): Promise<void> {
  const recipients = [...new Set(input.userIds)]
  if (recipients.length === 0) return
  await repo.insertNotifications(
    recipients.map((userId: string) => ({
      userId,
      organizationId: input.orgId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      payload: input.payload ?? {},
    })),
    tx,
  )
}

/** The actor's notifications, newest first, cursor-paginated (D-020). */
export async function listNotifications(
  actor: SessionUser,
  input: ListNotificationsInput = {},
): Promise<NotificationPage> {
  const page = await repo.listNotifications(actor.id, {
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.unread === undefined ? {} : { unread: input.unread }),
  })
  return { items: page.items.map(toView), nextCursor: page.nextCursor }
}

/** The unread count the shell's bell shows (UI-008). */
export async function countUnread(actor: SessionUser): Promise<number> {
  return repo.countUnread(actor.id)
}

/** Marks one of the actor's own notifications read; someone else's id is NOT_FOUND. */
export async function markRead(actor: SessionUser, id: string): Promise<NotificationView> {
  const row = await repo.markRead(actor.id, id)
  if (!row) throw new AppError('NOT_FOUND', t('notifications.notFound'))
  return toView(row)
}

/** Marks every unread notification of the actor read; the count is what changed. */
export async function markAllRead(actor: SessionUser): Promise<MarkAllReadResult> {
  return { marked: await repo.markAllRead(actor.id) }
}
