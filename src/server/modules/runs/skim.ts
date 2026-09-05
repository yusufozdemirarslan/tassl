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
import { isInTurnWindow, workingExpiresAt, type ClockRun } from './clock'

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
 * `decisionLockedAt` is here because the working clock is gone from `ClockRun`'s point of view once
 * the run leaves `working` — `workingExpiresAt` answers null — and a close can arrive after the
 * lock, which is the whole case the cap exists for.
 */
export type OpenRun = ClockRun & { decisionLockedAt: Date | null }

/**
 * The instant beyond which this run's clock can no longer have been running, or null when no clock
 * bounds the open.
 *
 * Three readings, in the order they are asked:
 *
 *   * inside the Turn window, the window's own end (D-132);
 *   * in `working` or `paused`, the instant the working clock reaches zero (D-042);
 *   * after the decision is locked, the instant it was locked — the working clock ended there.
 *
 * `framing` answers null, and correctly: the Evidence Room opens before the frame and there is no
 * clock running yet, so a long read while framing is a long read, not an overrun.
 */
export function clockEndsAt(run: OpenRun): Date | null {
  if (isInTurnWindow(run)) return run.turnWindowEndsAt
  return workingExpiresAt(run) ?? run.decisionLockedAt
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
  const endsAt = clockEndsAt(run)
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
