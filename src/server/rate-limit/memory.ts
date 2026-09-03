// In-memory two-window sliding limiter with the arithmetic of docs/tech/10-backend-spec.md §4.
// Used until Step 2.8 adds the Postgres limiter (and by unit tests afterwards).
import { RATE_LIMIT_WINDOW_MS } from '@/server/rate-limit/limits'

export type RateLimitDecision = {
  allowed: boolean
  /** Weighted count before this hit was recorded. */
  count: number
  limit: number
  /** Seconds until the next window starts; the Retry-After value when refused. */
  retryAfterSeconds: number
}

export type RateLimiter = {
  hit(key: string, limit: number, now?: number): Promise<RateLimitDecision>
}

type Windows = Map<number, number> // window index -> count

export function createMemoryRateLimiter(windowMs = RATE_LIMIT_WINDOW_MS): RateLimiter {
  const store = new Map<string, Windows>()
  let calls = 0

  const sweep = (current: number) => {
    for (const [key, windows] of store) {
      for (const w of windows.keys()) if (w < current - 1) windows.delete(w)
      if (windows.size === 0) store.delete(key)
    }
  }

  return {
    async hit(key, limit, now = Date.now()) {
      const current = Math.floor(now / windowMs)
      const previous = current - 1
      const elapsedShare = (now - current * windowMs) / windowMs

      let windows = store.get(key)
      if (!windows) {
        windows = new Map()
        store.set(key, windows)
      }
      const count = (windows.get(current) ?? 0) + (windows.get(previous) ?? 0) * (1 - elapsedShare)
      const allowed = count < limit

      // Recorded whether or not it was allowed, like the SQL upsert in the Postgres limiter.
      windows.set(current, (windows.get(current) ?? 0) + 1)
      for (const w of windows.keys()) if (w < previous) windows.delete(w)
      if (++calls % 100 === 0) sweep(current)

      const retryAfterSeconds = Math.max(1, Math.ceil(((current + 1) * windowMs - now) / 1000))
      return { allowed, count, limit, retryAfterSeconds }
    },
  }
}
