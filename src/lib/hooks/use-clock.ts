'use client'

import { useEffect, useState } from 'react'

// The countdown half of D-042 / ADR-019: **timers are server timestamps, and the browser only
// displays them.** Nothing here decides when a clock ends, and nothing here reports an expiry to
// the server — `materializeTimers` does that on the next read, which is what makes an expiry
// identical whether the student's tab was open, asleep or closed.
//
// The hook counts down to a *deadline*, and it makes that deadline once, from the server's own
// reading, at the instant the reading reaches the browser. A duration the browser keeps counting
// down itself drifts: a background tab throttles its timers, a laptop suspends, and after ten
// minutes the number on the screen is the browser's opinion rather than the run's. A deadline does
// not drift, because every tick re-reads the wall clock and subtracts. Re-anchoring is not the
// browser's decision either: a new reading arrives every five seconds from `useRunPoll`, and each
// one replaces the deadline the last one made.
//
// Anchoring a *reading* rather than parsing an *instant* is also what makes the clock independent
// of the browser's own time being set correctly: only the rate matters, never the offset. Where the
// server names an instant instead — `readiness.expiresAt`, `turn.windowEndsAt` — the caller
// subtracts `Date.now()` from it once and hands the difference over as a reading, which is the same
// shape.
//
// `frozen` is the paused run and the very first paint, together: both are "show the number the
// server gave and do not count". One branch, not two.

export type ClockReading = {
  /** Milliseconds left when the server answered. */
  remainingMs: number
  /** The clock is stopped (a paused run, FR-001): show this reading and do not tick. */
  frozen: boolean
}

/** One second, as the display steps. */
const SECOND_MS = 1000

/** What the last tick saw, and which reading it was anchored from. */
type Tick = { source: number; deadline: number; now: number }

/**
 * Milliseconds left, floored at zero and stepping once per displayed second; null when there is no
 * clock at all.
 *
 * The tick is a self-correcting `setTimeout` rather than a one-second interval: it wakes exactly
 * when the *displayed* second would change and re-reads the wall clock each time, so a throttled or
 * suspended tab catches up in one step instead of accumulating a second of lag per skipped frame.
 * The clock updates once per second with no animation (DESIGN.md §The clock).
 *
 * Until the first tick of a reading has run — the server render, the paint that hydrates it, and
 * the moment just after a new reading lands — the answer is the server's own number. That is what
 * keeps the first client paint identical to the HTML it hydrated, and it is never more than one
 * second behind.
 */
export function useClock(reading: ClockReading | null): number | null {
  const remainingMs = reading === null ? null : reading.remainingMs
  const frozen = reading === null ? true : reading.frozen
  const [tick, setTick] = useState<Tick | null>(null)

  useEffect(() => {
    if (remainingMs === null || frozen) return

    // The anchor: this reading, at the instant it reached the browser.
    const deadline = Date.now() + remainingMs
    let timer: ReturnType<typeof setTimeout> | undefined

    const step = (): void => {
      const now = Date.now()
      setTick({ source: remainingMs, deadline, now })
      const left = deadline - now
      if (left <= 0) return
      // Land on the instant the displayed second changes, never a fixed second after this one.
      const untilNextSecond = left % SECOND_MS
      timer = setTimeout(step, untilNextSecond === 0 ? SECOND_MS : untilNextSecond)
    }

    // Scheduled, never called here: a synchronous first tick would be a render cascade out of an
    // effect, and there is nothing to correct yet — the reading is exactly what is on the screen.
    const first = (deadline - Date.now()) % SECOND_MS
    timer = setTimeout(step, first === 0 ? SECOND_MS : first)

    return () => {
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [remainingMs, frozen])

  if (reading === null) return null
  if (frozen || tick === null || tick.source !== reading.remainingMs) {
    return Math.max(0, reading.remainingMs)
  }
  return Math.max(0, tick.deadline - tick.now)
}

/**
 * `mm:ss` from milliseconds, rounded up so the clock reads its full length for the whole of its
 * first second and reaches `00:00` at the instant it runs out rather than a second before.
 *
 * Minutes are not wrapped into hours: a working clock is set in minutes and a reader counting down
 * from `75:00` never has to convert. The digits are drawn in Mono with tabular figures by the
 * component, so nothing shifts as they change (DESIGN.md §The Tabular Clock Rule).
 */
export function formatClock(ms: number): string {
  const seconds = clockSeconds(ms)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

/** Whole seconds left, floored at zero: what the thresholds and the announcements are read from. */
export function clockSeconds(ms: number): number {
  return Math.max(0, Math.ceil(ms / SECOND_MS))
}
