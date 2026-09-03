// getRateLimiter() returns the process-wide limiter. Memory-backed until Step 2.8 swaps in the
// Postgres sliding window (docs/tech/10-backend-spec.md §4) outside unit tests.
import { createMemoryRateLimiter, type RateLimiter } from '@/server/rate-limit/memory'

let limiter: RateLimiter | undefined

export function getRateLimiter(): RateLimiter {
  limiter ??= createMemoryRateLimiter()
  return limiter
}

export type { RateLimitDecision, RateLimiter } from '@/server/rate-limit/memory'
export { RATE_LIMITS, RATE_LIMIT_WINDOW_MS, type RateLimitBucket } from '@/server/rate-limit/limits'
