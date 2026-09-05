// Step 6.1 and 6.2 — the run clock (docs/tech/10-backend-spec.md §10; D-042, D-132, D-133).
//
// Every function under test is pure: a row and an instant go in, a number or a column patch comes
// out, and nothing is scheduled anywhere (ADR-019). So the arithmetic of D-042 is asserted directly
// against the formula the spec writes, one term at a time, and then in the combinations a real run
// produces — a pause, a credit for a failed action, a charge that outlives the clock.
import { describe, expect, it } from 'vitest'
import { isAppError } from '@/lib/errors'
import {
  chargeCost,
  credit,
  isInTurnWindow,
  pause,
  remainingMs,
  remainingWindowMs,
  resume,
  type ClockRun,
} from '@/server/modules/runs/clock'
import { ACTION_COSTS, ESCALATION_COST_MS } from '@/server/modules/runs/limits'

const T0 = new Date('2026-09-05T10:00:00.000Z')
const at = (msAfterT0: number): Date => new Date(T0.getTime() + msAfterT0)

const MINUTE = 60_000

/** A run in `working` with a 25-minute clock started at T0, plus whatever the case overrides. */
function working(overrides: Partial<ClockRun> = {}): ClockRun {
  return {
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
  }
}

describe('remainingMs (D-042)', () => {
  it('is the whole clock at the instant the frame is locked', () => {
    expect(remainingMs(working(), T0)).toBe(25 * MINUTE)
  })

  it('counts down with elapsed time', () => {
    expect(remainingMs(working(), at(4 * MINUTE))).toBe(21 * MINUTE)
  })

  it('is null before the frame is locked and after the decision is', () => {
    expect(remainingMs(working({ workingStartedAt: null }), T0)).toBeNull()
    expect(remainingMs(working({ state: 'framing' }), T0)).toBeNull()
    expect(remainingMs(working({ state: 'decision_locked' }), T0)).toBeNull()
    expect(remainingMs(working({ state: 'turn_open' }), T0)).toBeNull()
  })

  it('adds the pauses that have closed', () => {
    const run = working({ totalPausedMs: 3 * MINUTE })
    expect(remainingMs(run, at(10 * MINUTE))).toBe(18 * MINUTE)
  })

  it('freezes while a pause is open, however long the browser is away', () => {
    const run = working({ state: 'paused', pausedAt: at(5 * MINUTE) })
    expect(remainingMs(run, at(5 * MINUTE))).toBe(20 * MINUTE)
    expect(remainingMs(run, at(45 * MINUTE))).toBe(20 * MINUTE)
  })

  it('adds credits and subtracts charges', () => {
    const run = working({ creditedMs: 5 * MINUTE, chargedMs: 4 * MINUTE })
    expect(remainingMs(run, at(10 * MINUTE))).toBe(16 * MINUTE)
  })

  it('reports the overrun rather than clamping, so a timer can stamp when it happened', () => {
    expect(remainingMs(working(), at(26 * MINUTE))).toBe(-1 * MINUTE)
  })

  it('composes every term of the formula at once', () => {
    const run = working({
      state: 'paused',
      pausedAt: at(20 * MINUTE),
      totalPausedMs: 2 * MINUTE,
      creditedMs: ESCALATION_COST_MS,
      chargedMs: ACTION_COSTS.replication_check,
    })
    // 25 − 30 elapsed + 2 closed pause + 10 open pause + 5 credit − 3 charge
    expect(remainingMs(run, at(30 * MINUTE))).toBe(9 * MINUTE)
  })
})

