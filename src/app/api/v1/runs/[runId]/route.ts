// GET    /api/v1/runs/{runId} — run status, clock and timers, polled every five seconds by its
//        owner or a reviewer of its section (07-api-spec.md §7, D-123).
// DELETE /api/v1/runs/{runId} — delete a walkthrough run (07 §5, D-104).
export { deleteWalkthroughRunRoute as DELETE } from '@/server/modules/courses/router'
export { getRunRoute as GET } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
