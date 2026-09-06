// The Decision Lock's gate (docs/tech/10-backend-spec-modules.md §6; 10-backend-spec.md §8;
// FR-084, FR-100, FR-103, FR-105, FR-106; D-044).
//
// Two properties are under test here, and neither of them is an outcome.
//
//   1. **The order.** Validate, then mark reliance from the named fields, then read the relied-on
//      claims with no stance. A gate that read reliance before it marked it would let a student lock
//      over a claim whose figure they had just typed into the brief — every outcome test would still
//      pass, and FR-084 would be broken for exactly the case FR-101 exists to catch. So the steps
//      are handed in and the calls are recorded, and the assertions are about the sequence.
//   2. **The one asymmetry between the two modes.** A student's lock requires a filled brief within
//      FR-100's limits and refuses over an unstanced relied-on claim; the clock's own auto-lock
//      requires nothing and refuses over nothing, because FR-105 says it records what exists —
//      empty fields empty, unstanced claims unstanced. "Empty is allowed only at auto-lock" is one
//      branch, and it is asserted from both sides.
import { describe, expect, it } from 'vitest'
import {
  elapsedWorkingMs,
  isSpeedOutlier,
  planDecisionLock,
  validateBrief,
  EMPTY_BRIEF,
  type BriefFields,
  type LockSteps,
  type UnstancedClaim,
} from '@/server/modules/runs/lock'

const T0 = new Date('2026-09-05T10:00:00.000Z')
const at = (ms: number): Date => new Date(T0.getTime() + ms)
const MINUTE = 60_000

/** A brief that meets FR-100: 120 / 250 / 25 × 3 / 60 words at most, confidence 0 to 100. */
const BRIEF: BriefFields = {
  recommendation: 'Hold the acquisition spend in the value tier for this quarter.',
  rationale:
    'The premium payback figure is the load-bearing number and it has not been traced to the cohort table, so moving spend on it would be betting on a figure nobody has checked.',
  assumptions: [
    'Premium retention holds near the piloted level',
    'Value tier payback stays close to four months',
    'Green coffee cost per bag is stable',
  ],
  changeMyMind: 'A cohort table showing premium payback under six months would change this.',
  confidence: 45,
  namedValues: { premium_payback_months: 11, budget_share_to_premium: 40 },
}

const CLAIM: UnstancedClaim = {
  claimId: '11111111-1111-4111-8111-111111111111',
  claimText: 'Premium payback is 11 months.',
}

const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

/**
 * The two effects, recording what they were called with and in what order.
 *
 * `calls` is the whole point: the gate's contract is a sequence, and a spy that only counted would
 * not notice the two being swapped.
 */
function steps(unstanced: readonly UnstancedClaim[] = []) {
  const calls: string[] = []
  const marked: Record<string, number>[] = []
  const recorder: LockSteps = {
    markNamedFields: async (namedValues) => {
      calls.push('markNamedFields')
      marked.push(namedValues)
    },
    findUnstanced: async () => {
      calls.push('findUnstanced')
      return unstanced
    },
  }
  return { calls, marked, recorder }
}

describe('planDecisionLock order (FR-084, FR-101)', () => {
  it('marks reliance from the named fields before it reads the relied-on claims', async () => {
    const { calls, marked, recorder } = steps()

    const plan = await planDecisionLock(BRIEF, 'student', recorder)

    expect(plan.outcome).toBe('lock')
    expect(calls).toEqual(['markNamedFields', 'findUnstanced'])
    // The figures the gate marked from are the brief's own, so a claim carrying 11 months becomes
    // relied on by this call and is in the set the very next one reads (FR-101, D-076).
    expect(marked).toEqual([BRIEF.namedValues])
  })

  it('validates the brief before it marks or reads anything at all', async () => {
    const { calls, recorder } = steps([CLAIM])

    const plan = await planDecisionLock({ ...BRIEF, rationale: '' }, 'student', recorder)

    expect(plan).toEqual({ outcome: 'brief_invalid', field: 'rationale', reason: 'required' })
    // Neither effect ran: a student who left the rationale empty is told about the rationale, and
    // the run's reliance is not touched by a lock that never got past its own form.
    expect(calls).toEqual([])
  })

  it('refuses over the first unstanced relied-on claim and names it', async () => {
    const second: UnstancedClaim = {
      claimId: '22222222-2222-4222-8222-222222222222',
      claimText: 'Retention in the premium tier is 78 percent.',
    }
    const { calls, recorder } = steps([CLAIM, second])

    const plan = await planDecisionLock(BRIEF, 'student', recorder)

    expect(plan).toEqual({ outcome: 'unstanced', claim: CLAIM, unstanced: [CLAIM, second] })
    // Both steps ran first: the marking is what may have *created* the refusal, and it stands
    // whether or not the lock does (D-270).
    expect(calls).toEqual(['markNamedFields', 'findUnstanced'])
  })

  it('stores the stripped, trimmed text the word count was taken over (10 §5, D-075)', async () => {
    const { recorder } = steps()

    const plan = await planDecisionLock(
      { ...BRIEF, recommendation: '  <b>Hold</b> the spend  ' },
      'student',
      recorder,
    )

    expect(plan.outcome).toBe('lock')
    if (plan.outcome !== 'lock') return
    expect(plan.brief.recommendation).toBe('Hold the spend')
  })
})

