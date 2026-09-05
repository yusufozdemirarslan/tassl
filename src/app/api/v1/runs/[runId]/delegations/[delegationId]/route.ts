// PATCH /api/v1/runs/{runId}/delegations/{delegationId} (07-api-spec.md §7, FR-060, FR-084): the
// one-line "why" a student writes about a delegation, and the claims they mark as used — which is
// what records reliance and puts the claim in front of the Decision Lock's gate.
export { updateDelegationRoute as PATCH } from '@/server/modules/assistant/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
