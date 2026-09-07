// Route handlers of the `debrief` module (docs/tech/07-api-spec.md §7). Each one is exported by a
// thin `src/app/api/v1/**/route.ts`, which is what Next.js mounts and what `pnpm openapi:generate`
// reads. No business logic lives here: the wrapper validates and the service decides.
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext } from '@/server/http/define-route'
import { RunSummarySchema } from '@/server/modules/runs'
import { answerDebrief, getDebrief } from './service'
import { DebriefAnswersSchema, DebriefViewSchema, RunIdParamsSchema } from './schema'

const TAGS = ['runs']

/** `auth: 'session'` guarantees an actor; this turns the nullable context field into one. */
function actorOf<I>(ctx: RouteContext<I>): SessionUser {
  if (!ctx.actor) throw new AppError('UNAUTHENTICATED')
  return ctx.actor
}

/**
 * `GET /runs/{runId}/debrief` (07 §7, FR-150 to FR-155).
 *
 * The run's own student **or** a reviewer of its section (07 §7's `Stu, Rev`), reading one document
 * (FR-154). A `read` bucket, and it does write one thing — the `debrief_opened` event, once per
 * version of the bands, and only on the owner's own open (10 §13). That is a record of the fact that
 * the student was shown their result, not a change to the run.
 */
export const getDebriefRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: DebriefViewSchema,
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'getDebrief', summary: 'Run Debrief', tags: TAGS },
  },
  async (ctx) => getDebrief(actorOf(ctx), ctx.input.params.runId),
)

/**
 * `POST /runs/{runId}/debrief/answers` (07 §7, FR-152): the two questions that close the run.
 *
 * The run's own student. A confirmed run moves to Recorded here; a run whose bands are still draft
 * waits, and the confirmation moves it (10 §12).
 */
export const answerDebriefRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema, body: DebriefAnswersSchema },
    output: RunSummarySchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'answerDebrief',
      summary: 'Answer the two debrief questions',
      tags: TAGS,
    },
  },
  async (ctx) => answerDebrief(actorOf(ctx), ctx.input.params.runId, ctx.input.body),
)
