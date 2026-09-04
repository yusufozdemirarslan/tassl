// GET and PATCH /api/v1/courses/{courseId} (docs/tech/07-api-spec.md §5, FR-205).
export {
  getCourseRoute as GET,
  updateCoursePolicyRoute as PATCH,
} from '@/server/modules/courses/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
