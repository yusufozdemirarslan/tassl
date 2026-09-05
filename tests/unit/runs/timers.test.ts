// When a run's timers fire (docs/tech/10-backend-spec.md §8, ADR-019).
//
// `nextTimer` is what lets a read decide whether it has any writing to do before it opens a
// transaction, so the property that matters is not only "the right branch at the right instant" but
// "nothing at all for a run that is merely being watched": `GET /runs/{runId}` is polled every five
// seconds by the student's screen and by every reviewer, and each of those polls used to take
// `SELECT … FOR UPDATE` on the run row (D-229).
import { describe, expect, it } from 'vitest'
import { workingExpiresAt, remainingMs, type ClockRun } from '@/server/modules/runs/clock'
import { hasTimerFired, nextTimer, type TimerRun } from '@/server/modules/runs/timers'

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
