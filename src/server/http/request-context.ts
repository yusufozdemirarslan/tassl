// Request-scoped context: docs/tech/10-backend-spec.md §2 and 13-observability-ops.md §2.5.
// Routes, Server Actions, and job handlers run inside runWithContext(); services call getLogger()
// and never construct loggers themselves.
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Logger } from 'pino'
import type { SessionUser } from '@/server/auth/types'
import { rootLogger } from '@/server/logging/logger'

export type RequestContext = {
  requestId: string
  actor: SessionUser | null
  logger: Logger
  startedAt: number
}

export const requestContext = new AsyncLocalStorage<RequestContext>()

export const runWithContext = <T>(ctx: RequestContext, fn: () => T): T =>
  requestContext.run(ctx, fn)

/** The current store, or undefined outside a request or job. */
export const getRequestContext = (): RequestContext | undefined => requestContext.getStore()

export function requireRequestContext(): RequestContext {
  const ctx = requestContext.getStore()
  if (!ctx) throw new Error('NO_REQUEST_CONTEXT')
  return ctx
}

/** The request's child logger, or the root logger outside a request. */
export const getLogger = (): Logger => requestContext.getStore()?.logger ?? rootLogger
