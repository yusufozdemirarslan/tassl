// POST /api/v1/runs/{runId}/lock (07-api-spec.md §7, FR-084, FR-102): the Decision Lock.
//
// The gate comes first and refuses in two ways, both of which are written to the trace before they
// are answered: `BRIEF_INVALID` naming the field, and `LOCK_REFUSED_UNSTANCED_CLAIM` naming the
// first claim the student relied on and took no position on. A lock that stands is irreversible.
export { lockDecisionRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
