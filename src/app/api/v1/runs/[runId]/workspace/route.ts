// GET /api/v1/runs/{runId}/workspace (07-api-spec.md §7, FR-020): the Scenario Brief, the Evidence
// Room as a list, and the frame — the student's own read of the room they are working in.
export { getRunWorkspaceRoute as GET } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
