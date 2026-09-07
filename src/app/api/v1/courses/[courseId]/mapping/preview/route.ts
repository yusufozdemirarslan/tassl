// POST /api/v1/courses/{courseId}/mapping/preview (07-api-spec.md §5, FR-206): the confirmed runs a
// mapping change would move, with the points they carry now and the points they would carry after.
export { previewMappingChangeRoute as POST } from '@/server/modules/courses/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
