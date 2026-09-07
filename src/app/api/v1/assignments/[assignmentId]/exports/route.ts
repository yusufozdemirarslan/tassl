// GET /api/v1/assignments/{assignmentId}/exports (07-api-spec.md §8, FR-184, UI-035): the export
// history of an assignment, newest first. Summaries rather than files; each file is its own
// download. A reviewer of the assignment's section only.
export { listAssignmentExportsRoute as GET } from '@/server/modules/records/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
