// POST /api/v1/review/runs/{runId}/test-controls/force-assistant-failure (07-api-spec.md §7,
// FR-118): the faculty seat arms one assistant failure on a live run, so a class can be shown the
// standing rule of FR-001 — the run pauses, the clock stops, and the resume gives the time back.
//
// The section's instructor alone, and only where `FEATURE_TEST_CONTROLS` is on (12-security.md §4
// A04). The student is never told a control did it.
export { forceAssistantFailureRoute as POST } from '@/server/modules/review/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
