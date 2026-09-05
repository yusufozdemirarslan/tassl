// PUT /api/v1/runs/{runId}/claims/{claimId}/stance (07-api-spec.md §7, FR-080, FR-085): the
// student's position on a claim the run has put in front of them. It charges no clock, and the
// stance it replaces is kept.
export { setStanceRoute as PUT } from '@/server/modules/reliance/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
