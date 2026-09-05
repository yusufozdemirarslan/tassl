// Route handlers of the `reliance` module (docs/tech/07-api-spec.md §7). Each one is exported by a
// thin `src/app/api/v1/**/route.ts`, which is what Next.js mounts and what `pnpm openapi:generate`
// reads. No business logic lives here: the wrapper validates and the service decides.
//
// One route today. 07 §7 gives this module five — the claim list, the stance, the interrogation
// action, the escalation and the lock gate's refusal — and the other four arrive in Phase 8 with
// the rules that answer them. A route with no rule behind it would be a shape a client could learn
// and then have taken away.
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext } from '@/server/http/define-route'
import { listRunClaims } from './service'
import { ClaimViewSchema, RunIdParamsSchema } from './schema'

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
    output: z.array(ClaimViewSchema),
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'listRunClaims',
      summary: 'Claims with stances and actions (student view)',
      tags: TAGS,
    },
  },
  async (ctx) => listRunClaims(actorOf(ctx), ctx.input.params.runId),
)
