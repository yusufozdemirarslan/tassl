// POST /api/v1/notifications/read-all (07 §9): mark every unread notification of the actor read.
export { markAllNotificationsReadRoute as POST } from '@/server/modules/notifications/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
