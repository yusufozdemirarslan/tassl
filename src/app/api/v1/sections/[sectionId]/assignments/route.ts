// POST /api/v1/sections/{sectionId}/assignments (docs/tech/07-api-spec.md §5, FR-200).
export { createAssignmentRoute as POST } from '@/server/modules/courses/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
