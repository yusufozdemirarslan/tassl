// Route handlers of the `runs` module (docs/tech/07-api-spec.md §7). Each one is exported by a thin
// `src/app/api/v1/**/route.ts`, which is what Next.js mounts and what `pnpm openapi:generate` reads.
// No business logic lives here: the wrapper validates and the service decides.
//
// `GET /runs/{runId}` is the one route in the codebase that answers something other than JSON, so
// it is the one with a wrapper of its own — see `withRunVersion` below.
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext, type RouteHandler } from '@/server/http/define-route'
import { toErrorResponse } from '@/server/http/errors'
import { attachRouteSpec, getRouteSpec, type RegisteredRoute } from '@/server/http/openapi-registry'
import { getOrCreateRequestId } from '@/server/logging/request-id'
import {
  acknowledgePolicy,
  advanceRunClock,
  answerReadinessItem,
  assertTestEnvironment,
  closeDocument,
  findMyRunOnAssignment,
  getReadiness,
  getRun,
  getRunWorkspace,
  listMyRuns,
  lockFrame,
  openDocument,
  skipReadiness,
  startRun,
  submitReadiness,
} from './service'
import {
  AdvanceClockSchema,
  AnswerReadinessItemSchema,
  AssignmentIdParamsSchema,
  DocumentOpenParamsSchema,
  DocumentOpenedSchema,
  DocumentParamsSchema,
  LockFrameInputSchema,
  ReadinessItemParamsSchema,
  ReadinessResultSchema,
  ReadinessViewSchema,
  RunIdParamsSchema,
  RunSummaryPageSchema,
  RunSummarySchema,
  RunWorkspaceSchema,
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

/** 204 with no body (07 §7): the wrapper's 200 becomes an empty response, errors pass through. */
function noContent(handler: RouteHandler, description: string): RouteHandler {
  return attachRouteSpec(
    async (request, routeCtx) => {
      const response = await handler(request, routeCtx)
      if (response.status !== 200) return response
      const headers = new Headers(response.headers)
      headers.delete('content-type')
      return new Response(null, { status: 204, headers })
    },
    { ...specOf(handler), status: 204, description },
  )
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

// ---------------------------------------------------------------------------------------------
// The Readiness Check (07 §7, FR-010 to FR-018)
//
// Four rows, and one property that holds across all of them: no response defined here has a field
// for whether an answer was right. `ReadinessViewSchema` carries the student's own answers and no
// item key; `ReadinessResultSchema` carries named concepts and no total. The answer row is a 204,
// which is the strongest form of the same rule — there is no body to put a verdict in (FR-012).
// ---------------------------------------------------------------------------------------------

export const getReadinessRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: ReadinessViewSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'getReadiness',
      summary: 'Readiness items and remaining time',
      tags: TAGS,
    },
  },
  async (ctx) => getReadiness(actorOf(ctx), ctx.input.params.runId),
)

const answerReadinessItemJson = defineRoute(
  {
    auth: 'session',
    input: { params: ReadinessItemParamsSchema, body: AnswerReadinessItemSchema },
    output: z.object({}),
    // Sixteen items answered and re-answered in eight minutes is the bucket 10 §4 sizes for the
    // in-run writes, not the sixty-a-minute one meant for the acts that change a run's state.
    rateLimit: { bucket: 'run-events' },
    openapi: { operationId: 'answerReadinessItem', summary: 'Answer an item', tags: TAGS },
  },
  async (ctx) => {
    const { runId, itemId } = ctx.input.params
    await answerReadinessItem(actorOf(ctx), runId, itemId, ctx.input.body)
    return {}
  },
)

export const answerReadinessItemRoute = noContent(answerReadinessItemJson, 'Recorded')

export const submitReadinessRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: ReadinessResultSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'submitReadiness',
      summary: 'Submit the Readiness Check',
      tags: TAGS,
    },
  },
  async (ctx) => submitReadiness(actorOf(ctx), ctx.input.params.runId),
)

export const skipReadinessRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: ReadinessResultSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'skipReadiness',
      summary: 'Skip after a failure to complete',
      tags: TAGS,
    },
  },
  async (ctx) => skipReadiness(actorOf(ctx), ctx.input.params.runId),
)

