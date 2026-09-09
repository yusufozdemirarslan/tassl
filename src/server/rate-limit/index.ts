// getRateLimiter() returns the process-wide limiter: the Postgres sliding window
// (docs/tech/10-backend-spec.md §4) everywhere except under APP_ENV=test, where the route and
// action wrappers use the memory limiter so unit tests never need a database; the Postgres
// implementation is exercised directly by tests/integration/rate-limit (D-164).
import { env } from '@/server/config'
import { createMemoryRateLimiter, type RateLimiter } from '@/server/rate-limit/memory'
import { createPostgresRateLimiter } from '@/server/rate-limit/sliding-window'

let limiter: RateLimiter | undefined

export function getRateLimiter(): RateLimiter {
  limiter ??= env.APP_ENV === 'test' ? createMemoryRateLimiter() : createPostgresRateLimiter()
  return limiter
}

/**
 * Test seam: drops the process-wide limiter so the next call builds a fresh one. The memory limiter
 * under `APP_ENV=test` outlives `truncateAll()`, which empties tables and not maps, and the
 * per-account sign-in lockout (D-704) would otherwise carry one test's failed attempts into the
 * next. Nothing in the application calls it.
 */
export function resetRateLimiter(): void {
  limiter = undefined
}

export type { RateLimitDecision, RateLimiter } from '@/server/rate-limit/memory'
export { RATE_LIMITS, RATE_LIMIT_WINDOW_MS, type RateLimitBucket } from '@/server/rate-limit/limits'
