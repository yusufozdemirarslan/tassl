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
import { resetRateLimiter } from '@/server/rate-limit/index'
import {
  acknowledgePolicy,
  addAddendum,
  advanceRunClock,
  answerReadinessItem,
  assertTestEnvironment,
  briefSignal,
  closeDocument,
  findMyRunOnAssignment,
  getReadiness,
  getRun,
  getRunWorkspace,
  getTurn,
  listMyRuns,
  lockDecision,
  lockFrame,
  openDocument,
  respondToTurn,
  resumeRun,
  saveBriefDraft,
  skipReadiness,
  startRun,
  submitReadiness,
} from './service'
import {
  AddendumSchema,
  AdvanceClockSchema,
  AnswerReadinessItemSchema,
  AssignmentIdParamsSchema,
  BriefDraftInputSchema,
  BriefInputSchema,
  BriefSignalSchema,
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
  TurnResponseInputSchema,
  TurnViewSchema,
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
// The Decision Brief, the Decision Lock and the addendum (07 §7, FR-084, FR-100 to FR-108)
//
// The save and the two timing signals are `run-events`: a brief is written over the whole working
// period and autosaved as it is typed, which is the traffic 10 §4 sizes that bucket for. The lock
// and the addendum are `write`: each happens once, and the first of them is irreversible.
// ---------------------------------------------------------------------------------------------

const saveBriefDraftJson = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema, body: BriefDraftInputSchema },
    output: z.object({}),
    rateLimit: { bucket: 'run-events' },
    openapi: { operationId: 'saveBriefDraft', summary: 'Save the brief draft', tags: TAGS },
  },
  async (ctx) => {
    await saveBriefDraft(actorOf(ctx), ctx.input.params.runId, ctx.input.body)
    return {}
  },
)

export const saveBriefDraftRoute = noContent(saveBriefDraftJson, 'Saved')

const briefSignalJson = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema, body: BriefSignalSchema },
    output: z.object({}),
    rateLimit: { bucket: 'run-events' },
    openapi: {
      operationId: 'briefSignal',
      summary: 'Brief opened or closed timing signal',
      tags: TAGS,
    },
  },
  async (ctx) => {
    await briefSignal(actorOf(ctx), ctx.input.params.runId, ctx.input.body)
    return {}
  },
)

export const briefSignalRoute = noContent(briefSignalJson, 'Recorded')

/**
 * `POST /runs/{runId}/lock` (07 §7, FR-084, FR-102): the Decision Lock, and the gate in front of it.
 *
 * `BriefInputSchema` is the wire shape and `BriefSchema` the rule, applied by the service so that a
 * brief over a word limit answers `BRIEF_INVALID` naming the field (10 §6) — the shape the frame
 * already uses, and the one the editor binds its errors to. The other refusal is FR-084's, and it
 * carries the claim's id and its own words in `details` so UI-024's dialog can name it and link to
 * it.
 */
export const lockDecisionRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema, body: BriefInputSchema },
    output: RunSummarySchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'lockDecision',
      summary: 'Decision Lock (irreversible)',
      tags: TAGS,
    },
  },
  async (ctx) => lockDecision(actorOf(ctx), ctx.input.params.runId, ctx.input.body),
)

const addAddendumJson = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema, body: AddendumSchema },
    output: z.object({}),
    rateLimit: { bucket: 'write' },
    openapi: { operationId: 'addAddendum', summary: 'Add the 50-word addendum', tags: TAGS },
  },
  async (ctx) => {
    await addAddendum(actorOf(ctx), ctx.input.params.runId, ctx.input.body)
    return {}
  },
)

export const addAddendumRoute = noContent(addAddendumJson, 'Recorded')

// ---------------------------------------------------------------------------------------------
// The Turn (07 §7, FR-110 to FR-115)
//
// The read is on the `read` bucket and is polled for the window countdown, exactly as the workspace
// is; the response is a `write`, because it happens once and is irreversible.
// ---------------------------------------------------------------------------------------------

/**
 * The read that also *delivers*: a student who opens `/runs/[id]/turn` at or after `turn_due_at`
 * materializes the Turn here, and the service is what refuses a run that is not in the window with
 * the state it is in (`TURN_NOT_OPEN`, `details.state`).
 */
