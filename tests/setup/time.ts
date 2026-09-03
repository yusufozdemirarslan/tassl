import { vi } from 'vitest'

/** Stable "now" for tests that read the clock. */
export const FROZEN_TIME = new Date('2026-09-01T12:00:00.000Z')

/** Opt-in fake timers frozen at `now`; returns the restore function (also run by afterEach). */
export function withFrozenTime(now: Date = FROZEN_TIME): () => void {
  vi.useFakeTimers({ now })
  return () => vi.useRealTimers()
}
