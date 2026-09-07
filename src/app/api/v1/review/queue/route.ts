// GET /api/v1/review/queue (07-api-spec.md §8, FR-186, D-096): the illustrative sample rows under
// their label, and the real runs of this reviewer's own sections awaiting a decision, under theirs.
// The two lists are never mixed.
export { getReviewQueueRoute as GET } from '@/server/modules/review/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
