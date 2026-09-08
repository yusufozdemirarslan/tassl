// The `route_group` Sentry tag: docs/tech/13-observability-ops.md §2.5.
// Six values, because those are the six things the NFR-007 and NFR-008 alert rules are written
// against (13 §7): reads and writes have different latency budgets, Server Actions are measured
// with the writes, pages have their own, and `internal` is excluded from every rule because
// /api/health and /api/ready are polled once a minute.

export type RouteGroup = 'api_read' | 'api_write' | 'action' | 'page' | 'auth' | 'internal'

const INTERNAL_PREFIXES = ['/api/health', '/api/ready', '/api/internal/', '/sentry-tunnel']

/**
 * `pattern` is the route template (`/api/v1/runs/[runId]/lock`) or, for a Server Action, its name;
 * `method` is the HTTP method or `ACTION`.
 */
export function routeGroup(pattern: string, method: string): RouteGroup {
  if (method === 'ACTION') return 'action'
  if (INTERNAL_PREFIXES.some((prefix) => pattern === prefix || pattern.startsWith(prefix))) {
    return 'internal'
  }
  if (pattern === '/api/auth' || pattern.startsWith('/api/auth/')) return 'auth'
  if (pattern.startsWith('/api/')) return method === 'GET' ? 'api_read' : 'api_write'
  return 'page'
}
