// How one document open is *read* back: the duration a close may record, and whether that duration
// counts as a skim (docs/tech/DECISIONS.md D-082; 10-backend-spec-modules.md §6; FR-022, FR-024,
// FR-117).
//
// Pure and total, like `./clock.ts`, `./state-machine.ts` and `./readiness.ts`: give it a row and
// two instants and it answers. The service commits what it answers, in the transaction that writes
// the `document_close` event, so the number stored on `run_document_opens` and the number in the
// trace are one number.
//
// **D-082's two constants are pilot parameters** in the sense `./limits.ts` gives the word — the PRD
// sets them from a pilot that has not run — but they are not bounds on a run, which is what that
// file holds: they are a reading rate, and they exist only to be read by the one rule below. D-082
// says "edit the constant"; this is the constant, beside the rule, so there is one place to edit.
import { workingClockEndsAt, type ClockRun } from './clock'

// ---------------------------------------------------------------------------------------------
// The skim threshold (D-082, FR-024, PRD §7.2 "Four-second opens")
// ---------------------------------------------------------------------------------------------

/**
 * The longest open that can ever be a skim (PRD §7.2: "four-second opens … reported as skimming").
 * Above four seconds nothing is read as a skim, however long the document is: the product does not
 * infer intent, and the further a threshold is pushed out the more it would be doing exactly that.
 */
export const SKIM_CEILING_MS = 4_000

/**
 * Four words a second (D-082), as milliseconds per word. It is deliberately a slow skim rate rather
 * than a reading rate: the question is not "did they read it", it is "was this open too short for
 * anything to have been read at all".
 */
export const READING_MS_PER_WORD = 250

/**
 * The duration below which an open of a document this long is marked `skim` (D-082):
 * `min(4000 ms, words × 250 ms)`.
 *
 * The `min` is what keeps a long document from raising the bar: a 280-word memo and a 2,000-word
 * agreement both settle at four seconds, and only a document short enough to be taken in faster
 * than that lowers it. A one-line document therefore has almost no skim window, which is right —
 * there is nothing there to skim.
 */
export function skimThresholdMs(wordCount: number): number {
  const words = Number.isFinite(wordCount) ? Math.max(0, Math.trunc(wordCount)) : 0
  return Math.min(SKIM_CEILING_MS, words * READING_MS_PER_WORD)
}

/**
 * Whether an open that lasted `openMs` on a document of `wordCount` words is a skim (FR-024).
 *
 * Strictly shorter than the threshold: "opens shorter than …" is the requirement's word, so an open
 * that lands exactly on the threshold is not one. Nothing here infers intent, and nothing here is
 * misconduct — the flag is one input to the Verification band and to the clock timeline's reading
 * segment, and the debrief's sentence for it is "opened briefly" (FR-024, CLAUDE.md).
 *
 * **`openMs` is how long the document was open, never the capped duration** (D-250). The two are
 * the same number whenever the clock was running for the whole open, and they part company exactly
 * where the cap bites — which is where reading the cap as a reading time invents a skim that never
 * happened. `readingOf` below is what pairs the two correctly; prefer it to calling this directly.
 */
export function isSkim(openMs: number, wordCount: number): boolean {
  return openMs < skimThresholdMs(wordCount)
}

// ---------------------------------------------------------------------------------------------
// The duration a close may record (10 §6, FR-117)
// ---------------------------------------------------------------------------------------------

/**
 * The run columns the cap reads: the clock's, plus the instant the decision was locked.
 *
 * `decisionLockedAt` is here because it is a boundary between two clock eras and `ClockRun` does not
 * carry it: it is where the working clock stopped and where the Turn delay's silence begins. With it
 * the three columns below — `working_started_at`, `decision_locked_at`, `turn_delivered_at` — divide
 * the run's whole life into eras an open can be placed in from its own instant (D-361).
 */
export type OpenRun = ClockRun & { decisionLockedAt: Date | null }

/**
 * The instant beyond which the clock *this open was running against* can no longer have been
 * running, or null when no clock bounds it.
 *
 * **The open's own instant picks the clock, and the run's state is not consulted at all** (D-361,
 * strengthening D-338). A run's life is a line of clock eras with the run's own instants as their
 * boundaries, and which era an open belongs to is settled the moment it begins; the state the run
 * happens to be in when the close finally arrives is a fact about the close, and a close may arrive
 * in any state at all (10 §6 gates it on nothing, which is what lets FR-117's shut laptop record
 * anything). D-338 fixed one direction of that — an open made *before* the Turn was delivered and
 * closed inside the window — by reading `turn_delivered_at`; but it kept `isInTurnWindow(run)` in
 * front of the test, so the mirror stayed open: once the run leaves `turn_open` the window's end
 * became unreachable and an open made *inside* the window fell through to a `decision_locked_at`
 * that is earlier than the open, which `cappedDurationMs` reads as "no clock" and records raw. So
 * the reading below asks the two boundary columns and nothing else, and a state added to the
 * machine tomorrow cannot reopen either direction of the hole.
 *
 * The eras, in the order they are asked:
 *
 *   * **the Turn window** — `openedAt >= turn_delivered_at`; the window's own end bounds it
 *     (D-132). This is the same fact `run_document_opens.in_turn_window` stores, read back from
 *     the two instants rather than from the column, so the two cannot disagree.
 *   * **the Turn delay** — `openedAt >= decision_locked_at`, before the delivery. **No clock runs
 *     here**: the working clock ended at the lock and the window has not opened (D-334), so nothing
 *     bounds the open and the answer is null. Answering the window's end instead would draw reading
 *     across the gap, which is the one thing this cap exists to prevent.
 *   * **the working clock** — everything earlier. It ended at `decision_locked_at` on a run that
 *     has filed a decision (that instant *is* the clock's zero when the auto-lock fired, and is
 *     earlier when the student filed first), and otherwise at its own zero, read from the columns
 *     so that a run parked in `paused` inside the window still answers the working clock's real end
 *     for an open it inherited from the working period rather than the later instant a resume would
 *     move it to.
 *
 * `framing` answers null through the same last line, and correctly: the Evidence Room opens before
 * the frame and there is no clock running yet, so a long read while framing is a long read, not an
 * overrun. Framing is not a gap between two clocks the way the Turn delay is — it is the prologue
 * to the only clock the run has — so an open carried out of it into `working` is still bounded by
 * that clock's end, which falls inside it (D-250).
 */
