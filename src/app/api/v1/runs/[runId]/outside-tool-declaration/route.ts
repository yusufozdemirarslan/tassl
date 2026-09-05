// POST /api/v1/runs/{runId}/outside-tool-declaration (07-api-spec.md §7, FR-061): the student says
// they used something outside Tassl and what for. It writes one trace event and has no other
// effect — no flag, no counter, and nothing scoring reads (FR-062, FR-006).
export { declareOutsideToolRoute as POST } from '@/server/modules/assistant/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
