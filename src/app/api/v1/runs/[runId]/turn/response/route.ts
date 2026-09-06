// POST /api/v1/runs/{runId}/turn/response (07-api-spec.md §7, FR-112): hold, revise, or reverse.
//
// The second irreversible act of a run. It is refused while a claim the window raised has no stance
// (`TURN_CLAIMS_UNSTANCED`, FR-111), and once it lands the run is on its way to the defense with no
// assistant and no room in front of it.
export { respondToTurnRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
