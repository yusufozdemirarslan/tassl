import { describe, expect, it } from 'vitest'
import { createMemoryRateLimiter } from '@/server/rate-limit/memory'

const WINDOW = 1000

describe('memory rate limiter (two-window sliding count)', () => {
  it('allows up to the limit inside one window and refuses the next hit', async () => {
    const limiter = createMemoryRateLimiter(WINDOW)
    for (let i = 0; i < 3; i++) {
      const d = await limiter.hit('k', 3, 100)
      expect(d.allowed).toBe(true)
      expect(d.count).toBe(i)
    }
    const refused = await limiter.hit('k', 3, 100)
    expect(refused.allowed).toBe(false)
    expect(refused.count).toBe(3)
    expect(refused.retryAfterSeconds).toBe(1)
  })

  it('weights the previous window by the share of the current window still ahead', async () => {
    const limiter = createMemoryRateLimiter(WINDOW)
    for (let i = 0; i < 4; i++) await limiter.hit('k', 10, 100)
    // 500 ms into the next window: 4 × (1 − 0.5) = 2 carried over.
    const d = await limiter.hit('k', 10, 1500)
    expect(d.count).toBeCloseTo(2)
    // 900 ms in: 1 (current) + 4 × 0.1 = 1.4.
    const d2 = await limiter.hit('k', 10, 1900)
    expect(d2.count).toBeCloseTo(1.4)
  })

  it('forgets windows older than the previous one', async () => {
    const limiter = createMemoryRateLimiter(WINDOW)
    for (let i = 0; i < 5; i++) await limiter.hit('k', 5, 100)
    const d = await limiter.hit('k', 5, 2500) // two windows later
    expect(d.count).toBe(0)
    expect(d.allowed).toBe(true)
  })

  it('reports seconds until the next window as Retry-After', async () => {
    const limiter = createMemoryRateLimiter(60_000)
    const d = await limiter.hit('k', 1, 60_000 * 7 + 12_345)
    expect(d.retryAfterSeconds).toBe(48) // ceil((60000 − 12345) / 1000)
  })

  it('keeps keys independent', async () => {
    const limiter = createMemoryRateLimiter(WINDOW)
    await limiter.hit('a', 1, 100)
    expect((await limiter.hit('a', 1, 100)).allowed).toBe(false)
    expect((await limiter.hit('b', 1, 100)).allowed).toBe(true)
  })
})
