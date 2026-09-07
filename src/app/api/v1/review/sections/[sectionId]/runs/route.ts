// GET /api/v1/review/sections/{sectionId}/runs (07-api-spec.md §8): the runs of one section with
// their state and how far the band decisions have got. A reviewer of that section (08 §4).
export { listSectionRunsForReviewRoute as GET } from '@/server/modules/review/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
