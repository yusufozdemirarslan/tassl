// defineRoute(): docs/tech/10-backend-spec.md §2, 13-observability-ops.md §2.5, 08-auth-authz.md §2.7.
// Order: request context → auth → CSRF header → params/query/body → rate limit → handler →
// output validation → JSON with x-request-id and Cache-Control: no-store → error envelope.
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Logger } from 'pino'
import { z, type ZodType } from 'zod'
import { AppError } from '@/lib/errors'
import { getSession, requireSession } from '@/server/auth/session'
import type { SessionUser } from '@/server/auth/types'
import { env } from '@/server/config'
import { toErrorParts } from '@/server/http/errors'
import {
  attachRouteSpec,
  registerRoute,
  type RegisteredRoute,
  type RouteAuth,
} from '@/server/http/openapi-registry'
import { runWithContext, type RequestContext } from '@/server/http/request-context'
import { createRequestLogger, hashId } from '@/server/logging/logger'
import { getOrCreateRequestId } from '@/server/logging/request-id'
import { enforceRateLimit } from '@/server/rate-limit/enforce'
import type { RateLimitBucket } from '@/server/rate-limit/limits'

export type { RouteAuth } from '@/server/http/openapi-registry'

export type RouteInput<P, Q, B> = { params: P; query: Q; body: B }

export type RouteContext<I> = {
  request: Request
  requestId: string
  actor: SessionUser | null
  logger: Logger
  input: I
}

export type RouteSpec<P, Q, B, O> = {
  auth: RouteAuth
  input?: { params?: ZodType<P>; query?: ZodType<Q>; body?: ZodType<B> }
  output: ZodType<O>
  rateLimit?: {
    bucket: RateLimitBucket
    /** Defaults to the actor id, or the client IP for anonymous requests. */
    key?: (ctx: RouteContext<RouteInput<P, Q, B>>) => string
  }
  openapi: { operationId: string; summary: string; tags: string[]; status?: number }
}

export type RouteParams = Record<string, string | string[]>
export type RouteHandler = (
  req: Request,
  routeCtx: { params: Promise<RouteParams> },
) => Promise<Response>

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const NO_STORE = { 'cache-control': 'no-store' }

/** First hop of x-forwarded-for, the only client address Vercel forwards. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const first = forwarded?.split(',')[0]?.trim()
  return first || request.headers.get('x-real-ip') || 'unknown'
}

/** Rebuilds the route template (/api/v1/runs/[runId]) from the concrete path and the matched params. */
export function routePattern(pathname: string, params: RouteParams): string {
  const segments = pathname.split('/')
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== 'string') continue
    const index = segments.indexOf(value)
    if (index > 0) segments[index] = `[${name}]`
  }
  return segments.join('/') || '/'
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; compared in constant time. */
function assertCronBearer(request: Request): void {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (!token || !timingSafeEqual(digest(token), digest(env.CRON_SECRET))) {
    throw new AppError('UNAUTHENTICATED')
  }
}

function parseWith<T>(schema: ZodType<T> | undefined, value: unknown, where: string): T {
  if (!schema) return undefined as T
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', `Invalid ${where}.`, {
      details: z.flattenError(parsed.error),
    })
  }
  return parsed.data
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Request body is not valid JSON.')
  }
}

function queryObject(url: URL): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of url.searchParams) out[key] = value
  return out
}

