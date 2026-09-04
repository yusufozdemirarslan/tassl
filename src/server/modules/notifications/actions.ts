'use server'
// Server Actions of the `notifications` module (UI-011; 07-api-spec.md §3 lists the same three
// operations as endpoints, which arrive with the notification writers in Phase 11). `defineAction`
// runs `requireSession()`, validates with the module's schema, maps errors to the envelope, and
// never throws to the client.
import { defineAction } from '@/server/http/define-action'
import {
  listNotificationsSchema,
  markAllReadSchema,
  notificationIdSchema,
  type ListNotificationsInput,
  type MarkAllReadInput,
  type MarkAllReadResult,
  type NotificationIdInput,
  type NotificationPage,
  type NotificationView,
} from './schema'
import { listNotifications, markAllRead, markRead } from './service'

/** The shell's bell reads the unread count, so every read mark refreshes it. */
const SHELL = ['/home', '/notifications']

/** "Load more" (UI-011): the next page after the cursor the previous page ended on. */
export const listNotificationsAction = defineAction<ListNotificationsInput, NotificationPage>(
  listNotificationsSchema,
  async (input, ctx) => ({ data: await listNotifications(ctx.actor, input) }),
  { name: 'notifications.list' },
)

export const markNotificationReadAction = defineAction<NotificationIdInput, NotificationView>(
  notificationIdSchema,
  async (input, ctx) => ({ data: await markRead(ctx.actor, input.id), revalidate: SHELL }),
  { name: 'notifications.markRead' },
)

export const markAllNotificationsReadAction = defineAction<MarkAllReadInput, MarkAllReadResult>(
  markAllReadSchema,
  async (_input, ctx) => ({ data: await markAllRead(ctx.actor), revalidate: SHELL }),
  { name: 'notifications.markAllRead' },
)
