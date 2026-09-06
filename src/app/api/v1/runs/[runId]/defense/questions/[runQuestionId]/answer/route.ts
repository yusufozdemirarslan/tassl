// POST /api/v1/runs/{runId}/defense/questions/{runQuestionId}/answer (07-api-spec.md §7, FR-123 to
// FR-125): one answer, recorded with its duration, and the follow-up it may earn.
//
// One answer per question: a second submission is refused rather than overwriting, because what the
// record keeps is what the student could say at the moment they were asked.
export { answerDefenseQuestionRoute as POST } from '@/server/modules/defense/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