describe('remainingWindowMs and isInTurnWindow (D-132, D-133)', () => {
  const open = (overrides: Partial<ClockRun> = {}): ClockRun =>
    working({
      state: 'turn_open',
      workingStartedAt: T0,
      turnDeliveredAt: at(30 * MINUTE),
      turnWindowEndsAt: at(42 * MINUTE),
      ...overrides,
    })

  it('counts down to turn_window_ends_at', () => {
    expect(remainingWindowMs(open(), at(30 * MINUTE))).toBe(12 * MINUTE)
    expect(remainingWindowMs(open(), at(38 * MINUTE))).toBe(4 * MINUTE)
  })

  it('is null when no window is open', () => {
    expect(remainingWindowMs(working(), T0)).toBeNull()
    expect(remainingWindowMs(working({ turnWindowEndsAt: at(42 * MINUTE) }), T0)).toBeNull()
  })

  it('freezes while the run is paused from inside the window', () => {
    const paused = open({ state: 'paused', pausedAt: at(34 * MINUTE) })
    expect(isInTurnWindow(paused)).toBe(true)
    expect(remainingWindowMs(paused, at(34 * MINUTE))).toBe(8 * MINUTE)
    expect(remainingWindowMs(paused, at(60 * MINUTE))).toBe(8 * MINUTE)
  })

  it('tells a pause inside the window from a pause on the working clock', () => {
    expect(isInTurnWindow(working({ state: 'paused', pausedAt: T0 }))).toBe(false)
    // The response is locked, so the window is over even though the Turn was delivered.
    const afterResponse = open({
      state: 'paused',
      pausedAt: at(50 * MINUTE),
      turnLockedAt: at(40 * MINUTE),
    })
    expect(isInTurnWindow(afterResponse)).toBe(false)
  })
})

describe('pause and resume (FR-001, D-133)', () => {
  it('freezes at the instant the failure happened', () => {
    expect(pause(working(), at(6 * MINUTE))).toEqual({ pausedAt: at(6 * MINUTE) })
  })

  it('does nothing to a run already paused', () => {
    expect(pause(working({ state: 'paused', pausedAt: at(6 * MINUTE) }), at(9 * MINUTE))).toEqual(
      {},
    )
  })

  it('repays a working-clock pause into total_paused_ms', () => {
    const paused = working({ state: 'paused', pausedAt: at(6 * MINUTE), totalPausedMs: MINUTE })
    const { patch, pausedMs } = resume(paused, at(9 * MINUTE))
    expect(pausedMs).toBe(3 * MINUTE)
    expect(patch).toEqual({ pausedAt: null, totalPausedMs: 4 * MINUTE })
    // The run gets back exactly what the pause took.
    const resumed = working({ ...paused, ...patch, state: 'working' })
    expect(remainingMs(resumed, at(9 * MINUTE))).toBe(remainingMs(paused, at(6 * MINUTE)))
  })

  it('repays a Turn-window pause by moving the window out (D-133)', () => {
    const paused = working({
      state: 'paused',
      turnDeliveredAt: at(30 * MINUTE),
      turnWindowEndsAt: at(42 * MINUTE),
      pausedAt: at(34 * MINUTE),
    })
    const { patch, pausedMs } = resume(paused, at(37 * MINUTE))
    expect(pausedMs).toBe(3 * MINUTE)
    expect(patch).toEqual({ pausedAt: null, turnWindowEndsAt: at(45 * MINUTE) })
    expect(patch.totalPausedMs).toBeUndefined()
  })

  it('is a no-op on a run that is not paused', () => {
    expect(resume(working(), at(9 * MINUTE))).toEqual({ patch: {}, pausedMs: 0 })
  })
})

describe('credit (FR-001)', () => {
  it('adds to credited_ms', () => {
    expect(credit(working({ creditedMs: MINUTE }), ESCALATION_COST_MS)).toEqual({
      creditedMs: MINUTE + ESCALATION_COST_MS,
    })
  })

  it('ignores a credit of nothing', () => {
    expect(credit(working(), 0)).toEqual({})
    expect(credit(working(), -1)).toEqual({})
  })
})

