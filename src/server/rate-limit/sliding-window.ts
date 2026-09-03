// Postgres two-bucket sliding window on rate_limit_buckets (docs/tech/10-backend-spec.md §4,
// SYS-012). One statement records the hit and reads both buckets; the weighted count that decides
// the request excludes the hit being recorded, matching the memory limiter used in tests.
import { sql } from 'drizzle-orm'
import { db } from '@/server/db/client'
import { RATE_LIMIT_WINDOW_MS } from '@/server/rate-limit/limits'
import type { RateLimitDecision, RateLimiter } from '@/server/rate-limit/memory'

type Row = { current_count: number | string; previous_count: number | string }

const CLEANUP_EVERY = 100

export function createPostgresRateLimiter(windowMs = RATE_LIMIT_WINDOW_MS): RateLimiter {
  let calls = 0

  return {
    async hit(key, limit, now = Date.now()): Promise<RateLimitDecision> {
      const current = Math.floor(now / windowMs)
      const previous = current - 1
      const elapsedShare = (now - current * windowMs) / windowMs
      // postgres-js serializes raw parameters as text, so the window starts travel as ISO strings.
      const currentStart = new Date(current * windowMs).toISOString()
      const previousStart = new Date(previous * windowMs).toISOString()

      const result = await db.execute<Row>(sql`
        with hit as (
          insert into rate_limit_buckets (key, window_start, count)
          values (${key}, ${currentStart}::timestamptz, 1)
          on conflict (key, window_start) do update set count = rate_limit_buckets.count + 1
          returning count
        )
        select
          (select count from hit) as current_count,
          coalesce(
            (select count from rate_limit_buckets
              where key = ${key} and window_start = ${previousStart}::timestamptz),
            0
          ) as previous_count`)
      const row = (Array.isArray(result) ? result[0] : undefined) as Row | undefined
      const currentCount = Number(row?.current_count ?? 1)
      const previousCount = Number(row?.previous_count ?? 0)

      // Weighted count before this hit was recorded.
      const count = currentCount - 1 + previousCount * (1 - elapsedShare)
      const allowed = count < limit

      if (++calls % CLEANUP_EVERY === 0) {
        const horizon = new Date(now - 3 * windowMs).toISOString()
        await db.execute(
          sql`delete from rate_limit_buckets where window_start < ${horizon}::timestamptz`,
        )
      }

      const retryAfterSeconds = Math.max(1, Math.ceil(((current + 1) * windowMs - now) / 1000))
      return { allowed, count, limit, retryAfterSeconds }
    },
  }
}
