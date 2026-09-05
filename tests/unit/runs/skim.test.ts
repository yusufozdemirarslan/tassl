// Step 6.4 — how a document open is read back (docs/tech/DECISIONS.md D-082; FR-022, FR-024,
// FR-117; 10-backend-spec-modules.md §6).
//
// Three rules, all pure, and all stated here against the numbers rather than against the code: the
// skim threshold is `min(4000 ms, words × 250 ms)`; a close records
// `min(now − opened_at, the clock remaining at the open)`, bounded by a day (D-249); and the skim
// flag is read from how long the document was open rather than from that capped number (D-250).
//
// The word-count table is the point of the first half. D-082 scales the threshold by length, and
// the `min` means that scaling only ever *lowers* it — a nine-word note has a 2.25-second window and
// a 2,000-word supply agreement has the same four seconds a 280-word memo does. Every row below is
// a real length from the Meridian Roast room or an edge of the formula.
import { describe, expect, it } from 'vitest'
import type { ClockRun } from '@/server/modules/runs/clock'
import {
  ABANDONED_OPEN_MS,
  READING_MS_PER_WORD,
  SKIM_CEILING_MS,
  cappedDurationMs,
  clockEndsAt,
  isSkim,
  openElapsedMs,
  readingOf,
  skimThresholdMs,
  type OpenRun,
} from '@/server/modules/runs/skim'

const T0 = new Date('2026-09-05T10:00:00.000Z')
const at = (ms: number): Date => new Date(T0.getTime() + ms)
const MINUTE = 60_000

describe('skimThresholdMs (D-082)', () => {
  it('is four seconds for any document long enough to take four seconds to skim', () => {
    // The ceiling bites from sixteen words up (16 × 250 ms = 4,000 ms), so every document in a real
    // Evidence Room — 6 to 12 documents of up to 2,000 words (FR-021, D-081) — sits exactly here.
    for (const words of [16, 186, 233, 280, 328, 2000]) {
      expect(skimThresholdMs(words)).toBe(SKIM_CEILING_MS)
    }
  })

  it('scales down with length below the ceiling, at four words a second', () => {
    expect(READING_MS_PER_WORD).toBe(250)
    expect(skimThresholdMs(1)).toBe(250)
    expect(skimThresholdMs(9)).toBe(2_250)
    expect(skimThresholdMs(15)).toBe(3_750)
    // The join is exact: at sixteen words the two branches of the `min` agree.
    expect(skimThresholdMs(16)).toBe(4_000)
  })

  it('is zero for an empty document, so nothing about one is a skim', () => {
    expect(skimThresholdMs(0)).toBe(0)
    expect(isSkim(0, 0)).toBe(false)
  })

  it('treats a missing or nonsense count as zero rather than throwing', () => {
    expect(skimThresholdMs(-40)).toBe(0)
    expect(skimThresholdMs(Number.NaN)).toBe(0)
    expect(skimThresholdMs(12.7)).toBe(3_000)
  })
})