export function defineRoute<P = undefined, Q = undefined, B = undefined, O = unknown>(
  spec: RouteSpec<P, Q, B, O>,
  handler: (ctx: RouteContext<RouteInput<P, Q, B>>) => Promise<O>,
): RouteHandler {
  const registered: RegisteredRoute = {
    operationId: spec.openapi.operationId,
    summary: spec.openapi.summary,
    tags: spec.openapi.tags,
    status: spec.openapi.status ?? 200,
    auth: spec.auth,
    output: spec.output,
    ...(spec.input ? { input: spec.input } : {}),
    ...(spec.rateLimit ? { rateLimit: spec.rateLimit.bucket } : {}),
  }
  registerRoute(registered)

  const routeHandler: RouteHandler = async (request, routeCtx) => {
    const startedAt = Date.now()
    const requestId = getOrCreateRequestId(request.headers)
    const url = new URL(request.url)
    // Next resolves `params` to undefined for routes without dynamic segments (D-165).
    const rawParams = (await routeCtx?.params) ?? {}
    const logger = createRequestLogger({
      requestId,
      route: routePattern(url.pathname, rawParams),
      method: request.method,
    })
    const store: RequestContext = { requestId, actor: null, logger, startedAt }

    return runWithContext(store, async () => {
      try {
        // Auth
        let actor: SessionUser | null = null
        if (spec.auth === 'session') actor = await requireSession(request.headers)
        else if (spec.auth === 'cron') assertCronBearer(request)
        else actor = await getSession(request.headers)
        if (actor) {
          store.actor = actor
          store.logger = logger.child({
            userId: hashId(actor.id),
            ...(actor.activeOrganizationId ? { orgId: actor.activeOrganizationId } : {}),
          })
        }

        // CSRF: cookie-authenticated mutations must carry X-Requested-With: tassl (08 §2.7).
        const cookieAuth = actor !== null && !request.headers.get('authorization')
        if (MUTATING.has(request.method) && cookieAuth) {
          if (request.headers.get('x-requested-with') !== 'tassl') {
            throw new AppError('FORBIDDEN', 'Missing X-Requested-With header.')
          }
        }

        // Input
        const input: RouteInput<P, Q, B> = {
          params: parseWith(spec.input?.params, rawParams, 'path parameters'),
          query: parseWith(spec.input?.query, queryObject(url), 'query'),
          body: parseWith(
            spec.input?.body,
            spec.input?.body ? await readJsonBody(request) : undefined,
            'body',
          ),
        }
        const ctx: RouteContext<RouteInput<P, Q, B>> = {
          request,
          requestId,
          actor,
          logger: store.logger,
          input,
        }

        // Rate limit
        if (spec.rateLimit) {
          const key = spec.rateLimit.key?.(ctx) ?? actor?.id ?? clientIp(request)
          await enforceRateLimit(spec.rateLimit.bucket, {
            key,
            scope: actor ? 'user' : 'ip',
            userId: actor?.id ?? null,
            organizationId: actor?.activeOrganizationId ?? null,
          })
        }

        // Handler and output
        const result = await handler(ctx)
        const validated = spec.output.safeParse(result)
        if (!validated.success) {
          if (env.APP_ENV !== 'production') {
            throw new AppError('INTERNAL_ERROR', 'Route output did not match spec.output.', {
              details: z.flattenError(validated.error),
            })
          }
          store.logger.error(
            {
              event: 'output_invalid',
              issues: validated.error.issues.map((i) => i.path.join('.')),
            },
            'route output did not match spec.output',
          )
        }
        const data: unknown = validated.success ? validated.data : result
        const status = registered.status
        store.logger.info(
          { event: 'http_request', status, durationMs: Date.now() - startedAt },
          'request completed',
        )
        return Response.json(data, { status, headers: { 'x-request-id': requestId, ...NO_STORE } })
      } catch (error) {
        const parts = toErrorParts(error, requestId)
        const durationMs = Date.now() - startedAt
        if (parts.status >= 500) {
          // Phase 13: Sentry.captureException(error) with the request id as a tag.
          store.logger.error(
            {
              event: 'http_request',
              status: parts.status,
              code: parts.code,
              err: error,
              durationMs,
            },
            'request failed',
          )
        } else {
          store.logger.info(
            { event: 'http_request', status: parts.status, code: parts.code, durationMs },
            'request rejected',
          )
        }
        return Response.json(parts.body, { status: parts.status, headers: parts.headers })
      }
    })
  }

  return attachRouteSpec(routeHandler, registered)
}
