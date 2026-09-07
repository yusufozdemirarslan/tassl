'use server'
// Server Actions of the `debrief` module: the mirror of 07-api-spec.md §7's debrief mutation (07
// §11). It validates with the same Zod schema as its route and calls the same service function, so
// UI-028 and `/api/v1` cannot drift apart. `defineAction` runs `requireSession()`, maps errors to
// the envelope, and never throws to the client.
import { revalidatePath } from 'next/cache'
import { defineAction } from '@/server/http/define-action'
import { DebriefAnswersSchema, RunIdParamsSchema } from './schema'
import { answerDebrief } from './service'

const AnswerDebriefActionSchema = RunIdParamsSchema.extend(DebriefAnswersSchema.shape)

/**
 * Files the two questions and, on a confirmed run, closes it (FR-152).
 *
 * It revalidates the debrief and the run's status page: answering replaces the form with the two
 * answers, and on a confirmed run it moves the run to Recorded, which is the state the status screen
 * and the Judgment Record link are drawn from (UI-027, UI-029).
 */
export const answerDebriefAction = defineAction(
  AnswerDebriefActionSchema,
  async ({ runId, ...input }, ctx) => {
    const data = await answerDebrief(ctx.actor, runId, input)
    revalidatePath(`/runs/${runId}/debrief`)
    revalidatePath(`/runs/${runId}`)
    return { data }
  },
  { name: 'answerDebriefAction' },
)
