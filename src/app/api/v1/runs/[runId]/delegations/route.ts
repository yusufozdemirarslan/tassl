// GET  /api/v1/runs/{runId}/delegations — the Delegation Log (07-api-spec.md §7, FR-060), read by
//      the run's own student and by a reviewer of its section.
// POST /api/v1/runs/{runId}/delegations — delegate to the assistant (FR-051, AI-002). The one
//      endpoint that answers `text/event-stream`: `segment` events carrying the reply's prose and
//      its claim objects, then `done` with the delegation id.
export {
  listDelegationsRoute as GET,
  delegateRoute as POST,
} from '@/server/modules/assistant/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 07 §1 "Timeouts": 300 s for the delegation, against the 60 s every other route gets.
 *
 * It is the ceiling a real provider's slowest answer has to fit under, not a budget anything spends
 * — `LLM_TIMEOUT_MS` (60 s) is what actually bounds the call, and the mock answers in microseconds.
 * The headroom is for Phase 14, where a reply is a model generating tokens rather than a template.
 */
export const maxDuration = 300
