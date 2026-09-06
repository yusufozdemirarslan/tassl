// POST /api/v1/runs/{runId}/addendum (07-api-spec.md §7, FR-107): the one fifty-word addendum a
// student may add after the Decision Lock. It is never part of the original decision and is
// rendered apart from the brief on every screen; a post-lock edit is refused.
export { addAddendumRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
