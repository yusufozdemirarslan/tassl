// POST /api/v1/runs/{runId}/document-opens/{openId}/close (07-api-spec.md §7, FR-022, FR-024):
// ends one reading, capped at the clock it ran against and marked `skim` by D-082. Answers 204, and
// a second close for the same open is a no-op: the client sends one on unmount, one when the tab is
// hidden, and one on `beforeunload`.
export { closeDocumentRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