// ---------------------------------------------------------------------------------------------
// The workspace: the Evidence Room and the frame (07 §7, FR-020 to FR-024, FR-040)
//
// The two open-tracking rows are on the `run-events` bucket rather than `write` (10 §4): a student
// reading nine documents opens and closes them far more often than they change the run's state, and
// the client sends a close on unmount, on `visibilitychange` and on `beforeunload`. The frame is a
// `write`: it happens once.
// ---------------------------------------------------------------------------------------------

export const getRunWorkspaceRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: RunWorkspaceSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'getRunWorkspace',
      summary: 'The brief, the Evidence Room, and the frame',
      tags: TAGS,
    },
  },
  async (ctx) => getRunWorkspace(actorOf(ctx), ctx.input.params.runId),
)

/**
 * The one route that hands over a document body, and it is a POST because it writes: the response
 * and the `document_open` event are one transaction, so a body cannot be read without the run
 * recording that it was (FR-022).
 */
export const openDocumentRoute = defineRoute(
  {
    auth: 'session',
    input: { params: DocumentParamsSchema },
    output: DocumentOpenedSchema,
    rateLimit: { bucket: 'run-events' },
    openapi: {
      operationId: 'openDocument',
      summary: 'Open a document in the Evidence Room',
      tags: TAGS,
    },
  },
  async (ctx) => {
    const { runId, documentId } = ctx.input.params
    return openDocument(actorOf(ctx), runId, documentId)
  },
)

const closeDocumentJson = defineRoute(
  {
    auth: 'session',
    input: { params: DocumentOpenParamsSchema },
    output: z.object({}),
    rateLimit: { bucket: 'run-events' },
    openapi: { operationId: 'closeDocument', summary: 'Close a document', tags: TAGS },
  },
  async (ctx) => {
    const { runId, openId } = ctx.input.params
    await closeDocument(actorOf(ctx), runId, openId)
    return {}
  },
)

export const closeDocumentRoute = noContent(closeDocumentJson, 'Recorded')

/**
 * `LockFrameInputSchema` is the wire shape and `LockFrameSchema` the rule, applied by the service:
 * a frame that breaks one answers `FRAME_INVALID` naming the field (10 §6), which is what the form
 * binds its error to, rather than the generic validation failure a route-level refinement produces.
 */
export const lockFrameRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema, body: LockFrameInputSchema },
    output: RunSummarySchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'lockFrame',
      summary: 'Lock the frame and start the working clock',
      tags: TAGS,
    },
  },
  async (ctx) => lockFrame(actorOf(ctx), ctx.input.params.runId, ctx.input.body),
)

// ---------------------------------------------------------------------------------------------
// Test control (D-109) — `APP_ENV=test` only, and absent from OpenAPI
// ---------------------------------------------------------------------------------------------

const advanceClockJson = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema, body: AdvanceClockSchema },
    output: RunSummarySchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'advanceRunClock',
      summary: 'Shift a run’s clock backwards (test only)',
      tags: TAGS,
    },
  },
  async (ctx) => advanceRunClock(actorOf(ctx), ctx.input.params.runId, ctx.input.body),
)

/**
 * `POST /api/v1/test/runs/{runId}/advance-clock` (D-109, 07 §7's test-only line).
 *
 * Two things make it safe to have in the tree at all.
 *
 * It is **not documented**: unlike every other handler here it is not passed through
 * `attachRouteSpec`, so `scripts/openapi-generate.ts` — which reads the spec off the exported
 * handler — cannot see it, and `docs/tech/openapi.yaml` never gains an operation for a route that
 * exists only in a test process.
 *
 * And it is **closed before anything else runs**: the environment is checked here, ahead of the
 * session lookup `defineRoute` would do first, so outside a test process the path answers the same
 * 404 an unmounted route does rather than 401 — an unauthenticated caller learns nothing from it.
 * `advanceRunClock` checks the same gate again before it touches a row, because a guard that lives
 * only in a route is a guard one refactor away from being gone.
 */
export const advanceClockRoute: RouteHandler = async (request, routeCtx) => {
  try {
    assertTestEnvironment()
  } catch (error) {
    return toErrorResponse(error, getOrCreateRequestId(request.headers))
  }
  return advanceClockJson(request, routeCtx)
}
