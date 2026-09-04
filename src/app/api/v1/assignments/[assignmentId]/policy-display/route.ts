// GET /api/v1/assignments/{assignmentId}/policy-display (docs/tech/07-api-spec.md §5, FR-201).
export { getPolicyDisplayRoute as GET } from '@/server/modules/courses/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
