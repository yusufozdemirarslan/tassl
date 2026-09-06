// GET /api/v1/runs/{runId}/turn (07-api-spec.md §7, FR-110 to FR-112): the Turn in the voice of the
// world, the window it opened, and the frame and brief the student filed before it arrived.
//
// It is also the read that delivers: timers are materialized lazily (ADR-019), so a student who
// opens this page at or after `turn_due_at` is the reason the Turn is written to the trace — stamped
// at the instant it fired, with the twelve minutes starting now (FR-115).
export { getTurnRoute as GET } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
