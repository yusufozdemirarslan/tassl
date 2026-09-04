// GET and PATCH /api/v1/assignments/{assignmentId} (docs/tech/07-api-spec.md §5, FR-200).
export {
  getAssignmentRoute as GET,
  updateAssignmentRoute as PATCH,
} from '@/server/modules/courses/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
