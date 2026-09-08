// GET /api/v1/admin/audit-log (07 §9, SYS-006, DATA-048): the platform audit log.
export { adminListAuditLog as GET } from '@/server/modules/admin/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
