// POST /api/v1/runs/{runId}/readiness/skip (07-api-spec.md §7, FR-018): closes the check without a
// result, and only after a submission has failed (`READINESS_SKIP_NOT_ALLOWED` otherwise).
export { skipReadinessRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
