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

export type { RateLimitDecision, RateLimiter } from '@/server/rate-limit/memory'
export { RATE_LIMITS, RATE_LIMIT_WINDOW_MS, type RateLimitBucket } from '@/server/rate-limit/limits'
