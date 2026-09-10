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
 * Limiters that are not this one.
 *
 * A window with its own size cannot share the process-wide limiter, so a module builds its own —
 * the data export's two an hour is the one there is (`modules/identity/service.ts`). Those
 * instances used to be invisible to the reset below, which is how a guide chain that empties every
 * window between engines still met a 429 on the third engine's data export, with the reset route's
 * own comment claiming it had emptied that very window. A module registers its reset here rather
 * than the reset reaching into modules: infrastructure stays underneath the modules that use it.
 */
const alsoReset = new Set<() => void>()

/** Registered at module load by anything holding a limiter of its own (D-728). */
export function registerLimiterReset(reset: () => void): void {
  alsoReset.add(reset)
}

/**
 * Test seam: drops the process-wide limiter so the next call builds a fresh one, and every limiter
 * registered above with it. The memory limiter under `APP_ENV=test` outlives `truncateAll()`, which
 * empties tables and not maps, and the per-account sign-in lockout (D-704) would otherwise carry
 * one test's failed attempts into the next. Nothing in the application calls it.
 */
export function resetRateLimiter(): void {
  limiter = undefined
  for (const reset of alsoReset) reset()
}

export type { RateLimitDecision, RateLimiter } from '@/server/rate-limit/memory'
export { RATE_LIMITS, RATE_LIMIT_WINDOW_MS, type RateLimitBucket } from '@/server/rate-limit/limits'
