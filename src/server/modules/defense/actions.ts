'use server'
// Server Actions of the `defense` module: the mirror of 07-api-spec.md §7's two defense mutations
// (07 §11). Each one validates with the same Zod schema as its route and calls the same service
// function, so UI-026 and `/api/v1` cannot drift apart. `defineAction` runs `requireSession()`, maps
// errors to the envelope, and never throws to the client.
//
// Neither revalidates a path. The defense is client state under no clock but with an answer being
// typed into it — re-rendering the tree because a question was answered would throw away whatever is
// in the next textarea (D-268). Each action answers with the thing that changed: the next question
// and the follow-up the answer earned, or the run the completion moved on.
import { defineAction } from '@/server/http/define-action'
import { DefenseAnswerInputSchema, QuestionParamsSchema, RunIdParamsSchema } from './schema'
import { answerQuestion, completeDefense } from './service'

/** One question of one run, plus the answer typed into it (FR-124). */
const AnswerDefenseQuestionActionSchema = QuestionParamsSchema.extend(
  DefenseAnswerInputSchema.shape,
)

/**
 * Answers one defense question and returns where the interview goes next (FR-123 to FR-125).
 *
 * An empty answer is allowed and is itself evidence: the follow-up rule reads it as naming no
 * source, no number and no reason, which is exactly what it is.
 */
export const answerDefenseQuestionAction = defineAction(
  AnswerDefenseQuestionActionSchema,
  async ({ runId, runQuestionId, ...input }, ctx) => ({
    data: await answerQuestion(ctx.actor, runId, runQuestionId, input),
  }),
  { name: 'answerDefenseQuestionAction' },
)

/**
 * Finishes the defense and hands the run to scoring (FR-120, D-046).
 *
 * Refused while a question has no answer row at all, with the count in `details.unanswered`, which
 * is what UI-026's confirm dialog names before it files the remainder empty.
 */
export const completeDefenseAction = defineAction(
  RunIdParamsSchema,
  async ({ runId }, ctx) => ({ data: await completeDefense(ctx.actor, runId) }),
  { name: 'completeDefenseAction' },
)