describe('chargeCost (FR-070 to FR-072, D-132)', () => {
  it('charges the whole cost against the working clock', () => {
    const { patch, appliedMs, remainingMsBefore } = chargeCost(
      working(),
      ACTION_COSTS.source_trace,
      at(2 * MINUTE),
    )
    expect(appliedMs).toBe(MINUTE)
    expect(remainingMsBefore).toBe(23 * MINUTE)
    expect(patch).toEqual({ chargedMs: MINUTE })
  })

  it('accumulates onto charges already made', () => {
    const run = working({ chargedMs: ACTION_COSTS.source_trace })
    const { patch } = chargeCost(run, ACTION_COSTS.decomposition_check, at(2 * MINUTE))
    expect(patch.chargedMs).toBe(5 * MINUTE)
  })

  it('never takes the clock below zero: the cost is capped at what was left', () => {
    // One minute left, a four-minute check: FR-072 lets it run, and the clock lands on zero.
    const run = working()
    const now = at(24 * MINUTE)
    const { patch, appliedMs } = chargeCost(run, ACTION_COSTS.decomposition_check, now)
    expect(appliedMs).toBe(MINUTE)
    expect(remainingMs(working({ ...run, ...patch }), now)).toBe(0)
  })

  it.each([
    ['source_trace', ACTION_COSTS.source_trace],
    ['replication_check', ACTION_COSTS.replication_check],
    ['decomposition_check', ACTION_COSTS.decomposition_check],
    ['escalation', ESCALATION_COST_MS],
  ])('leaves a non-negative clock after a %s at any instant', (_name, cost) => {
    for (const minute of [0, 1, 12, 24, 24.9]) {
      const now = at(minute * MINUTE)
      const run = working()
      const { patch } = chargeCost(run, cost, now)
      expect(remainingMs(working({ ...run, ...patch }), now)).toBeGreaterThanOrEqual(0)
    }
  })

  it('refuses a clock with nothing left (CLOCK_EXPIRED, 409)', () => {
    expect.assertions(2)
    try {
      chargeCost(working(), ACTION_COSTS.source_trace, at(25 * MINUTE))
    } catch (error) {
      if (!isAppError(error)) throw error
      expect(error.code).toBe('CLOCK_EXPIRED')
      expect(error.status).toBe(409)
    }
  })

  it('charges the Turn window instead when the window is the running clock (D-132)', () => {
    const run = working({
      state: 'turn_open',
      turnDeliveredAt: at(30 * MINUTE),
      turnWindowEndsAt: at(42 * MINUTE),
    })
    const { patch, appliedMs } = chargeCost(run, ACTION_COSTS.source_trace, at(32 * MINUTE))
    expect(appliedMs).toBe(MINUTE)
    expect(patch).toEqual({ turnWindowEndsAt: at(41 * MINUTE) })
    expect(patch.chargedMs).toBeUndefined()
  })

  it('never takes the window below zero either', () => {
    const run = working({
      state: 'turn_open',
      turnDeliveredAt: at(30 * MINUTE),
      turnWindowEndsAt: at(42 * MINUTE),
    })
    const now = at(41 * MINUTE)
    const { patch, appliedMs } = chargeCost(run, ESCALATION_COST_MS, now)
    expect(appliedMs).toBe(MINUTE)
    expect(remainingWindowMs({ ...run, ...patch }, now)).toBe(0)
  })

  it('refuses a closed window (TURN_WINDOW_EXPIRED, 409)', () => {
    expect.assertions(2)
    const run = working({
      state: 'turn_open',
      turnDeliveredAt: at(30 * MINUTE),
      turnWindowEndsAt: at(42 * MINUTE),
    })
    try {
      chargeCost(run, ACTION_COSTS.source_trace, at(42 * MINUTE))
    } catch (error) {
      if (!isAppError(error)) throw error
      expect(error.code).toBe('TURN_WINDOW_EXPIRED')
      expect(error.status).toBe(409)
    }
  })

  it('calls a charge with no clock running what it is: a defect', () => {
    expect.assertions(2)
    try {
      chargeCost(working({ state: 'framing' }), ACTION_COSTS.source_trace, T0)
    } catch (error) {
      if (!isAppError(error)) throw error
      expect(error.code).toBe('INTERNAL_ERROR')
      expect(error.opts.details).toEqual({ state: 'framing' })
    }
  })
})
