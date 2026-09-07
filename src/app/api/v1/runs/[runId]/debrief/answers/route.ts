// POST /api/v1/runs/{runId}/debrief/answers (07-api-spec.md §7, FR-152): the two questions that
// close the run. The run's own student; a confirmed run moves to Recorded here.
export { answerDebriefRoute as POST } from '@/server/modules/debrief/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
