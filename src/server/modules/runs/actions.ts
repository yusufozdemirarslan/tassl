'use server'
// Server Actions of the `runs` module: the mirror of every mutation in 07-api-spec.md §7 (07 §11).
// Each one validates with the same Zod schema as its route and calls the same service function, so
// the screens and `/api/v1` cannot drift apart. `defineAction` runs `requireSession()`, maps errors
// to the envelope, and never throws to the client.
//
// `revalidate` names the screens whose server render the write invalidates. Both writes here move
// the run's state, and every run screen is addressed under `/runs/[runId]`, so the run's own routes
// and the list that links to them are what has to be re-rendered.
import { defineAction } from '@/server/http/define-action'
import { AssignmentIdParamsSchema, RunIdParamsSchema } from './schema'
import { acknowledgePolicy, startRun } from './service'

const RUNS = '/runs'
const runRoot = (runId: string): string => `/runs/${runId}`

export const startRunAction = defineAction(
  AssignmentIdParamsSchema,
  async ({ assignmentId }, ctx) => {
    const run = await startRun(ctx.actor, assignmentId)
    return { data: run, revalidate: [RUNS, `/assignments/${assignmentId}`] }
  },
  { name: 'startRunAction' },
)

export const acknowledgePolicyAction = defineAction(
  RunIdParamsSchema,
  async ({ runId }, ctx) => ({
    data: await acknowledgePolicy(ctx.actor, runId),
    revalidate: [RUNS, runRoot(runId)],
  }),
  { name: 'acknowledgePolicyAction' },
)
