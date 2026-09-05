// POST /api/v1/runs/{runId}/resume (07-api-spec.md §7, FR-001): the student takes the run off
// Paused after a component failure. The clock gets back the time the outage took, and the cost of
// whatever failed is credited — which for a delegation is nothing, because a delegation charges no
// clock (10-backend-spec.md §10).
export { resumeRunRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
