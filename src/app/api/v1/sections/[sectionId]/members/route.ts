// GET and POST /api/v1/sections/{sectionId}/members (docs/tech/07-api-spec.md §5, SYS-005).
export {
  addSectionMemberRoute as POST,
  listSectionMembersRoute as GET,
} from '@/server/modules/courses/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
