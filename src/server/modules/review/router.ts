// Route handlers of the `review` module (docs/tech/07-api-spec.md §7). Each one is exported by a
// thin `src/app/api/v1/**/route.ts`, which is what Next.js mounts and what `pnpm openapi:generate`
// reads. No business logic lives here: the wrapper validates and the service decides.
//
// One row for now — FR-118's forced-failure control — and the service behind it is the `runs`
// module's, not this one's. 10 §6 puts `forceAssistantFailure` there because what it writes is a
// `runs.flags` key and what it causes is a pause of the run's own clock, and 10 §12 lists FR-118
// among this module's responsibilities because the *seat* that presses it is the faculty one and
// the path is `/review`. Both readings are right, and the split is the ordinary one: the endpoint
// belongs to the reviewer's surface, the rule belongs to the module that owns the column. The
// import is through `@/server/modules/runs` — the public index every cross-module call goes through
// (CLAUDE.md, D-290) — rather than that module's service file.
//
// The replay, the band decisions, the neutralization and the manual banding arrive with Phase 11.
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext } from '@/server/http/define-route'
import { forceAssistantFailure } from '@/server/modules/runs'
import { ForcedFailureSchema, RunIdParamsSchema } from './schema'

const TAGS = ['review']

/** `auth: 'session'` guarantees an actor; this turns the nullable context field into one. */
function actorOf<I>(ctx: RouteContext<I>): SessionUser {
  if (!ctx.actor) throw new AppError('UNAUTHENTICATED')
  return ctx.actor
}

/**
 * `POST /review/runs/{runId}/test-controls/force-assistant-failure` (07 §7, FR-118).
 *
 * The section's instructor alone, and only where `FEATURE_TEST_CONTROLS` is on: the service applies
 * both gates in that order, so a student on the section is refused before the environment is
 * consulted (08 §4, 12 §4 A04). A `write`: it changes the run, and the next delegation the student
 * makes will pause it.
 */
export const forceAssistantFailureRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: ForcedFailureSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'forceAssistantFailure',
      summary: 'Arm the build-phase forced assistant failure',
      tags: TAGS,
    },
  },
  async (ctx) => forceAssistantFailure(actorOf(ctx), ctx.input.params.runId),
)
