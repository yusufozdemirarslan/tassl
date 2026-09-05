// Route handlers of the `assistant` module (docs/tech/07-api-spec.md §7). Each one is exported by a
// thin `src/app/api/v1/**/route.ts`, which is what Next.js mounts and what `pnpm openapi:generate`
// reads. No business logic lives here: the wrapper validates and the service decides.
//
// Three of the four are ordinary `defineRoute` handlers. The fourth is the only endpoint in the
// codebase that does not answer JSON, and it is written by hand — see `delegateRoute`.
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import type { SessionUser } from '@/server/auth/types'
import {
  defineRoute,
  clientIp,
  type RouteContext,
  type RouteHandler,
} from '@/server/http/define-route'
import { toErrorResponse } from '@/server/http/errors'
import { attachRouteSpec, getRouteSpec, type RegisteredRoute } from '@/server/http/openapi-registry'
import { runWithContext, type RequestContext } from '@/server/http/request-context'
import { createRequestLogger, hashId } from '@/server/logging/logger'
import { getOrCreateRequestId } from '@/server/logging/request-id'
import { enforceRateLimit } from '@/server/rate-limit/enforce'
import { declareOutsideTool, delegate, listDelegations, updateDelegation } from './service'
import {
  DeclareOutsideToolSchema,
  DelegateInputSchema,
  DelegationListSchema,
  DelegationParamsSchema,
  DelegationViewSchema,
  RunIdParamsSchema,
  UpdateDelegationSchema,
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

// ---------------------------------------------------------------------------------------------
// The Delegation Log (07 §7, FR-060)
// ---------------------------------------------------------------------------------------------

export const listDelegationsRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: DelegationListSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'listDelegations',
      summary: 'Delegation Log',
      tags: TAGS,
    },
  },
  async (ctx) => listDelegations(actorOf(ctx), ctx.input.params.runId),
)

/**
 * The why line and the used marks (FR-060, FR-084).
 *
 * `run-events` rather than `write`: a student writes a why line on several entries and marks claims
 * used as they go, which is the shape 10 §4 sizes that bucket for — the in-run writes, not the acts
 * that change the run's state.
 */
export const updateDelegationRoute = defineRoute(
  {
    auth: 'session',
    input: { params: DelegationParamsSchema, body: UpdateDelegationSchema },
    output: DelegationViewSchema,
    rateLimit: { bucket: 'run-events' },
    openapi: {
      operationId: 'updateDelegation',
      summary: 'Why line and used marks',
      tags: TAGS,
    },
  },
  async (ctx) => {
    const { runId, delegationId } = ctx.input.params
    return updateDelegation(actorOf(ctx), runId, delegationId, ctx.input.body)
  },
)

// ---------------------------------------------------------------------------------------------
// The outside-tool declaration (07 §7, FR-061)
// ---------------------------------------------------------------------------------------------

const declareOutsideToolJson = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema, body: DeclareOutsideToolSchema },
    output: z.object({}),
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'declareOutsideTool',
      summary: 'Declare outside-tool use (no scoring effect)',
      tags: TAGS,
    },
  },
  async (ctx) => {
    await declareOutsideTool(actorOf(ctx), ctx.input.params.runId, ctx.input.body)
    return {}
  },
)

/** 204, and there is nothing to put in a body: the declaration has no effect to report (FR-061). */
export const declareOutsideToolRoute = noContent(declareOutsideToolJson, 'Recorded')

// ---------------------------------------------------------------------------------------------
// The delegation stream (07 §7, AI-002)
// ---------------------------------------------------------------------------------------------

