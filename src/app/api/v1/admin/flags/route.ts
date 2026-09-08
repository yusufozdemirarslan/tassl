// GET /api/v1/admin/flags (07 §9, SYS-006): the three deployment flags and the provider the run
// loop would actually call.
export { adminGetFlags as GET } from '@/server/modules/admin/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
