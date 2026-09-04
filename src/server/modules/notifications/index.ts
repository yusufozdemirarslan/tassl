// Public interface of the `notifications` module (docs/tech/10-backend-spec-modules.md §15).
// Server Components, other modules, and the job handlers import from here; never from ./service or
// ./repository.
export { countUnread, listNotifications, markAllRead, markRead } from './service'

export {
  listNotificationsSchema,
  markAllReadSchema,
  notificationIdSchema,
  notificationPageSchema,
  notificationSchema,
  notificationTypeSchema,
  type ListNotificationsInput,
  type MarkAllReadInput,
  type MarkAllReadResult,
  type NotificationIdInput,
  type NotificationPage,
  type NotificationType,
  type NotificationView,
} from './schema'