export const getTurnRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: TurnViewSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'getTurn',
      summary: 'The Turn, its window, and the frozen pre-Turn record',
      tags: TAGS,
    },
  },
  async (ctx) => getTurn(actorOf(ctx), ctx.input.params.runId),
)

/**
 * `TurnResponseInputSchema` is the wire shape and `TurnResponseSchema` the rule, applied by the
 * service so that every caller meets it — the reading D-287 makes of the same choice one module
 * along. The other refusal is FR-111's, and it carries the claims' ids in `details.claimIds` so
 * UI-025 can mark the cards that are still waiting for a stance.
 */
export const respondToTurnRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema, body: TurnResponseInputSchema },
    output: RunSummarySchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'respondToTurn',
      summary: 'Hold, revise, or reverse (irreversible)',
      tags: TAGS,
    },
  },
  async (ctx) => respondToTurn(actorOf(ctx), ctx.input.params.runId, ctx.input.body),
)

/**
 * `POST /runs/{runId}/resume` (07 §7, FR-001): the student takes the run off Paused.
 *
 * A `write`, not `run-events`: it changes the run's state and gives the clock its time back, and it
 * happens once per outage. The screen behind it is the paused overlay, which is the only control
 * the workspace offers while a component failure is being waited out.
 */
export const resumeRunRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: RunSummarySchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'resumeRun',
      summary: 'Resume from Paused (clock credited)',
      tags: TAGS,
    },
  },
  async (ctx) => resumeRun(actorOf(ctx), ctx.input.params.runId),
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
 * It is **not documented**: `documented: false` on the spec below keeps
 * `scripts/openapi-generate.ts` away, so `docs/tech/openapi.yaml` never gains an operation for a
 * route that exists only in a test process. Until Step 13.4 that was said by attaching no spec at
 * all — which also hid the route from `tests/integration/rate-limit/coverage.test.ts`, so the one
 * endpoint in the product that moves a student's clock declared no bucket anywhere a sweep could
 * read it, while enforcing `write` through `advanceClockJson` (D-613).
 *
 * And it is **closed before anything else runs**: the environment is checked here, ahead of the
 * session lookup `defineRoute` would do first, so outside a test process the path answers the same
 * 404 an unmounted route does rather than 401 — an unauthenticated caller learns nothing from it.
 * `advanceRunClock` checks the same gate again before it touches a row, because a guard that lives
 * only in a route is a guard one refactor away from being gone.
 */
export const advanceClockRoute: RouteHandler = attachRouteSpec(
  async (request, routeCtx) => {
    try {
      assertTestEnvironment()
    } catch (error) {
      return toErrorResponse(error, getOrCreateRequestId(request.headers))
    }
    return advanceClockJson(request, routeCtx)
  },
  { ...specOf(advanceClockJson), documented: false },
)

/**
 * `POST /api/v1/test/rate-limits/reset` — `APP_ENV=test` only, absent from OpenAPI, same shape as
 * the advance-clock route above.
 *
 * The guide-driven suite runs the same seat through the same screens on three engines in one
 * server process, and two of its controls live in the process's memory rather than in a table: the
 * `auth` failed-sign-in window (D-704) and the two-an-hour data export (identity). A reset between
 * engines empties every window, which is what a fresh server would have done; nothing else about
 * the process changes, and outside a test process the path answers 404 before a session is read.
 */
const resetRateLimitsJson = defineRoute(
  {
    auth: 'session',
    output: z.object({ reset: z.literal(true) }),
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'resetTestRateLimits',
      summary: 'Empty the in-memory rate-limit windows (test only)',
      tags: TAGS,
    },
  },
  async () => {
    resetRateLimiter()
    return { reset: true as const }
  },
)

export const resetRateLimitsRoute: RouteHandler = attachRouteSpec(
  async (request, routeCtx) => {
    try {
      assertTestEnvironment()
    } catch (error) {
      return toErrorResponse(error, getOrCreateRequestId(request.headers))
    }
    return resetRateLimitsJson(request, routeCtx)
  },
  { ...specOf(resetRateLimitsJson), documented: false },
)
