// Service of the `notifications` module (docs/tech/10-backend-spec-modules.md §15, UI-011).
//
// Notifications have one rule: owner only. `notifications` is not a tenant table (its
// `organization_id` is a label, 06 §3.6), so the scope of every read and write is the actor's own
// user id, taken from the session and never from the input — a row that is not theirs simply is not
// found. That is why no permission helper appears here: the actor *is* the query key.
//
// `notify()` is the writer 10 §15 specifies: it fans an event out to its recipients inside the
// caller's transaction, so a notification exists exactly when the thing it announces happened.
//
// Email copies go out for the five types 10 §15 names, and only when `NOTIFY_EMAIL_COPIES` is on
// (D-015 makes that the switch for removing them). Three rules hold the copy to the same standard as
// the row:
//
//   * **After the commit, never inside it.** `enqueueAfterCommit` defers the `send_email` job to the
//     transaction that produced the notification actually landing. An email about a run that rolled
//     back cannot be recalled.
//   * **Title and body only.** The template carries what the notification carries and nothing else
//     (`email/templates/notification.tsx`): no band, no rate, no student free text, and no payload.
//     An inbox is the least controlled surface Tassl writes to.
//   * **A link only where it is one of ours.** `appLink` refuses an address off this deployment's
//     origin (12 §OWASP A10), so an in-app path is made absolute here and anything else is dropped
//     rather than sent.
import { AppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import type { SessionUser } from '@/server/auth/types'
import { env } from '@/server/config'
import { parseEmailProps } from '@/server/email/send'
import { enqueueAfterCommit } from '@/server/jobs/enqueue'
import * as repo from './repository'
import {
  notificationTypeSchema,
  type ListNotificationsInput,
  type NotifyInput,
  type MarkAllReadResult,
  type NotificationPage,
  type NotificationType,
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
  await enqueueEmailCopies(tx, recipients, input)
}

/** 10 §15: the five types that also arrive by e-mail. Everything else is in-app only. */
const EMAIL_COPY_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'generation_complete',
  'generation_failed',
  'run_scored',
  'run_held',
  'bands_confirmed',
])

/** An in-app path made absolute on this deployment's origin; anything else is not linked. */
function emailUrl(link: string | null | undefined): string | undefined {
  if (link === null || link === undefined || !link.startsWith('/')) return undefined
  return new URL(link, env.NEXT_PUBLIC_APP_URL).toString()
}

/**
 * The stand-in when `notify` was called with no transaction (it takes an optional handle, like every
 * repository function). `enqueueAfterCommit` defers only for a handle `withTransaction` is tracking;
 * an untracked object means "nothing to wait for", and the job is sent immediately — which is
 * correct, because there is no transaction that could roll the notification back.
 */
const NO_TRANSACTION: object = {}

async function enqueueEmailCopies(
  tx: Parameters<typeof repo.insertNotifications>[1],
  recipients: readonly string[],
  input: NotifyInput,
): Promise<void> {
  if (!env.NOTIFY_EMAIL_COPIES || !EMAIL_COPY_TYPES.has(input.type)) return
  const url = emailUrl(input.link)
  const props = parseEmailProps('notification', {
    title: input.title,
    body: input.body,
    ...(url === undefined ? {} : { url }),
  })
  for (const person of await repo.listEmailRecipients(recipients, tx)) {
    await enqueueAfterCommit(tx ?? NO_TRANSACTION, 'send_email', {
      to: person.email,
      template: 'notification',
      props: { ...props },
    })
  }
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
