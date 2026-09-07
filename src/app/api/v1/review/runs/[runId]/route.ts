// GET /api/v1/review/runs/{runId} (07-api-spec.md §8, FR-180): the faculty replay bundle — the trace
// in order, the four graphs, the defense transcript with its expected-answer notes, the bands with
// their evidence, the package and claim objects, the declarations, the unverified numbers and the
// corrections already entered.
//
// A reviewer of the run's section, and nobody else. Everything here is the answer key (12 §8.1).
export { getReplayRoute as GET } from '@/server/modules/review/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
