// POST /api/v1/runs/{runId}/claims/{claimId}/escalation (07-api-spec.md §7, FR-090 to FR-092): the
// student says in one sentence what they cannot evaluate and a colleague answers, for five minutes
// of the clock. The reply is authored; which one answered is not in the response (D-116).
export { escalateRoute as POST } from '@/server/modules/reliance/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
