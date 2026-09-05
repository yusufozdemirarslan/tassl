// The run clock (docs/tech/10-backend-spec.md §10, D-042, D-132, D-133).
//
// Timers are server timestamps materialized lazily on read (ADR-019): nothing counts down anywhere,
// and the remaining time is arithmetic over the run row's own columns. That makes every function
// here pure and total — give it a row and an instant, it answers — which is what lets the trace
// stamp `clock_remaining_ms` on an event whose `occurred_at` is an expiry instant in the past.
//
// Step 6.1 needed the reading half, because `trace.append` stores the clock reading on every event
// it writes. Step 6.2 adds the writing half — `chargeCost`, `credit`, `pause`, `resume` — and
// `tests/unit/runs/clock.test.ts` covers both.
//
// The writing half returns column patches rather than mutating the row 10 §10 sketches it mutating.
// A patch is what `runs.repository.updateRun` takes, and it keeps every function here pure: the
// service composes the patch with the rest of its update and commits once, so the clock can never
// be half-written by a transaction that then rolls back.
//
// The input is structural rather than the Drizzle `Run` row: a module-internal file may not import
// `src/server/db` (04 §2), and a pure function of ten columns has no business asking for forty.
import { clockExpired, noClockRunning, turnWindowExpired } from './errors'

/** The run columns the clock reads. A `Run` row satisfies it; so does a test's literal. */
export type ClockRun = {
  state: string
  workingClockSeconds: number
  /** Set at frame lock; before it there is no working clock at all. */
  workingStartedAt: Date | null
  pausedAt: Date | null
  totalPausedMs: number
  creditedMs: number
  chargedMs: number
  turnDeliveredAt: Date | null
  turnWindowEndsAt: Date | null
  turnLockedAt: Date | null
}

/** The two states in which the working clock runs (D-042). */
const WORKING_STATES: readonly string[] = ['working', 'paused']

/**
 * Milliseconds left on the working clock at `now`, or null when the run has no working clock —
 * before the frame is locked, and after the decision is locked (D-042):
 *
 *   `working_clock_seconds*1000 − (now − working_started_at) + total_paused_ms
 *    + (paused_at ? now − paused_at : 0) + credited_ms − charged_ms`
 *
 * The result may be negative: a read that arrives after expiry reports how far past it is, and
 * `materializeTimers` (10 §8) is what turns that into an auto-lock. Callers that need a floor
 * clamp it themselves; storing the true number keeps the trace honest about when a write landed.
 */
export function remainingMs(run: ClockRun, now: Date = new Date()): number | null {
  if (!run.workingStartedAt) return null
  if (!WORKING_STATES.includes(run.state)) return null
  const elapsed = now.getTime() - run.workingStartedAt.getTime()
  const pausedNow = run.pausedAt ? now.getTime() - run.pausedAt.getTime() : 0
  return (
    run.workingClockSeconds * 1000 -
    elapsed +
    run.totalPausedMs +
    pausedNow +
    run.creditedMs -
    run.chargedMs
  )
}

/**
 * The instant the working clock reaches zero, or null when the run has no working clock.
 *
 * It is `remainingMs` solved for the instant that makes it zero — `working_started_at +
 * working_clock_seconds*1000 + total_paused_ms + credited_ms − charged_ms` — and the two must stay
 * each other's inverse: `remainingMs(run, workingExpiresAt(run))` is zero for every run in
 * `working`. That is what lets `materializeTimers` stamp the auto-lock at the moment the clock ran
 * out rather than at the moment somebody next looked (10 §8, NFR-002), and what lets a read decide
 * whether a timer is pending without taking the writer's lock (`./timers.ts`).
 *
 * A paused run answers the instant its clock *would* reach zero if it resumed now, which is not a
 * deadline: `nextTimer` reads the state and returns nothing for `paused`, because the clock is
 * frozen (FR-001).
 */
export function workingExpiresAt(run: ClockRun): Date | null {
  if (!run.workingStartedAt) return null
  if (!WORKING_STATES.includes(run.state)) return null
  return new Date(
    run.workingStartedAt.getTime() +
      run.workingClockSeconds * 1000 +
      run.totalPausedMs +
      run.creditedMs -
      run.chargedMs,
  )
}

/**
 * Milliseconds left in the Turn window at `now`, or null when no window is open (D-132):
 * `turn_window_ends_at − now + (paused ? now − paused_at : 0)`.
 *
 * The open paused span is *added back*, the way the working clock adds it back (D-042), because a
 * pause inside the window freezes it (D-133, FR-001). 10 §10 writes this term with a minus sign,
 * which is a slip: subtracting it makes the window run down at twice the rate while a component
 * failure is being waited out, so a two-minute outage would cost four minutes of the student's
 * window and `resumeRun` — which moves `turn_window_ends_at` out by the paused span — would make
 * the number jump. With the sign corrected the reading is constant across the pause and unchanged
 * by the resume, which is what "the clock stops" means. D-223; the spec line is corrected with it.
 */
export function remainingWindowMs(run: ClockRun, now: Date = new Date()): number | null {
  if (!run.turnWindowEndsAt) return null
  if (!isInTurnWindow(run)) return null
  const pausedNow = run.pausedAt ? now.getTime() - run.pausedAt.getTime() : 0
  return run.turnWindowEndsAt.getTime() - now.getTime() + pausedNow
}

