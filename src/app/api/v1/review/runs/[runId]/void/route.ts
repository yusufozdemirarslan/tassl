// POST /api/v1/review/runs/{runId}/void (07-api-spec.md §8, FR-002, FR-008): void a run and, when
// asked, offer the student another on the other variant of the family. The section's instructor
// alone; the rule lives in the `runs` module, which owns the state machine.
export { voidRunRoute as POST } from '@/server/modules/review/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
