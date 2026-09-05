// Route handlers of the `runs` module (docs/tech/07-api-spec.md §7). Each one is exported by a thin
// `src/app/api/v1/**/route.ts`, which is what Next.js mounts and what `pnpm openapi:generate` reads.
// No business logic lives here: the wrapper validates and the service decides.
//
// `GET /runs/{runId}` is the one route in the codebase that answers something other than JSON, so
// it is the one with a wrapper of its own — see `withRunVersion` below.
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext, type RouteHandler } from '@/server/http/define-route'
import { attachRouteSpec, getRouteSpec, type RegisteredRoute } from '@/server/http/openapi-registry'
import { acknowledgePolicy, findMyRunOnAssignment, getRun, listMyRuns, startRun } from './service'
import {
  AssignmentIdParamsSchema,
  RunIdParamsSchema,
  RunSummaryPageSchema,
  RunSummarySchema,
  RunsQuerySchema,
} from './schema'

const TAGS = ['runs']

/** `auth: 'session'` guarantees an actor; this turns the nullable context field into one. */
function actorOf<I>(ctx: RouteContext<I>): SessionUser {
  if (!ctx.actor) throw new AppError('UNAUTHENTICATED')
  return ctx.actor
}

/** The spec `defineRoute` attached, so a wrapped handler stays visible to the generator. */
function specOf(handler: RouteHandler): RegisteredRoute {
  const spec = getRouteSpec(handler)
  if (!spec) throw new AppError('INTERNAL_ERROR', 'Route spec missing.')
  return spec
}

/**
 * The poll headers of D-123: `ETag: "v<version>"` and `X-Run-Version`, with `304 Not Modified` when
 * the caller's `If-None-Match` already names that version.
 *
 * The version is the run's event count, which the body carries, so the wrapper reads it back from
 * the response the handler produced rather than asking the database a second question. That
 * ordering is the point: 304 is decided *after* the service has materialized timers, so a poll that
 * arrives at the instant a clock expires still fires the timer and still answers with the new
 * state — the cheap answer is never the reason a run stays where it was.
 *
 * `Cache-Control: no-store` (07 §1) stays on both answers: the client asks every five seconds
 * regardless, and the ETag is a payload saving, not a licence for an intermediary to hold a run.
 */
function withRunVersion(handler: RouteHandler): RouteHandler {
  return attachRouteSpec(async (request, routeCtx) => {
    const response = await handler(request, routeCtx)
    if (response.status !== 200) return response

    const body = (await response.clone().json()) as { version?: unknown }
    if (typeof body.version !== 'number') return response

    const etag = `"v${body.version}"`
    const headers = new Headers(response.headers)
    headers.set('etag', etag)
    headers.set('x-run-version', String(body.version))
    if (request.headers.get('if-none-match') === etag) {
      headers.delete('content-type')
      return new Response(null, { status: 304, headers })
    }
    return new Response(response.body, { status: 200, headers })
  }, specOf(handler))
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

/**
 * 07 §7 marks this row *idempotent*, which is what makes a lost response recoverable: a Start whose
 * 201 never arrived is retried with the same `Idempotency-Key`, and the retry is handed the run the
 * first attempt created rather than `RUN_ACTIVE_EXISTS` — which is true, and useless to a client
 * that cannot tell whether its own request was the one that created it. Without a key the rule of
 * D-041 stands unchanged: one run per student per assignment until it is voided (D-231).
 */
export const startRunRoute = defineRoute(
  {
    auth: 'session',
    input: { params: AssignmentIdParamsSchema },
    output: RunSummarySchema,
    rateLimit: { bucket: 'write' },
    idempotency: {
      replay: async (ctx) => findMyRunOnAssignment(actorOf(ctx), ctx.input.params.assignmentId),
    },
    openapi: {
      operationId: 'startRun',
      summary: 'Start a run',
      tags: TAGS,
      status: 201,
    },
  },
  async (ctx) => startRun(actorOf(ctx), ctx.input.params.assignmentId),
)

const getRunJson = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: RunSummarySchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'getRun',
      summary: 'Run status, clock, and timers',
      tags: TAGS,
    },
  },
  async (ctx) => getRun(actorOf(ctx), ctx.input.params.runId),
)

/** Polled every five seconds by `useRunPoll`, which is why it carries the version headers. */
export const getRunRoute = withRunVersion(getRunJson)

export const acknowledgePolicyRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: RunSummarySchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'acknowledgePolicy',
      summary: 'Acknowledge the policy display and open the Readiness Check',
      tags: TAGS,
    },
  },
  async (ctx) => acknowledgePolicy(actorOf(ctx), ctx.input.params.runId),
)

export const listMyRunsRoute = defineRoute(
  {
    auth: 'session',
    input: { query: RunsQuerySchema },
    output: RunSummaryPageSchema,
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'listMyRuns', summary: 'My runs', tags: ['me'] },
  },
  async (ctx) => listMyRuns(actorOf(ctx), ctx.input.query),
)
