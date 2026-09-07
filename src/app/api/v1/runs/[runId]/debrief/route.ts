// GET /api/v1/runs/{runId}/debrief (07-api-spec.md §7, FR-150 to FR-155): the run walked in the
// order it happened, for its own student or a reviewer of its section — one document for both
// (FR-154).
export { getDebriefRoute as GET } from '@/server/modules/debrief/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
