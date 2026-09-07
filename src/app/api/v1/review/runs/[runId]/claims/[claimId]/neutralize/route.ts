// POST /api/v1/review/runs/{runId}/claims/{claimId}/neutralize (07-api-spec.md §8, FR-003, FR-005):
// Tassl admitting its own error. The claim leaves the stance matrix, Verification and Calibration are
// recomputed with the run's current bands as a floor, and a confirmed run is re-exported.
//
// The section's instructor alone (08 §4).
export { neutralizeClaimRoute as POST } from '@/server/modules/review/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
