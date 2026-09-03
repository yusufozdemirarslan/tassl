// Step 2.8 (SYS-012, 10 §4): the Postgres sliding window admits `limit` hits per window and weights
// the previous window by the share of the current window still ahead.
import { afterEach, describe, expect, it } from 'vitest'
import { RATE_LIMIT_WINDOW_MS } from '@/server/rate-limit/limits'
import { createPostgresRateLimiter } from '@/server/rate-limit/sliding-window'
import { truncateAll } from '@tests/setup/integration'

const WINDOW = RATE_LIMIT_WINDOW_MS

describe('postgres sliding-window rate limiter', () => {
  afterEach(async () => {
    await truncateAll()
  })

  it('allows 60 writes in a window and refuses the 61st with a Retry-After', async () => {
    const limiter = createPostgresRateLimiter()
    const key = `write:${crypto.randomUUID()}`
    const start = Math.floor(Date.now() / WINDOW) * WINDOW + 1_000
    for (let i = 0; i < 60; i++) {
      const decision = await limiter.hit(key, 60, start + i)
      expect(decision.allowed, `hit ${i + 1}`).toBe(true)
    }
    const refused = await limiter.hit(key, 60, start + 60)
    expect(refused.allowed).toBe(false)
    expect(refused.count).toBeGreaterThanOrEqual(60)
    expect(refused.retryAfterSeconds).toBeGreaterThan(0)
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60)
  })

  it('weights the previous window by the time left in the current one', async () => {
    const limiter = createPostgresRateLimiter()
    const key = `read:${crypto.randomUUID()}`
    const windowStart = Math.floor(Date.now() / WINDOW) * WINDOW
    // Ten hits late in the previous window.
    for (let i = 0; i < 10; i++) await limiter.hit(key, 100, windowStart - 5_000 + i)
    // Half-way through the current window the previous window counts for half: 10 × 0.5 = 5.
    const midway = await limiter.hit(key, 100, windowStart + WINDOW / 2)
    expect(midway.count).toBeCloseTo(5, 1)
    // Near the end of the current window it has almost faded: 1 (the midway hit) + 10 × ~0.017.
    const late = await limiter.hit(key, 100, windowStart + WINDOW - 1_000)
    expect(late.count).toBeGreaterThan(1)
    expect(late.count).toBeLessThan(1.5)
  })

  it('keys are independent', async () => {
    const limiter = createPostgresRateLimiter()
    const now = Date.now()
    await limiter.hit('llm:a', 1, now)
    const other = await limiter.hit('llm:b', 1, now)
    expect(other.allowed).toBe(true)
    const again = await limiter.hit('llm:a', 1, now + 1)
    expect(again.allowed).toBe(false)
  })
})