describe('the empty brief (FR-100, FR-105, D-044)', () => {
  it('is refused from a student, field by field', async () => {
    const { recorder } = steps()

    const plan = await planDecisionLock(EMPTY_BRIEF, 'student', recorder)

    // The first empty field, which is what the editor marks up and scrolls to (FR-108).
    expect(plan).toEqual({ outcome: 'brief_invalid', field: 'recommendation', reason: 'required' })
  })

  it('is locked by the clock, exactly as it stands', async () => {
    const { calls, recorder } = steps([CLAIM])

    const plan = await planDecisionLock(EMPTY_BRIEF, 'auto', recorder)

    // FR-105: empty fields recorded empty, relied-on claims without a stance recorded unstanced —
    // never accepted, and never a refusal. The run goes on to the Turn.
    expect(plan).toEqual({ outcome: 'lock', brief: EMPTY_BRIEF, unstanced: [CLAIM] })
    // And the marking still happens: reliance is a fact about what the student wrote, not about how
    // the lock came about.
    expect(calls).toEqual(['markNamedFields', 'findUnstanced'])
  })

  it('carries the unstanced claims into the auto-lock’s record and none into a student’s', async () => {
    const auto = await planDecisionLock(BRIEF, 'auto', steps([CLAIM]).recorder)
    const student = await planDecisionLock(BRIEF, 'student', steps().recorder)

    expect(auto.outcome === 'lock' && auto.unstanced).toEqual([CLAIM])
    // A student's lock cannot record an unstanced relied-on claim, because the gate refused it.
    expect(student.outcome === 'lock' && student.unstanced).toEqual([])
  })
})

describe('validateBrief (FR-100, FR-103)', () => {
  it('names the field that is over its word limit', () => {
    expect(validateBrief({ ...BRIEF, recommendation: words(121) })).toEqual({
      ok: false,
      field: 'recommendation',
      reason: 'word_limit',
    })
    expect(validateBrief({ ...BRIEF, rationale: words(251) })).toEqual({
      ok: false,
      field: 'rationale',
      reason: 'word_limit',
    })
    expect(validateBrief({ ...BRIEF, changeMyMind: words(61) })).toEqual({
      ok: false,
      field: 'changeMyMind',
      reason: 'word_limit',
    })
    expect(
      validateBrief({
        ...BRIEF,
        assumptions: [BRIEF.assumptions[0]!, words(26), BRIEF.assumptions[2]!],
      }),
    ).toEqual({ ok: false, field: 'assumptions.1', reason: 'word_limit' })
  })

  it('accepts the limits exactly, and one word per field', () => {
    expect(validateBrief({ ...BRIEF, recommendation: words(120), rationale: words(250) }).ok).toBe(
      true,
    )
    expect(
      validateBrief({
        recommendation: 'Hold',
        rationale: 'Untraced',
        assumptions: ['Retention', 'Payback', 'Supply'],
        changeMyMind: 'Evidence',
        confidence: 0,
        namedValues: {},
      }).ok,
    ).toBe(true)
  })

  it('requires exactly three assumptions and a whole confidence between 0 and 100', () => {
    expect(validateBrief({ ...BRIEF, assumptions: BRIEF.assumptions.slice(0, 2) })).toEqual({
      ok: false,
      field: 'assumptions',
      reason: 'required',
    })
    for (const confidence of [101, -1, 45.5]) {
      expect(validateBrief({ ...BRIEF, confidence })).toEqual({
        ok: false,
        field: 'confidence',
        reason: 'invalid',
      })
    }
    // A confidence the student never entered is not a zero: it is a missing answer, and only the
    // clock's own lock may record one (FR-105).
    expect(validateBrief({ ...BRIEF, confidence: null }).ok).toBe(false)
  })

  it('rejects a named value that is not a finite number (FR-100)', () => {
    expect(validateBrief({ ...BRIEF, namedValues: { premium_payback_months: NaN } }).ok).toBe(false)
    expect(validateBrief({ ...BRIEF, namedValues: { premium_payback_months: Infinity } }).ok).toBe(
      false,
    )
    expect(validateBrief({ ...BRIEF, namedValues: {} }).ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// The working time a lock took (FR-106)
// ---------------------------------------------------------------------------------------------

describe('elapsedWorkingMs and the speed outlier (FR-106)', () => {
  const run = (overrides: Partial<Parameters<typeof elapsedWorkingMs>[0]> = {}) => ({
    workingStartedAt: T0,
    pausedAt: null,
    totalPausedMs: 0,
    ...overrides,
  })

  it('is wall time from the frame lock', () => {
    expect(elapsedWorkingMs(run(), at(3 * MINUTE))).toBe(3 * MINUTE)
  })

  it('leaves out every span the run spent paused (FR-001)', () => {
    // Ten minutes on the wall, two of which were a component failure the student did not cause:
    // eight minutes of working time, which is what the flag reads.
    expect(elapsedWorkingMs(run({ totalPausedMs: 2 * MINUTE }), at(10 * MINUTE))).toBe(8 * MINUTE)
    // And the open span too, for a reading taken while the run is still paused.
    expect(
      elapsedWorkingMs(run({ pausedAt: at(4 * MINUTE), totalPausedMs: 0 }), at(10 * MINUTE)),
    ).toBe(4 * MINUTE)
  })

  it('is zero for a run whose frame is not locked, and never negative', () => {
    expect(elapsedWorkingMs(run({ workingStartedAt: null }), at(MINUTE))).toBe(0)
    expect(elapsedWorkingMs(run({ totalPausedMs: 10 * MINUTE }), at(MINUTE))).toBe(0)
  })

  it('flags a lock under four minutes and not one at four', () => {
    expect(isSpeedOutlier(4 * MINUTE - 1)).toBe(true)
    expect(isSpeedOutlier(4 * MINUTE)).toBe(false)
    expect(isSpeedOutlier(0)).toBe(true)
  })
})
