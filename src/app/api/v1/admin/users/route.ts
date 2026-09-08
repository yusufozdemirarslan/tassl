// GET /api/v1/admin/users (07 §9, SYS-006): every account, newest first, by email prefix.
export { adminListUsers as GET } from '@/server/modules/admin/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
