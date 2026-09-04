// GET and POST /api/v1/institutions/{orgId}/courses (docs/tech/07-api-spec.md §5, FR-200).
export { createCourseRoute as POST, listCoursesRoute as GET } from '@/server/modules/courses/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
