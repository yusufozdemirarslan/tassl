// POST /api/v1/runs/{runId}/defense/complete (07-api-spec.md §7, FR-120, D-046): the last
// irreversible act of a run.
//
// Every question needs an answer row and an empty one counts (FR-124); the transition to
// `defense_complete` enqueues `score_run` after the transaction commits.
export { completeDefenseRoute as POST } from '@/server/modules/defense/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
