// POST /api/v1/courses/{courseId}/mapping (07-api-spec.md §5, FR-206, D-095): apply a band mapping
// change and re-export every confirmed run in the course.
export { changeMappingRoute as POST } from '@/server/modules/courses/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
