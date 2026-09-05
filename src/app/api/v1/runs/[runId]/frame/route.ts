// POST /api/v1/runs/{runId}/frame (07-api-spec.md §7, FR-040, FR-041): locks the frame permanently,
// unlocks the assistant without evaluating or commenting, and starts the working clock.
export { lockFrameRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