export function clockEndsAt(run: OpenRun, openedAt: Date): Date | null {
  const at = openedAt.getTime()
  if (run.turnDeliveredAt && at >= run.turnDeliveredAt.getTime()) return run.turnWindowEndsAt
  if (run.decisionLockedAt) {
    return at >= run.decisionLockedAt.getTime() ? null : run.decisionLockedAt
  }
  return workingClockEndsAt(run)
}

/**
 * The longest an open can be recorded as having lasted: a day (D-249).
 *
 * It is not a reading rate and it is not a bound on a run — it is the point past which "how long
 * was this document open" has stopped having an answer. Framing has no clock by design (the room
 * opens before the frame), so nothing else bounds an open made there, and a run left in `framing`
 * over a weekend is an ordinary thing: the student read the room on Friday, shut the laptop, and
 * came back on Monday to a document that had been "open" for three days. They were not reading it.
 *
 * A day is deliberately far past any sitting — it truncates no real read, not even one spread over
 * an evening — and short enough that everything past it is unambiguously absence rather than
 * reading. Nothing is inferred about the reading itself; the row keeps `opened_at` and `closed_at`
 * either way, so a record that hit this ceiling says so in the gap between them.
 *
 * It is also what makes `duration_ms` (`integer`, DATA-031) a total function of the two instants:
 * an uncapped elapsed time overflows int4 after about 24 days, and a run whose open is that old
 * cannot then be closed, cannot open another document, and cannot lock its frame — every writer
 * that closes an open computes this number, so the student is stuck for good on a Postgres 22003
 * that carries no code any screen can act on.
 */
export const ABANDONED_OPEN_MS = 86_400_000

/**
 * How long the document was open: `now − opened_at`, never negative, never past a day (D-249).
 *
 * This is the reading `isSkim` is asked about, and it is the ceiling on everything below it, so no
 * duration this file computes can leave int4 (`ABANDONED_OPEN_MS` above).
 */
export function openElapsedMs(openedAt: Date, now: Date): number {
  const elapsed = now.getTime() - openedAt.getTime()
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0
  return Math.min(elapsed, ABANDONED_OPEN_MS)
}

/**
 * What a close records as `duration_ms`: `min(now − opened_at, the clock remaining at the open)`
 * (10 §6), never negative and never past `ABANDONED_OPEN_MS`.
 *
 * The two forms of that rule are the same arithmetic. "The clock remaining at the open" is
 * `clockEndsAt − openedAt`, so capping the elapsed time at it is the same as ending the open at the
 * instant the clock ran out — which is how it is written here, because that is the sentence the
 * edge case makes: a student who closed the laptop during `working` (FR-117) comes back to a run
 * whose clock ran out an hour ago, and the document they left open is recorded as having been open
 * until the clock ended, not until they came back.
 *
 * **The clock's end replaces the close only when it falls inside the open** (D-250). What the cap
 * subtracts is the absence after the clock died, and an open that *began* after it died has no such
 * span to subtract: the clock was already gone, nothing about that reading was ever clocked, and
 * ending it before it started would record a read of any length as zero. It is reachable — a
 * working clock at zero auto-locks the decision (10 §8 branch 2), and until that branch lands the
 * run sits in `working` past its own zero with the Evidence Room still open — and a zero is not a
 * harmless number here: `isSkim(0, words)` is true of every document that has any words in it.
 *
 * A clock that is still running, or a run with no clock at all, caps nothing: the duration is the
 * elapsed time.
 */
export function cappedDurationMs(run: OpenRun, openedAt: Date, now: Date): number {
  const elapsed = openElapsedMs(openedAt, now)
  const endsAt = clockEndsAt(run, openedAt)
  if (endsAt === null || endsAt.getTime() <= openedAt.getTime()) return elapsed
  return Math.min(elapsed, endsAt.getTime() - openedAt.getTime())
}

/** What a close writes about one open: the two numbers, computed from the same two instants. */
export type ClosedReading = { durationMs: number; skim: boolean }

/**
 * How one open is read back (D-250): the duration the clock allows, and whether the open itself was
 * too short for anything to have been read.
 *
 * They are one call because they are two different questions about the same open and the answer to
 * the first is not an input to the second. `duration_ms` is bounded by the clock, because the clock
 * timeline may not draw reading over a period the clock was not running; `skim` is a fact about the
 * document and the time it was in front of the student, and taking it from the capped number is
 * what manufactures a skim out of a long read that the clock happened to outlive.
 */
export function readingOf(
  run: OpenRun,
  openedAt: Date,
  now: Date,
  wordCount: number,
): ClosedReading {
  return {
    durationMs: cappedDurationMs(run, openedAt, now),
    skim: isSkim(openElapsedMs(openedAt, now), wordCount),
  }
}