/** 07 §7's wire format: `event: <name>` then one `data:` line of JSON, then a blank line. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

const STREAM_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store',
  connection: 'keep-alive',
  // Nginx and some proxies buffer a response until it closes, which would turn the stream into one
  // delivery at the end. Vercel does not, but a self-hosted deployment behind a proxy would.
  'x-accel-buffering': 'no',
} as const

/**
 * `POST /runs/{runId}/delegations` (07 §7, AI-002): the one endpoint that does not answer JSON.
 *
 * **Why it is hand-written.** `defineRoute` validates the handler's result against `spec.output` and
 * serializes it with `Response.json`, which is the right shape for every other route and the wrong
 * one for a body that is written after the headers. Wrapping a stream in it would mean either
 * buffering the reply — losing the thing the endpoint exists for — or teaching the wrapper a second
 * response mode for one caller. So the pipeline `defineRoute` runs is repeated here in the same
 * order, and it is the same code underneath: `requireSession`, the CSRF header of 08 §2.7, the path
 * and body schemas of this module, the `llm` bucket of D-026, and `toErrorResponse` for anything
 * thrown. It is also why this handler carries no OpenAPI spec: `docs/tech/openapi.yaml` documents
 * the operation as `text/event-stream` by hand, and a generated `application/json` response would
 * overwrite that with a lie (D-273).
 *
 * **Why the failures are JSON and the successes are events.** Everything that can refuse a
 * delegation — the state gate, the length limit, the rate bucket, a provider that never answered —
 * is decided before the first byte of the body is written, because the service completes the whole
 * reply before it yields anything (D-271). A client therefore gets either an error envelope with a
 * status it can act on, or a 200 whose events all arrive. There is no half-answered stream to
 * interpret, which is what lets `use-delegation.ts` be a reader rather than a state machine.
 */
export const delegateRoute: RouteHandler = async (request, routeCtx) => {
  const startedAt = Date.now()
  const requestId = getOrCreateRequestId(request.headers)
  const logger = createRequestLogger({
    requestId,
    route: '/api/v1/runs/[runId]/delegations',
    method: 'POST',
  })
  const store: RequestContext = { requestId, actor: null, logger, startedAt }

  return runWithContext(store, async () => {
    try {
      const actor = await requireSession(request.headers)
      store.actor = actor
      store.logger = logger.child({
        userId: hashId(actor.id),
        ...(actor.activeOrganizationId ? { orgId: actor.activeOrganizationId } : {}),
      })

      // 08 §2.7: a cookie-authenticated mutation must carry the header a cross-site form cannot.
      if (!request.headers.get('authorization')) {
        if (request.headers.get('x-requested-with') !== 'tassl') {
          throw new AppError('FORBIDDEN', 'Missing X-Requested-With header.')
        }
      }

      const params = RunIdParamsSchema.safeParse((await routeCtx?.params) ?? {})
      if (!params.success) throw new AppError('VALIDATION_ERROR', 'Invalid path parameters.')

      const raw: unknown = await request.json().catch(() => undefined)
      const body = DelegateInputSchema.safeParse(raw)
      if (!body.success) throw new AppError('VALIDATION_ERROR', 'Invalid body.')

      await enforceRateLimit('llm', {
        key: actor.id || clientIp(request),
        scope: 'user',
        userId: actor.id,
        organizationId: actor.activeOrganizationId ?? null,
      })

      const chunks = await delegate(actor, params.data.runId, body.data)

      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          // A reader that went away — a closed tab, a navigation, a `fetch` the client aborted —
          // makes `enqueue` throw, and so does closing a controller that is already gone. Neither is
          // a failure of the delegation: it is finished, stored and traced before the first frame is
          // written (D-271), so the only thing left to do is stop writing.
          try {
            for await (const chunk of chunks) {
              controller.enqueue(encoder.encode(sseFrame(chunk.event, chunk.data)))
            }
          } catch (error) {
            store.logger.debug({ err: error }, 'delegation stream reader went away')
          }
          try {
            controller.close()
          } catch {
            // Already closed by the runtime when the connection ended.
          }
        },
      })

      store.logger.info(
        { event: 'http_request', status: 200, durationMs: Date.now() - startedAt },
        'request completed',
      )
      return new Response(stream, {
        status: 200,
        headers: { ...STREAM_HEADERS, 'x-request-id': requestId },
      })
    } catch (error) {
      return toErrorResponse(error, requestId)
    }
  })
}