describe('isSkim (FR-024)', () => {
  it('marks the four-second open of a full-length document', () => {
    expect(isSkim(3_999, 280)).toBe(true)
    expect(isSkim(1_200, 280)).toBe(true)
  })

  it('does not mark an open that lands exactly on the threshold', () => {
    // "Opens shorter than …" is the requirement's word, so the boundary is not a skim.
    expect(isSkim(4_000, 280)).toBe(false)
    expect(isSkim(2_250, 9)).toBe(false)
  })

  it('does not mark a two-second open of a six-word note', () => {
    // The same two seconds is a skim of the board deck and a read of the note. That is the whole
    // reason the threshold scales: the flag is about the document, never about the student.
    expect(isSkim(2_000, 6)).toBe(false)
    expect(isSkim(2_000, 280)).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// The cap (10 §6, FR-117)
// ---------------------------------------------------------------------------------------------

const clock = (overrides: Partial<ClockRun> = {}): ClockRun => ({
  state: 'working',
  workingClockSeconds: 1500,
  workingStartedAt: T0,
  pausedAt: null,
  totalPausedMs: 0,
  creditedMs: 0,
  chargedMs: 0,
  turnDeliveredAt: null,
  turnWindowEndsAt: null,
  turnLockedAt: null,
  ...overrides,
})

const open = (overrides: Partial<OpenRun> = {}): OpenRun => ({
  ...clock(),
  decisionLockedAt: null,
  ...overrides,
})

describe('clockEndsAt', () => {
  it('is the working clock’s zero while the run is working', () => {
    expect(clockEndsAt(open())).toEqual(at(25 * MINUTE))
  })

  it('is null while the run is framing: the room opens before the clock starts', () => {
    expect(clockEndsAt(open({ state: 'framing', workingStartedAt: null }))).toBeNull()
  })

  it('is the lock instant once the decision is locked', () => {
    const lockedAt = at(20 * MINUTE)
    expect(
      clockEndsAt(
        open({ state: 'decision_locked', workingStartedAt: T0, decisionLockedAt: lockedAt }),
      ),
    ).toEqual(lockedAt)
  })

  it('is the window’s end inside the Turn window', () => {
    const windowEndsAt = at(40 * MINUTE)
    expect(
      clockEndsAt(
        open({
          state: 'turn_open',
          turnDeliveredAt: at(28 * MINUTE),
          turnWindowEndsAt: windowEndsAt,
          decisionLockedAt: at(25 * MINUTE),
        }),
      ),
    ).toEqual(windowEndsAt)
  })
})

describe('cappedDurationMs (10 §6, FR-117)', () => {
  it('is the elapsed time while the clock is still running', () => {
    expect(cappedDurationMs(open(), at(2 * MINUTE), at(6 * MINUTE))).toBe(4 * MINUTE)
  })

  it('is uncapped during framing, where no clock is running yet', () => {
    const framing = open({ state: 'framing', workingStartedAt: null })
    expect(cappedDurationMs(framing, T0, at(90 * MINUTE))).toBe(90 * MINUTE)
  })

  it('caps a read that outlived the working clock at what the clock had left (FR-117)', () => {
    // The laptop closed twenty minutes in, with five minutes left, and reopened the next morning.
    const openedAt = at(20 * MINUTE)
    const tomorrow = at(20 * 60 * MINUTE)
    expect(cappedDurationMs(open(), openedAt, tomorrow)).toBe(5 * MINUTE)
  })

  it('caps at the lock instant when the close arrives after the decision locked', () => {
    const run = open({
      state: 'decision_locked',
      decisionLockedAt: at(22 * MINUTE),
    })
    expect(cappedDurationMs(run, at(20 * MINUTE), at(60 * MINUTE))).toBe(2 * MINUTE)
  })

  it('gives back the paused time, because the clock stopped with it (FR-001)', () => {
    // Twelve minutes of component failure moves the clock's zero out by twelve minutes, so a read
    // that spans the outage is capped later, not sooner.
    const paused = open({ totalPausedMs: 12 * MINUTE })
    expect(cappedDurationMs(paused, at(20 * MINUTE), at(60 * MINUTE))).toBe(17 * MINUTE)
  })

  it('is never negative, however the clocks are read', () => {
    // A close that arrives before its own open is clock skew, not a reading, and records nothing.
    expect(cappedDurationMs(open(), at(6 * MINUTE), at(2 * MINUTE))).toBe(0)
  })

  // -------------------------------------------------------------------------------------------
  // The abandonment ceiling (D-249)
  // -------------------------------------------------------------------------------------------

  it('records an open with no clock as a day at most, however long the run sat there', () => {
    // Framing has no clock, so nothing else bounds this open: the student read the room, shut the
    // laptop and came back a month later. They did not read the document for a month.
    const framing = open({ state: 'framing', workingStartedAt: null })
    expect(ABANDONED_OPEN_MS).toBe(24 * 60 * MINUTE)
    expect(cappedDurationMs(framing, T0, at(30 * 24 * 60 * MINUTE))).toBe(ABANDONED_OPEN_MS)
    // An hour and a day either side of the ceiling, so it is a ceiling and not a rounding.
    expect(cappedDurationMs(framing, T0, at(23 * 60 * MINUTE))).toBe(23 * 60 * MINUTE)
    expect(cappedDurationMs(framing, T0, at(25 * 60 * MINUTE))).toBe(ABANDONED_OPEN_MS)
  })

  it('never answers a number `run_document_opens.duration_ms` cannot hold (DATA-031)', () => {
    // `duration_ms` is int4. Twenty-five days of wall clock overflows it, and the write that
    // overflows is the *only* way to close an open, to open another, or to lock the frame — so a
    // run that reached one could never leave `framing` again (Postgres 22003, and no error code
    // any screen can act on). The ceiling is what makes that unreachable rather than unlikely.
    const INT4_MAX = 2_147_483_647
    const framing = open({ state: 'framing', workingStartedAt: null })
    for (const days of [25, 60, 400]) {
      expect(cappedDurationMs(framing, T0, at(days * 24 * 60 * MINUTE))).toBeLessThanOrEqual(
        INT4_MAX,
      )
    }
    expect(openElapsedMs(T0, at(400 * 24 * 60 * MINUTE))).toBe(ABANDONED_OPEN_MS)
  })

  // -------------------------------------------------------------------------------------------
  // The clock's end caps a reading only when it falls inside it (D-250)
  // -------------------------------------------------------------------------------------------

  it('records an open that began after the clock had already ended as the read it was', () => {
    // The working clock reached zero at 25 minutes and no auto-lock applier has landed yet (10 §8
    // branch 2), so the run sits in `working` past its own zero with the Evidence Room still open.
    // A ten-minute read that starts there was never clocked — there was no clock left to cap it —
    // and ending it fifteen minutes before it began would record it as zero.
    expect(cappedDurationMs(open(), at(40 * MINUTE), at(50 * MINUTE))).toBe(10 * MINUTE)
  })

  it('caps at the clock’s end when that instant falls inside the open, to the millisecond', () => {
    // One millisecond of clock left at the open: the cap is a millisecond, not the hour that follows
    // it. This is the FR-117 rule, and the boundary the case above sits on the other side of.
    expect(cappedDurationMs(open(), new Date(at(25 * MINUTE).getTime() - 1), at(85 * MINUTE))).toBe(
      1,
    )
  })
})

// ---------------------------------------------------------------------------------------------
// The two numbers a close writes (D-250)
// ---------------------------------------------------------------------------------------------

describe('readingOf', () => {
  /** The board deck: long enough that its skim threshold is the four-second ceiling. */
  const WORDS = 280

  it('is the capped duration and the skim flag of an ordinary read', () => {
    expect(readingOf(open(), at(2 * MINUTE), at(6 * MINUTE), WORDS)).toEqual({
      durationMs: 4 * MINUTE,
      skim: false,
    })
    expect(
      readingOf(open(), at(2 * MINUTE), new Date(at(2 * MINUTE).getTime() + 900), WORDS),
    ).toEqual({ durationMs: 900, skim: true })
  })

  it('does not mark a read that outlived the clock by an hour as a skim', () => {
    // The clock ran out a millisecond into the open, so `duration_ms` is a millisecond — but the
    // document was in front of the student for an hour, and `isSkim(1, 280)` is true. The flag is
    // read from the open, never from the cap: it feeds the Verification band, and the student
    // cannot see it or contest it while the run is live (12 §8.2).
    const openedAt = new Date(at(25 * MINUTE).getTime() - 1)
    expect(readingOf(open(), openedAt, at(85 * MINUTE), WORDS)).toEqual({
      durationMs: 1,
      skim: false,
    })
  })

  it('does not mark a read that began after the clock ended as a skim', () => {
    expect(readingOf(open(), at(40 * MINUTE), at(50 * MINUTE), WORDS)).toEqual({
      durationMs: 10 * MINUTE,
      skim: false,
    })
  })

  it('does not mark an abandoned framing open as a skim', () => {
    const framing = open({ state: 'framing', workingStartedAt: null })
    expect(readingOf(framing, T0, at(30 * 24 * 60 * MINUTE), WORDS)).toEqual({
      durationMs: ABANDONED_OPEN_MS,
      skim: false,
    })
  })

  it('still marks the four-second open the flag exists for (FR-024, D-082)', () => {
    const openedAt = at(2 * MINUTE)
    const fourSeconds = new Date(openedAt.getTime() + 3_999)
    expect(readingOf(open(), openedAt, fourSeconds, WORDS).skim).toBe(true)
    // And not the same open of a six-word note, whose threshold is 1.5 seconds.
    expect(readingOf(open(), openedAt, fourSeconds, 6).skim).toBe(false)
  })
})
