// POST /api/v1/review/runs/{runId}/delegations/{delegationId}/flag (07-api-spec.md §8, FR-055): a
// reviewer marks one assistant reply out of scenario, and the band reads stop counting it.
export { flagDelegationRoute as POST } from '@/server/modules/review/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
