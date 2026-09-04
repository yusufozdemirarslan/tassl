// GET /api/v1/me/runs (07-api-spec.md §3): the student's own runs.
export { listMyRuns as GET } from '@/server/modules/identity/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
