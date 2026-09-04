// DELETE /api/v1/runs/{runId}: delete a walkthrough run (docs/tech/07-api-spec.md §5, D-104).
// GET /runs/{runId} is the run module's and arrives with Phase 6.
export { deleteWalkthroughRunRoute as DELETE } from '@/server/modules/courses/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