/**
 * True while the Turn window is the clock that is running: the run is in `turn_open`, or it is
 * `paused` from inside the window (D-133).
 *
 * A paused run does not record which clock it paused, so the window is derived from the timers the
 * Turn sets: the Turn was delivered and its response is not yet locked. Those two are exactly the
 * span `turn_open` covers, and `turn_locked_at` is stamped by the transition out of it.
 */
export function isInTurnWindow(run: ClockRun): boolean {
  if (run.state === 'turn_open') return true
  if (run.state !== 'paused') return false
  return run.turnDeliveredAt !== null && run.turnLockedAt === null
}

// ---------------------------------------------------------------------------------------------
// The writing half (10 §10): pause, resume, credit, charge
//
// Each returns the columns to write, and nothing else. `chargeCost` and `resume` also answer the
// number the caller has to record — the cost actually applied, the milliseconds spent paused —
// because the events those two write carry it (`action.clock_cost_ms`, `resume.paused_ms`).
// ---------------------------------------------------------------------------------------------

/** The clock columns a write touches; the shape `runs.repository.updateRun` is given. */
export type ClockPatch = {
  pausedAt?: Date | null
  totalPausedMs?: number
  creditedMs?: number
  chargedMs?: number
  turnWindowEndsAt?: Date
}

/**
 * Freezes the clock at `now` (FR-001). Whichever clock is running — the working clock or the Turn
 * window — stops, because both subtract the open paused span (`remainingMs`, `remainingWindowMs`).
 */
export function pause(run: ClockRun, now: Date = new Date()): ClockPatch {
  if (run.pausedAt) return {}
  return { pausedAt: now }
}

/**
 * Restarts the clock and gives back the time the pause took (FR-001, D-133).
 *
 * A pause on the working clock is repaid into `total_paused_ms`; a pause inside the Turn window is
 * repaid by moving `turn_window_ends_at` out by the same span, because the window is an instant,
 * not a budget. It is one or the other, never both: only one clock is ever running.
 *
 * `pausedMs` is the span the `resume` event records. Resuming a run that is not paused is a no-op
 * with `pausedMs: 0` rather than an error — the student's overlay and a materialized timer can both
 * arrive at it, and the second one has nothing left to do.
 */
export function resume(
  run: ClockRun,
  now: Date = new Date(),
): { patch: ClockPatch; pausedMs: number } {
  if (!run.pausedAt) return { patch: {}, pausedMs: 0 }
  const pausedMs = Math.max(0, now.getTime() - run.pausedAt.getTime())
  if (isInTurnWindow(run) && run.turnWindowEndsAt) {
    return {
      patch: {
        pausedAt: null,
        turnWindowEndsAt: new Date(run.turnWindowEndsAt.getTime() + pausedMs),
      },
      pausedMs,
    }
  }
  return { patch: { pausedAt: null, totalPausedMs: run.totalPausedMs + pausedMs }, pausedMs }
}

/**
 * Gives time back to the working clock (FR-001): the cost of an action that failed is credited on
 * resume, so a component failure never costs the student anything. Credits are additive and are
 * never taken away, which is what keeps `remaining` reconstructible from the row alone.
 */
export function credit(run: ClockRun, ms: number): ClockPatch {
  if (ms <= 0) return {}
  return { creditedMs: run.creditedMs + ms }
}

/**
 * Charges an action's cost against whichever clock is running, at the moment the action starts
 * (FR-070, FR-071, D-132), and answers how much was actually taken.
 *
 * Two rules meet here. FR-072 says an action that started with time left completes, so the cost is
 * never a reason to refuse an action that had a clock; and the clock a student reads never runs
 * below zero, so the applied cost is capped at what was left. The cap is the whole of the
 * difference: a Decomposition Check begun with one minute left costs one minute, not four, and the
 * clock lands exactly on zero, where `materializeTimers` auto-locks the decision (10 §8).
 *
 * A clock with nothing left refuses before the action starts — `CLOCK_EXPIRED` for the working
 * clock, `TURN_WINDOW_EXPIRED` for the window — which is the assertion 10 §10 asks for. A run with
 * no clock running at all is a caller defect, not a refusal, and says so.
 */
export function chargeCost(
  run: ClockRun,
  costMs: number,
  now: Date = new Date(),
): { patch: ClockPatch; appliedMs: number; remainingMsBefore: number } {
  const inWindow = isInTurnWindow(run)
  const before = inWindow ? remainingWindowMs(run, now) : remainingMs(run, now)
  if (before === null) noClockRunning(run.state)
  if (before <= 0) (inWindow ? turnWindowExpired : clockExpired)()

  const appliedMs = Math.max(0, Math.min(costMs, before))
  if (inWindow && run.turnWindowEndsAt) {
    return {
      patch: { turnWindowEndsAt: new Date(run.turnWindowEndsAt.getTime() - appliedMs) },
      appliedMs,
      remainingMsBefore: before,
    }
  }
  return { patch: { chargedMs: run.chargedMs + appliedMs }, appliedMs, remainingMsBefore: before }
}
