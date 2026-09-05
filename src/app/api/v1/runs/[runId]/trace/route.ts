// GET /api/v1/runs/{runId}/trace (docs/tech/07-api-spec.md §7, FR-007): the run's events in order,
// for the run's owner or a reviewer of its section.
export { listRunTraceRoute as GET } from '@/server/modules/trace/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
