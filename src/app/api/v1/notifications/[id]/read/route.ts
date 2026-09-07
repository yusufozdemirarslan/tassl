// POST /api/v1/notifications/{id}/read (07 §9): mark one of the actor's notifications read.
export { markNotificationReadRoute as POST } from '@/server/modules/notifications/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
