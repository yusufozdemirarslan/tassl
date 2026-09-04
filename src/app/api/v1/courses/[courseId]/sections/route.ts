// POST /api/v1/courses/{courseId}/sections (docs/tech/07-api-spec.md §5).
export { createSectionRoute as POST } from '@/server/modules/courses/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
