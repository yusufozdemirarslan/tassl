// GET /api/v1/me/runs (07-api-spec.md §3): the student's own runs. The list is the runs module's
// (10 §6 `listMyRuns`) and is served under `/me`, the way `/me/assignments` is the courses module's.
export { listMyRunsRoute as GET } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
