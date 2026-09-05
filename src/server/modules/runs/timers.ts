// When a run's timers fire (docs/tech/10-backend-spec.md §8, ADR-019).
//
// This file answers one question and writes nothing: *given this run row, what is the next thing
// the clock makes true, and at what instant?* It exists because the answer is needed twice, in two
// places that must not disagree.
//
//   * `materializeTimersTx` in `./service.ts` applies the branch, inside the caller's transaction
//     with the run row locked.
//   * every read asks first, so that it only takes that lock when there is something to write.
//
// The second is the reason this is a separate, pure function rather than a `select … for update`.
// `GET /runs/{runId}` is polled every five seconds by every open run screen, and by every reviewer
// watching one; a row-exclusive lock on each of those polls would queue every reader behind the
// run's own writer while holding one of the five pooled connections (NFR-008, D-042). A run whose
// next timer is still in the future has nothing to materialize, and the arithmetic that says so is
// the arithmetic in this file — nine columns and no database.
//
// The instant is computed from the run's own columns, never from `now`, so a branch materialized
// long after it fired still stamps the moment it fired (NFR-002). That is why `nextTimer` answers
// `{ branch, at }` rather than a boolean: the applier needs the instant, not the discovery.
//
// The input is structural rather than the Drizzle `Run` row, for the reason `./clock.ts` gives: a
// module-internal file may not import `src/server/db` (04 §2).
import { workingExpiresAt, type ClockRun } from './clock'

/**
 * The five branches of 10 §8, less `paused` — which is the absence of a timer rather than one of
 * them, because a paused clock is frozen (FR-001).
 */
export type TimerBranch =
  /** `readiness`: the check's eight minutes ran out; unanswered items submit as `unknown` (FR-010). */
  | 'readiness_expired'
  /** `working`: the working clock reached zero and the decision auto-locks (FR-102, FR-117). */
  | 'decision_auto_lock'
  /** `decision_locked`: `turn_due_at` arrived and the Turn is delivered (FR-110). */
  | 'turn_delivery'
  /** `turn_open`: the twelve-minute window ran out and the response locks as an implicit hold (FR-115). */
  | 'turn_window_expired'

/** The run columns a timer reads: the clock's, plus the two deadlines the run stores outright. */
export type TimerRun = ClockRun & {
  readinessExpiresAt: Date | null
  turnDueAt: Date | null
}

/** A timer and the instant it fires. */
export type Timer = { branch: TimerBranch; at: Date }

/**
 * The next timer this run is waiting on, or null when it is waiting on none.
 *
 * At most one is ever pending, because each belongs to a single state and a run is in one state: a
 * run in `working` is not also waiting for its Turn. `paused` answers null whichever clock it froze
 * (10 §8 branch 5), and so does every state past the Turn — nothing after `turn_locked` is timed in
 * this build.
 */
export function nextTimer(run: TimerRun): Timer | null {
  switch (run.state) {
    case 'readiness':
      return run.readinessExpiresAt
        ? { branch: 'readiness_expired', at: run.readinessExpiresAt }
        : null
    case 'working': {
      const at = workingExpiresAt(run)
      return at ? { branch: 'decision_auto_lock', at } : null
    }
    case 'decision_locked':
      return run.turnDueAt ? { branch: 'turn_delivery', at: run.turnDueAt } : null
    case 'turn_open':
      return run.turnWindowEndsAt
        ? { branch: 'turn_window_expired', at: run.turnWindowEndsAt }
        : null
    default:
      return null
  }
}

/** Whether the run's next timer has already fired at `now`. */
export function hasTimerFired(run: TimerRun, now: Date = new Date()): boolean {
  const timer = nextTimer(run)
  return timer !== null && timer.at.getTime() <= now.getTime()
}
