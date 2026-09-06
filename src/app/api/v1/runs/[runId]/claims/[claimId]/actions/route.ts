// POST /api/v1/runs/{runId}/claims/{claimId}/actions (07-api-spec.md §7, FR-070 to FR-073): one
// interrogation action on a claim. The cost is charged at the moment it starts and the result is
// the author's, verbatim.
export { runActionRoute as POST } from '@/server/modules/reliance/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
