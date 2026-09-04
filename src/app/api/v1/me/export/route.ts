// POST /api/v1/me/export (SYS-004): the data export, delivered as a file attachment.
export { exportMe as POST } from '@/server/modules/identity/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
