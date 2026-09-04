// GET /api/v1/me/assignments (07-api-spec.md §3): the student's assignments with their latest run.
export { listMyAssignments as GET } from '@/server/modules/identity/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
