// POST /api/v1/review/runs/{runId}/confirm-remaining (07-api-spec.md §8): confirm every dimension
// nobody has decided yet with its draft, under the same rules as one decision at a time.
export { confirmRemainingBandsRoute as POST } from '@/server/modules/review/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
