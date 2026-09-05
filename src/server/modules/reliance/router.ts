// Route handlers of the `reliance` module (docs/tech/07-api-spec.md §7). Each one is exported by a
// thin `src/app/api/v1/**/route.ts`, which is what Next.js mounts and what `pnpm openapi:generate`
// reads. No business logic lives here: the wrapper validates and the service decides.
//
// Four of 07 §7's five rows: the claim list, the stance, the interrogation action and the
// escalation. The fifth is the Decision Lock, which is the `runs` module's endpoint and refuses
// with this module's gate query (`findUnstancedReliedOn`, FR-084).
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext } from '@/server/http/define-route'
import { escalate, listRunClaims, runAction, setStance } from './service'
import {
  ActionResultSchema,
  ClaimListSchema,
  ClaimParamsSchema,
  ClaimViewSchema,
  EscalateSchema,
  EscalationResultSchema,
  RunActionSchema,
  RunIdParamsSchema,
  SetStanceSchema,
} from './schema'

const TAGS = ['runs']

/** `auth: 'session'` guarantees an actor; this turns the nullable context field into one. */
function actorOf<I>(ctx: RouteContext<I>): SessionUser {
  if (!ctx.actor) throw new AppError('UNAUTHENTICATED')
  return ctx.actor
}

/**
 * `GET /runs/{runId}/claims` (07 §7): the claims this run has surfaced, as their own student reads
 * them.
 *
 * The owner alone. 08 §4 gives a reviewer the whole run *after* it is scored, through the replay
 * and the trace; a claim list served mid-run has no reviewer to serve, and `requireRunOwner`
 * answers NOT_FOUND to everyone else so that a run id cannot be probed for existence.
 *
 * A `read`: the workspace polls it beside `GET /runs/{runId}` while the student works, because a
 * stance set in one tab has to show up in the other.
 */
export const listRunClaimsRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: ClaimListSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'listRunClaims',
      summary: 'Claims with stances and actions (student view)',
      tags: TAGS,
    },
  },
  async (ctx) => listRunClaims(actorOf(ctx), ctx.input.params.runId),
)

/**
 * `PUT /runs/{runId}/claims/{claimId}/stance` (07 §7, FR-080).
 *
 * `run-events` rather than `write`: a stance is one of the small, frequent in-run writes 10 §4 sizes
 * that bucket for — a student works through five claims and changes their mind on two of them.
 *
 * `PUT` because a stance is idempotent in the shape a `PUT` promises: the same stance sent twice
 * leaves the claim where it was. What it is not is *silent* — the second send writes its own
 * `stance_set` event, because the trace records what the student did and not only where they ended.
 */
export const setStanceRoute = defineRoute(
  {
    auth: 'session',
    input: { params: ClaimParamsSchema, body: SetStanceSchema },
    output: ClaimViewSchema,
    rateLimit: { bucket: 'run-events' },
    openapi: { operationId: 'setStance', summary: 'Set a stance', tags: TAGS },
  },
  async (ctx) => {
    const { runId, claimId } = ctx.input.params
    return setStance(actorOf(ctx), runId, claimId, ctx.input.body.stance)
  },
)

/**
 * `POST /runs/{runId}/claims/{claimId}/actions` (07 §7, FR-070 to FR-073).
 *
 * `write` rather than `run-events`, and the difference is what the request costs: an action spends
 * a minute of the student's clock, so the tighter bucket is also the one that makes a runaway
 * client visible before it has spent the run.
 */
export const runActionRoute = defineRoute(
  {
    auth: 'session',
    input: { params: ClaimParamsSchema, body: RunActionSchema },
    output: ActionResultSchema,
    rateLimit: { bucket: 'write' },
    openapi: { operationId: 'runAction', summary: 'Run an interrogation action', tags: TAGS },
  },
  async (ctx) => {
    const { runId, claimId } = ctx.input.params
    return runAction(actorOf(ctx), runId, claimId, ctx.input.body.type)
  },
)

/**
 * `POST /runs/{runId}/claims/{claimId}/escalation` (07 §7, FR-090 to FR-092).
 *
 * The output is `EscalationResultSchema`, which is the student's form of the row and is missing two
 * of its columns on purpose (D-116). `defineRoute` validates what it answers against this schema,
 * so a service that started returning `responseId` would fail here rather than on a screen.
 */
export const escalateRoute = defineRoute(
  {
    auth: 'session',
    input: { params: ClaimParamsSchema, body: EscalateSchema },
    output: EscalationResultSchema,
    rateLimit: { bucket: 'write' },
    openapi: { operationId: 'escalate', summary: 'Escalate a claim', tags: TAGS },
  },
  async (ctx) => {
    const { runId, claimId } = ctx.input.params
    return escalate(actorOf(ctx), runId, claimId, ctx.input.body)
  },
)
