// POST /api/v1/review/runs/{runId}/manual-bands (07-api-spec.md §8, FR-140): a faculty seat places
// the seven bands of a run the pipeline could not read, and the run goes through to confirmed.
export { bandHeldRunManuallyRoute as POST } from '@/server/modules/review/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
