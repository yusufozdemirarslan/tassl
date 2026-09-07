// GET /api/v1/notifications (07 §9, SYS-010): the actor's own notifications, newest first.
export { listNotificationsRoute as GET } from '@/server/modules/notifications/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
