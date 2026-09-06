// When a run's timers fire (docs/tech/10-backend-spec.md §8, ADR-019).
//
// `nextTimer` is what lets a read decide whether it has any writing to do before it opens a
// transaction, so the property that matters is not only "the right branch at the right instant" but
// "nothing at all for a run that is merely being watched": `GET /runs/{runId}` is polled every five
// seconds by the student's screen and by every reviewer, and each of those polls used to take
// `SELECT … FOR UPDATE` on the run row (D-229).
import { describe, expect, it } from 'vitest'
import { workingExpiresAt, remainingMs, type ClockRun } from '@/server/modules/runs/clock'
import { TURN_WINDOW_MS } from '@/server/modules/runs/limits'
import { hasTimerFired, nextTimer, type TimerRun } from '@/server/modules/runs/timers'
import {
  IMPLICIT_HOLD,
  planTurnDelivery,
  planTurnResponse,
  turnDueAtFrom,
  windowEndsAtFrom,
} from '@/server/modules/runs/turn'

const T0 = new Date('2026-09-05T10:00:00.000Z')
const at = (msAfterT0: number): Date => new Date(T0.getTime() + msAfterT0)
const MINUTE = 60_000

/** A run with no clock started and no deadline set; each case supplies the state it is testing. */
function run(overrides: Partial<TimerRun> = {}): TimerRun {
  return {
    state: 'assigned',
    workingClockSeconds: 1500,
    workingStartedAt: null,
    pausedAt: null,
    totalPausedMs: 0,
    creditedMs: 0,
    chargedMs: 0,
    readinessExpiresAt: null,
    turnDueAt: null,
    turnDeliveredAt: null,
    turnWindowEndsAt: null,
    turnLockedAt: null,
    ...overrides,
  }
}

describe('workingExpiresAt (D-042)', () => {
  it('is the instant remainingMs reaches zero, for every combination of the terms', () => {
    const cases: ClockRun[] = [
      run({ state: 'working', workingStartedAt: T0 }),
      run({ state: 'working', workingStartedAt: T0, totalPausedMs: 3 * MINUTE }),
      run({ state: 'working', workingStartedAt: T0, creditedMs: 5 * MINUTE }),
      run({ state: 'working', workingStartedAt: T0, chargedMs: 4 * MINUTE }),
      run({
        state: 'working',
        workingStartedAt: T0,
        totalPausedMs: 2 * MINUTE,
        creditedMs: 5 * MINUTE,
        chargedMs: 9 * MINUTE,
      }),
    ]
    for (const one of cases) {
      const expiry = workingExpiresAt(one)
      expect(expiry).not.toBeNull()
      expect(remainingMs(one, expiry as Date)).toBe(0)
    }
  })

  it('is 25 minutes after the frame lock on an untouched clock', () => {
    expect(workingExpiresAt(run({ state: 'working', workingStartedAt: T0 }))?.toISOString()).toBe(
      at(25 * MINUTE).toISOString(),
    )
  })

  it('is null when there is no working clock', () => {
    expect(workingExpiresAt(run({ state: 'working' }))).toBeNull()
    expect(workingExpiresAt(run({ state: 'framing', workingStartedAt: T0 }))).toBeNull()
    expect(workingExpiresAt(run({ state: 'decision_locked', workingStartedAt: T0 }))).toBeNull()
  })
})

