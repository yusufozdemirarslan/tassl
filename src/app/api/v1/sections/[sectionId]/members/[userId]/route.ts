// DELETE /api/v1/sections/{sectionId}/members/{userId} (docs/tech/07-api-spec.md §5, SYS-005).
export { removeSectionMemberRoute as DELETE } from '@/server/modules/courses/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
