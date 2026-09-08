// Collects every defineRoute() spec so scripts/openapi-generate.ts (Step 0.7) can emit
// docs/tech/openapi.yaml from code. The generator imports each src/app/api/**/route.ts, reads the
// exported method handlers, and pairs the file path with the spec attached to each handler.
import type { ZodType } from 'zod'
import type { RateLimitBucket } from '@/server/rate-limit/limits'

export type RouteAuth = 'session' | 'cron' | 'public'

export type RouteInputSchemas = { params?: ZodType; query?: ZodType; body?: ZodType }

export type RegisteredRoute = {
  operationId: string
  summary: string
  tags: string[]
  /** Success status; its response description defaults to "OK". */
  status: number
  description?: string
  auth: RouteAuth
  input?: RouteInputSchemas
  output: ZodType
  /** Additional documented responses by status code (e.g. 503 for readiness). */
  responses?: Record<string, { description: string; schema: ZodType }>
  rateLimit?: RateLimitBucket
  /**
   * `false` when `scripts/openapi-generate.ts` must leave this operation as `openapi.yaml` has it
   * written by hand.
   *
   * One route needs it: `POST /runs/{runId}/delegations` answers `text/event-stream`, so a
   * generated `application/json` response body would be a lie (D-273). Until Step 13.4 it said so
   * by carrying no spec at all — which also meant the one endpoint in the product that spends a
   * model budget declared no rate-limit bucket anywhere a test could read, while enforcing one in
   * its handler. Saying "not documented" out loud is what lets the bucket be declared with
   * everything else (D-613).
   */
  documented?: boolean
}

export const ROUTE_SPEC: unique symbol = Symbol.for('tassl.routeSpec')

const registry = new Map<string, RegisteredRoute>()

/** Idempotent per operationId so module re-evaluation in dev (HMR) does not throw. */
export function registerRoute(route: RegisteredRoute): void {
  registry.set(route.operationId, route)
}

export function getRegisteredRoute(operationId: string): RegisteredRoute | undefined {
  return registry.get(operationId)
}

export function listRegisteredRoutes(): RegisteredRoute[] {
  return [...registry.values()].sort((a, b) => a.operationId.localeCompare(b.operationId))
}

export function attachRouteSpec<T extends object>(handler: T, route: RegisteredRoute): T {
  Object.defineProperty(handler, ROUTE_SPEC, { value: route, enumerable: false })
  return handler
}

export function getRouteSpec(handler: unknown): RegisteredRoute | undefined {
  if (typeof handler !== 'function') return undefined
  return (handler as { [ROUTE_SPEC]?: RegisteredRoute })[ROUTE_SPEC]
}
