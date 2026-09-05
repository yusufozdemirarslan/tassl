// POST /api/v1/runs/{runId}/documents/{documentId}/open (07-api-spec.md §7, FR-022, FR-031): the
// only route that hands over a document body, and it writes the `document_open` event in the same
// transaction — so the record of what was read is the record of what was served.
export { openDocumentRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