describe('nextTimer (10 §8)', () => {
  it('gives the readiness expiry while the check is open', () => {
    const expiresAt = at(8 * MINUTE)
    expect(nextTimer(run({ state: 'readiness', readinessExpiresAt: expiresAt }))).toEqual({
      branch: 'readiness_expired',
      at: expiresAt,
    })
  })

  it('gives the auto-lock instant while the working clock runs', () => {
    expect(nextTimer(run({ state: 'working', workingStartedAt: T0 }))).toEqual({
      branch: 'decision_auto_lock',
      at: at(25 * MINUTE),
    })
  })

  it('gives the Turn delivery, then the window expiry', () => {
    const dueAt = at(90_000)
    const endsAt = at(12 * MINUTE)
    expect(nextTimer(run({ state: 'decision_locked', turnDueAt: dueAt }))).toEqual({
      branch: 'turn_delivery',
      at: dueAt,
    })
    expect(
      nextTimer(run({ state: 'turn_open', turnDueAt: dueAt, turnWindowEndsAt: endsAt })),
    ).toEqual({ branch: 'turn_window_expired', at: endsAt })
  })

  it('gives nothing while the run is paused: the clock is frozen (FR-001)', () => {
    const paused = run({
      state: 'paused',
      workingStartedAt: T0,
      pausedAt: at(MINUTE),
      turnDueAt: at(90_000),
      turnWindowEndsAt: at(12 * MINUTE),
    })
    expect(nextTimer(paused)).toBeNull()
    expect(hasTimerFired(paused, at(60 * MINUTE))).toBe(false)
  })

  it('gives nothing for a state with no clock pointed at it', () => {
    for (const state of [
      'assigned',
      'framing',
      'turn_locked',
      'defense_pending',
      'defense_complete',
      'scored',
      'confirmed',
      'recorded',
      'voided',
    ] as const) {
      expect(nextTimer(run({ state, workingStartedAt: T0, turnDueAt: at(1) }))).toBeNull()
    }
  })

  it('gives nothing when the deadline column the state needs was never set', () => {
    expect(nextTimer(run({ state: 'readiness' }))).toBeNull()
    expect(nextTimer(run({ state: 'working' }))).toBeNull()
    expect(nextTimer(run({ state: 'decision_locked' }))).toBeNull()
    expect(nextTimer(run({ state: 'turn_open' }))).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// The Turn's two instants (10 §8 branches 3 and 4; FR-110, FR-113, FR-115; D-043, D-334)
//
// The Turn fires on a clock and is delivered by a read, and off-line those are not the same moment.
// Everything below is that one distinction, asserted at the two readings it changes: what the trace
// records, and how long the student gets.
// ---------------------------------------------------------------------------------------------

describe('turnDueAtFrom: when the Turn fires (FR-110)', () => {
  it('is the lock instant plus the package’s delay', () => {
    expect(turnDueAtFrom(T0, 90).toISOString()).toBe(at(90_000).toISOString())
    expect(turnDueAtFrom(T0, 60).toISOString()).toBe(at(60_000).toISOString())
    expect(turnDueAtFrom(T0, 120).toISOString()).toBe(at(120_000).toISOString())
  })

  it('measures from the instant given, not from now (D-297)', () => {
    // The auto-lock's instant is the moment the working clock reached zero, which may be hours ago.
    const expiredAt = at(-3 * 60 * MINUTE)
    expect(turnDueAtFrom(expiredAt, 90).getTime()).toBe(expiredAt.getTime() + 90_000)
  })
})

describe('the Turn window (FR-115, D-043)', () => {
  const dueAt = at(90_000)

  it('runs twelve minutes from a read that arrives on time', () => {
    const readAt = new Date(dueAt.getTime() + 400)
    expect(windowEndsAtFrom(dueAt, readAt).getTime()).toBe(readAt.getTime() + TURN_WINDOW_MS)
    expect(TURN_WINDOW_MS).toBe(12 * MINUTE)
  })

  it('gives a student who was offline the full twelve minutes from the read', () => {
    // The Turn fired an hour before anybody looked. The window has not been running in the meantime.
    const readAt = new Date(dueAt.getTime() + 60 * MINUTE)
    const plan = planTurnDelivery(dueAt, readAt)
    expect(plan.windowEndsAt.getTime()).toBe(readAt.getTime() + TURN_WINDOW_MS)
    expect(plan.windowEndsAt.getTime() - readAt.getTime()).toBe(TURN_WINDOW_MS)
  })

  it('never opens a window that has already closed', () => {
    // The branch only fires at or after `turn_due_at`; the floor is what keeps that true if a caller
    // one day delivers early, rather than handing over a window with negative time in it.
    const early = new Date(dueAt.getTime() - 5 * MINUTE)
    expect(windowEndsAtFrom(dueAt, early).getTime()).toBe(dueAt.getTime() + TURN_WINDOW_MS)
    expect(planTurnDelivery(dueAt, early).deliveredAt.toISOString()).toBe(dueAt.toISOString())
  })
})

describe('planTurnDelivery: the two instants a delivery writes (D-334)', () => {
  const dueAt = at(90_000)

  it('stamps the event when the Turn fired and the window when it was read', () => {
    const readAt = new Date(dueAt.getTime() + 47 * MINUTE)
    const plan = planTurnDelivery(dueAt, readAt)

    // `turn_delivered.occurred_at` — the moment the Turn fired, however late the read (NFR-002).
    expect(plan.firedAt.toISOString()).toBe(dueAt.toISOString())
    // `runs.turn_delivered_at` and the window — the read.
    expect(plan.deliveredAt.toISOString()).toBe(readAt.toISOString())
    expect(plan.windowEndsAt.getTime()).toBe(readAt.getTime() + TURN_WINDOW_MS)
  })

  it('collapses to one instant when somebody was watching', () => {
    const plan = planTurnDelivery(dueAt, dueAt)
    expect(plan.firedAt.toISOString()).toBe(plan.deliveredAt.toISOString())
    expect(plan.windowEndsAt.getTime()).toBe(dueAt.getTime() + TURN_WINDOW_MS)
  })
})

describe('the implicit hold at the window’s end (FR-113, 10 §8 branch 4)', () => {
  it('fires at `turn_window_ends_at` exactly, and that is the instant it is stamped at', () => {
    const endsAt = at(90_000 + TURN_WINDOW_MS)
    const open = nextTimer(
      run({ state: 'turn_open', turnDueAt: at(90_000), turnWindowEndsAt: endsAt }),
    )
    expect(open).toEqual({ branch: 'turn_window_expired', at: endsAt })
    // The applier stamps `timer.at`, so the event's `occurred_at` is the window's end whether the
    // read that noticed arrives a second later or a week later (NFR-002).
    expect(open?.at.toISOString()).toBe(endsAt.toISOString())
  })

  it('records a hold with nothing said and no confidence given', () => {
    expect(IMPLICIT_HOLD).toEqual({
      response: 'hold',
      justification: null,
      confidence: null,
      implicit: true,
    })
  })
})

describe('planTurnResponse: FR-112’s rules on an explicit response (D-335)', () => {
  const GOOD = {
    response: 'revise' as const,
    justification: 'The cohort is not the one we priced on.',
    confidence: 55,
  }

  it('accepts the three categories and strips the markup it counted words over', () => {
    for (const response of ['hold', 'revise', 'reverse'] as const) {
      const plan = planTurnResponse({ ...GOOD, response })
      expect(plan.ok && plan.fields).toEqual({
        response,
        justification: GOOD.justification,
        confidence: 55,
        implicit: false,
      })
    }
    const marked = planTurnResponse({ ...GOOD, justification: '<b>Priced on P1.</b>' })
    expect(marked.ok && marked.fields.justification).toBe('Priced on P1.')
  })

  it('refuses an empty justification, an over-long one, and a confidence off the scale', () => {
    expect(planTurnResponse({ ...GOOD, justification: '   ' })).toEqual({
      ok: false,
      field: 'justification',
      reason: 'required',
    })
    expect(
      planTurnResponse({
        ...GOOD,
        justification: Array.from({ length: 151 }, (_, i) => `word${i}`).join(' '),
      }),
    ).toEqual({ ok: false, field: 'justification', reason: 'word_limit' })
    expect(planTurnResponse({ ...GOOD, confidence: 101 })).toEqual({
      ok: false,
      field: 'confidence',
      reason: 'invalid',
    })
  })

  it('never answers `implicit: true`: only the window’s own expiry writes one', () => {
    const plan = planTurnResponse({ ...GOOD, response: 'hold' })
    expect(plan.ok && plan.fields.implicit).toBe(false)
  })
})

describe('hasTimerFired: what a read asks before it takes a lock (D-229)', () => {
  it('is false right up to the deadline and true from it on', () => {
    const working = run({ state: 'working', workingStartedAt: T0 })
    expect(hasTimerFired(working, at(25 * MINUTE - 1))).toBe(false)
    expect(hasTimerFired(working, at(25 * MINUTE))).toBe(true)
    expect(hasTimerFired(working, at(40 * MINUTE))).toBe(true)
  })

  it('is false for a run that is only being watched', () => {
    // The states the build can currently reach: a poll of either must not touch the run row.
    expect(hasTimerFired(run({ state: 'assigned' }), at(24 * 60 * MINUTE))).toBe(false)
    expect(
      hasTimerFired(run({ state: 'readiness', readinessExpiresAt: at(8 * MINUTE) }), at(MINUTE)),
    ).toBe(false)
  })
})
