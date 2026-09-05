// PUT /api/v1/runs/{runId}/readiness/answers/{itemId} (07-api-spec.md §7): records one answer.
// Correctness is computed server-side and stored; the 204 is the shape of that rule — there is no
// body to return a verdict in (FR-012).
export { answerReadinessItemRoute as PUT } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
