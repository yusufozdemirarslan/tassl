// PUT /api/v1/runs/{runId}/brief (07-api-spec.md §7, FR-100): saves the Decision Brief draft while
// the working clock runs. It answers 204 and writes no trace event — a draft is a scratchpad row
// until the Decision Lock, and the trace records the decision rather than the typing.
export { saveBriefDraftRoute as PUT } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
