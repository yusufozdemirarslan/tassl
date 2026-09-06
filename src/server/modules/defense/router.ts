// Route handlers of the `defense` module (docs/tech/07-api-spec.md §7). Each one is exported by a
// thin `src/app/api/v1/**/route.ts`, which is what Next.js mounts and what `pnpm openapi:generate`
// reads. No business logic lives here: the wrapper validates and the service decides.
//
// Three rows, and all three are the owner's alone. 08 §4 gives a reviewer the whole run *after* it
// is scored, through the replay and the trace; a defense served mid-interview has no reviewer to
// serve, and the expected-answer notes the faculty seat reads it against are on a screen that does
// not exist yet.
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext } from '@/server/http/define-route'
import { RunSummarySchema } from '@/server/modules/runs/schema'
import {
  DefenseAnswerInputSchema,
  DefenseAnswerResultSchema,
  DefenseViewSchema,
  QuestionParamsSchema,
  RunIdParamsSchema,
} from './schema'
import { answerQuestion, completeDefense, openDefense } from './service'

const TAGS = ['runs']

/** `auth: 'session'` guarantees an actor; this turns the nullable context field into one. */
function actorOf<I>(ctx: RouteContext<I>): SessionUser {
  if (!ctx.actor) throw new AppError('UNAUTHENTICATED')
  return ctx.actor
}

/**
 * `GET /runs/{runId}/defense` (07 §7, FR-120, FR-126): open or resume.
 *
 * A `read` bucket, and a `GET` that writes on its first call. That is deliberate and it is the same
 * reading the Turn's own read makes (`getTurnRoute`): the defense begins by arriving at it, there is
 * no separate control on UI-026 to press, and a student who reloads is resuming rather than starting
 * again. The write is idempotent under the run's row lock, so a double-loaded page selects one
 * interview.
 */
export const getDefenseRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: DefenseViewSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'getDefense',
      summary: 'Open or resume the defense',
      tags: TAGS,
    },
  },
  async (ctx) => openDefense(actorOf(ctx), ctx.input.params.runId),
)

/**
 * `POST /runs/{runId}/defense/questions/{runQuestionId}/answer` (07 §7, FR-124).
 *
 * `write` rather than `run-events`: an answer is typed prose of up to five thousand characters and
 * happens six to nine times in a run, which is the size 10 §4 puts on the tighter bucket.
 */
export const answerDefenseQuestionRoute = defineRoute(
  {
    auth: 'session',
    input: { params: QuestionParamsSchema, body: DefenseAnswerInputSchema },
    output: DefenseAnswerResultSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'answerDefenseQuestion',
      summary: 'Answer a question (may add a follow-up)',
      tags: TAGS,
    },
  },
  async (ctx) => {
    const { runId, runQuestionId } = ctx.input.params
    return answerQuestion(actorOf(ctx), runId, runQuestionId, ctx.input.body)
  },
)

/**
 * `POST /runs/{runId}/defense/complete` (07 §7, FR-120, D-046).
 *
 * The last irreversible act of a run, and the answer carries the run with `scoringStatus: 'queued'`
 * so the status screen the student lands on already knows what it is waiting for.
 */
export const completeDefenseRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: RunSummarySchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'completeDefense',
      summary: 'Complete the defense and queue scoring',
      tags: TAGS,
    },
  },
  async (ctx) => completeDefense(actorOf(ctx), ctx.input.params.runId),
)
