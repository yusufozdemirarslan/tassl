// Step 6.2 — the run state machine (docs/tech/10-backend-spec.md §9, FR-231, D-133).
//
// The table is the rule, so the test is a table too: 10 §9's rows are restated here by hand rather
// than read from `TRANSITIONS`, because a test that iterates the thing it is testing proves only
// that the file is internally consistent. Every pair the spec lists must be allowed, every pair it
// does not must be refused, and void must be reachable from every state but `voided`.
import { describe, expect, it } from 'vitest'
import { isAppError } from '@/lib/errors'
import {
  RUN_STATES,
  canTransition,
  findTransition,
  nextStates,
  transition,
  type RunStateValue,
  type StampColumn,
} from '@/server/modules/runs/state-machine'

/** 10 §9, transcribed: from, to, and the `*_at` column the move stamps (null when it stamps none). */
const SPEC: Array<[RunStateValue, RunStateValue, StampColumn | null]> = [
  ['assigned', 'readiness', 'readinessStartedAt'],
  ['readiness', 'framing', null],
  ['framing', 'working', 'workingStartedAt'],
  ['working', 'paused', 'pausedAt'],
  ['paused', 'working', null],
  ['turn_open', 'paused', 'pausedAt'],
  ['paused', 'turn_open', null],
  ['working', 'decision_locked', 'decisionLockedAt'],
  ['decision_locked', 'turn_open', 'turnDeliveredAt'],
  ['turn_open', 'turn_locked', 'turnLockedAt'],
  ['turn_locked', 'defense_pending', null],
  ['defense_pending', 'defense_complete', 'defenseCompletedAt'],
  ['defense_complete', 'scored', 'scoredAt'],
  ['scored', 'confirmed', 'confirmedAt'],
  ['confirmed', 'recorded', 'recordedAt'],
]

const AT = new Date('2026-09-05T10:00:00.000Z')

const allowed = new Set(SPEC.map(([from, to]) => `${from}->${to}`))

/** The void rule of 10 §9's last row: every state but `voided` may be voided. */
const isVoid = (from: RunStateValue, to: RunStateValue): boolean =>
  to === 'voided' && from !== 'voided'

describe('the transition table (10 §9)', () => {
  it.each(SPEC)('allows %s to %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it.each(SPEC)('stamps the column 10 §9 names for %s to %s', (from, to, stamp) => {
    const moved = transition({ state: from }, to, { cause: 'automatic', at: AT })
    expect(moved.patch.state).toBe(to)
    if (stamp) {
      expect(moved.patch[stamp]).toEqual(AT)
    } else {
      // Only the state and, on the way out of `paused`, the cleared `paused_at`.
      const written = Object.keys(moved.patch).filter((k) => k !== 'state' && k !== 'pausedAt')
      expect(written).toEqual([])
    }
  })

  it('refuses every pair the table does not list', () => {
    const wrong: string[] = []
    for (const from of RUN_STATES) {
      for (const to of RUN_STATES) {
        if (allowed.has(`${from}->${to}`) || isVoid(from, to)) continue
        if (canTransition(from, to)) wrong.push(`${from} to ${to}`)
      }
    }
    expect(wrong, 'only 10 §9 decides what may move where').toEqual([])
  })

  it('lists no pair the table does not have', () => {
    const extra: string[] = []
    for (const from of RUN_STATES) {
      for (const to of RUN_STATES) {
        if (!canTransition(from, to)) continue
        if (!allowed.has(`${from}->${to}`) && !isVoid(from, to)) extra.push(`${from} to ${to}`)
      }
    }
    expect(extra).toEqual([])
  })

  it('refuses a state moving to itself', () => {
    for (const state of RUN_STATES) expect(canTransition(state, state)).toBe(false)
  })

  it('answers ILLEGAL_TRANSITION (409) naming the pair it refused', () => {
    expect.assertions(4)
    try {
      transition({ state: 'assigned' }, 'working', { cause: 'frame_locked' })
    } catch (error) {
      if (!isAppError(error)) throw error
      expect(error.code).toBe('ILLEGAL_TRANSITION')
      expect(error.status).toBe(409)
      expect(error.opts.details).toEqual({ from: 'assigned', to: 'working' })
      expect(error.message).toBeTruthy()
    }
  })
})

describe('void (10 §9, "any except voided to voided")', () => {
  const voidable = RUN_STATES.filter((state) => state !== 'voided')

  it.each(voidable)('is reachable from %s', (from) => {
    expect(canTransition(from, 'voided')).toBe(true)
    const moved = transition({ state: from }, 'voided', { cause: 'voided', at: AT })
    expect(moved.patch).toMatchObject({ state: 'voided', voidedAt: AT })
    expect(moved.payload).toEqual({ from, to: 'voided', cause: 'voided' })
    expect(moved.row.irreversible).toBe(true)
  })

  it('is not reachable from voided', () => {
    expect(canTransition('voided', 'voided')).toBe(false)
    expect(findTransition('voided', 'voided')).toBeUndefined()
    expect(() => transition({ state: 'voided' }, 'voided', { cause: 'voided' })).toThrow()
  })

  it('is the last state every other state can reach', () => {
    for (const from of voidable) expect(nextStates(from)).toContain('voided')
    expect(nextStates('voided')).toEqual([])
  })
})

describe('the lifecycle event and the stamps', () => {
  it('writes { from, to, cause } for the trace', () => {
    const moved = transition({ state: 'assigned' }, 'readiness', {
      cause: 'policy_acknowledged',
      at: AT,
    })
    expect(moved.payload).toEqual({
      from: 'assigned',
      to: 'readiness',
      cause: 'policy_acknowledged',
    })
    expect(moved.patch).toEqual({ state: 'readiness', readinessStartedAt: AT })
  })

  it('starts the working clock on the frame lock and not on a resume', () => {
    expect(
      transition({ state: 'framing' }, 'working', { cause: 'frame_locked', at: AT }).patch,
    ).toEqual({ state: 'working', workingStartedAt: AT })
    // A component failure must never hand the student a fresh clock (FR-001).
    expect(transition({ state: 'paused' }, 'working', { cause: 'resumed', at: AT }).patch).toEqual({
      state: 'working',
      pausedAt: null,
    })
  })

  it('clears paused_at on both ways out of paused (D-133)', () => {
    expect(
      transition({ state: 'paused' }, 'turn_open', { cause: 'resumed', at: AT }).patch,
    ).toEqual({ state: 'turn_open', pausedAt: null })
  })

  it('defaults the stamp to now when the caller passes no instant', () => {
    const before = Date.now()
    const moved = transition({ state: 'working' }, 'decision_locked', { cause: 'decision_locked' })
    const stamped = moved.patch.decisionLockedAt as Date
    expect(stamped.getTime()).toBeGreaterThanOrEqual(before)
    expect(stamped.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('carries the irreversible column of 10 §9', () => {
    // "until submit": the check can be re-answered, but the run never returns to `assigned`.
    expect(findTransition('assigned', 'readiness')?.irreversible).toBe(false)
    expect(findTransition('framing', 'working')?.irreversible).toBe(true)
    expect(findTransition('working', 'paused')?.irreversible).toBe(false)
    expect(findTransition('paused', 'working')?.irreversible).toBe(false)
  })
})
