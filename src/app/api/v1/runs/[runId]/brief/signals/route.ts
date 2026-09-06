// POST /api/v1/runs/{runId}/brief/signals (07-api-spec.md §7, FR-100): the brief editor was opened,
// or closed after a spell. The two `brief_opened` / `brief_closed` events are how long the student
// spent on the brief, which the replay's clock timeline draws; what was in it is the lock's record.
export { briefSignalRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
