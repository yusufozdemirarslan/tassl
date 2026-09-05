// GET /api/v1/runs/{runId}/claims (07-api-spec.md §7): the claims this run has surfaced, as their
// own student reads them — the claim and their own stance, and nothing authored about it.
export { listRunClaimsRoute as GET } from '@/server/modules/reliance/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
