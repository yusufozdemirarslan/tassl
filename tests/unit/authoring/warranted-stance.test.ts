// Step 12.1 — the warranted-stance table (D-032; docs/tech/10-backend-spec-modules.md §5; PRD §7.8).
//
// The warranted stance is what scoring compares a student's stance against, so a wrong proposal is a
// wrong Calibration band on every run of the package until an author notices. D-032 states the table
// in four rows of prose; this file is those four rows as cases, plus the three things the prose does
// not settle and the implementation had to: the overlap between the Accept row and the Verify row,
// the combinations no row names, and what "outside the student's expected competence" is measured
// against.
import { describe, expect, it } from 'vitest'
import {
  WARRANTED_STANCE_RULES,
  explainWarrantedStance,
  isStance,
  proposeWarrantedStance,
  type StanceProposalClaim,
  type StanceProposalState,
} from '@/server/modules/authoring/warranted-stance'
import {
  CLAIM_IMPORTANCES,
  CONSEQUENCE_LEVELS,
  EVIDENCE_STATUSES,
  STANCES,
  VERIFICATION_COSTS,
} from '@/server/modules/scenarios/schema'

const CONCEPTS = ['payback_period', 'contribution_margin', 'evidence_recency'] as const

const claim = (overrides: Partial<StanceProposalClaim> = {}): StanceProposalClaim => ({
  importance: 'supporting',
  consequenceLevel: 'low',
  verificationCost: 'moderate',
  weaklySourced: false,
  volatile: false,
  conceptKey: 'payback_period',
  ...overrides,
})

const state = (overrides: Partial<StanceProposalState> = {}): StanceProposalState => ({
  evidenceStatus: 'sound',
  failureFamily: null,
  ...overrides,
})

const propose = (c: StanceProposalClaim, s: StanceProposalState) =>
  explainWarrantedStance(c, s, CONCEPTS)

// ---------------------------------------------------------------------------------------------
// The four rows D-032 states
// ---------------------------------------------------------------------------------------------

describe('D-032 row 1 — sound, not load-bearing, low consequence, well sourced', () => {
  it('proposes Accept', () => {
    expect(propose(claim(), state())).toMatchObject({
      stance: 'accept',
      rule: 'SOUND_INCONSEQUENTIAL',
    })
  })

  it('does not propose Accept once the claim is weakly sourced', () => {
    expect(propose(claim({ weaklySourced: true }), state()).stance).toBe('verify')
  })

  it('does not propose Accept once the claim is load-bearing', () => {
    expect(propose(claim({ importance: 'load_bearing' }), state()).stance).toBe('verify')
  })

  it('does not propose Accept once the consequence rises above low', () => {
    expect(propose(claim({ consequenceLevel: 'medium' }), state()).stance).toBe('verify')
    expect(propose(claim({ consequenceLevel: 'high' }), state()).stance).toBe('verify')
  })
})

describe('D-032 row 2 — sound, but load-bearing or high consequence or cheap and shaky', () => {
  it('proposes Verify for a load-bearing claim', () => {
    expect(propose(claim({ importance: 'load_bearing' }), state())).toMatchObject({
      stance: 'verify',
      rule: 'SOUND_CONSEQUENTIAL',
    })
  })

  it('proposes Verify for a high-consequence claim', () => {
    expect(propose(claim({ consequenceLevel: 'high' }), state())).toMatchObject({
      stance: 'verify',
      rule: 'SOUND_CONSEQUENTIAL',
    })
  })

  it('proposes Verify for a weakly sourced claim that is cheap to check', () => {
    expect(
      propose(claim({ weaklySourced: true, verificationCost: 'cheap' }), state()),
    ).toMatchObject({ stance: 'verify', rule: 'SOUND_CHEAP_AND_SHAKY' })
  })

  it('proposes Verify for a volatile claim that is cheap to check', () => {
    expect(propose(claim({ volatile: true, verificationCost: 'cheap' }), state())).toMatchObject({
      stance: 'verify',
      rule: 'SOUND_CHEAP_AND_SHAKY',
    })
  })
})

describe('D-032 row 3 — defective and inside the declared concept set', () => {
  it('proposes Challenge', () => {
    expect(
      propose(
        claim({ importance: 'load_bearing', consequenceLevel: 'high' }),
        state({ evidenceStatus: 'defective', failureFamily: 'stale_evidence' }),
      ),
    ).toMatchObject({ stance: 'challenge', rule: 'DEFECT_IN_CONCEPT_SET' })
  })

  it('proposes Reject when the family is a route that may not be taken', () => {
    expect(
      propose(claim(), state({ evidenceStatus: 'defective', failureFamily: 'unacceptable_route' })),
    ).toMatchObject({ stance: 'reject', rule: 'DEFECT_UNACCEPTABLE_ROUTE' })
  })

  it('rejects an unacceptable route even when the concept is outside the set', () => {
    // The route is refused because of what it is, not because of what the student was taught.
    expect(
      propose(
        claim({ conceptKey: 'something_the_course_never_declared' }),
        state({ evidenceStatus: 'defective', failureFamily: 'unacceptable_route' }),
      ).stance,
    ).toBe('reject')
  })
})

describe('D-032 row 4 — defective and outside the student’s expected competence', () => {
  it('proposes Escalate when the concept is not one the course declared', () => {
    expect(
      propose(
        claim({ conceptKey: 'stochastic_frontier_analysis' }),
        state({ evidenceStatus: 'defective', failureFamily: 'misapplied_method' }),
      ),
    ).toMatchObject({ stance: 'escalate', rule: 'DEFECT_OUTSIDE_COMPETENCE' })
  })

  it('measures competence against the declared concept set and nothing else', () => {
    const defective = state({ evidenceStatus: 'defective', failureFamily: 'stale_evidence' })
    expect(explainWarrantedStance(claim(), defective, CONCEPTS).stance).toBe('challenge')
    expect(explainWarrantedStance(claim(), defective, []).stance).toBe('escalate')
  })
})

// ---------------------------------------------------------------------------------------------
// What D-032's prose leaves open, and how this implementation reads it
// ---------------------------------------------------------------------------------------------

describe('the readings the table does not state', () => {
  it('takes Verify where the Accept row and the Verify row both match', () => {
    // A volatile, inconsequential, cheaply checked claim satisfies row 1 (which never mentions
    // volatility) and row 2 (which does). The conservative reading wins: checking it is nearly free.
    const overlapping = claim({ volatile: true, verificationCost: 'cheap' })
    expect(propose(overlapping, state())).toMatchObject({
      stance: 'verify',
      rule: 'SOUND_CHEAP_AND_SHAKY',
    })
  })

  it('proposes Verify for a sound claim no row names', () => {
    // Supporting, medium consequence, well sourced, expensive to check: row 1 wants low consequence
    // and row 2 wants one of three things, none of which is true. Accept has not been earned.
    expect(
      propose(claim({ consequenceLevel: 'medium', verificationCost: 'expensive' }), state()),
    ).toMatchObject({ stance: 'verify', rule: 'SOUND_UNSETTLED' })
  })

  it('reads any status that is not "defective" as sound', () => {
    // An imported document (FR-186) or an unsaved generation element can carry a value the column
    // would refuse; proposing Challenge on it would invent a defect nobody authored.
    expect(propose(claim(), state({ evidenceStatus: 'unknown' })).stance).toBe('accept')
  })

  it('is total: every combination of the enums proposes one of the five stances', () => {
    const seen = new Set<string>()
    for (const importance of CLAIM_IMPORTANCES) {
      for (const consequenceLevel of CONSEQUENCE_LEVELS) {
        for (const verificationCost of VERIFICATION_COSTS) {
          for (const weaklySourced of [false, true]) {
            for (const volatile of [false, true]) {
              for (const evidenceStatus of EVIDENCE_STATUSES) {
                for (const conceptKey of ['payback_period', 'not_declared']) {
                  const proposal = explainWarrantedStance(
                    {
                      importance,
                      consequenceLevel,
                      verificationCost,
                      weaklySourced,
                      volatile,
                      conceptKey,
                    },
                    {
                      evidenceStatus,
                      failureFamily: evidenceStatus === 'defective' ? 'stale_evidence' : null,
                    },
                    CONCEPTS,
                  )
                  expect(isStance(proposal.stance)).toBe(true)
                  expect(WARRANTED_STANCE_RULES).toContain(proposal.rule)
                  expect(proposal.because.length).toBeGreaterThan(20)
                  seen.add(proposal.stance)
                }
              }
            }
          }
        }
      }
    }
    // Reject needs the one family the sweep does not vary, so four of the five appear above.
    expect([...seen].sort()).toEqual(['accept', 'challenge', 'escalate', 'verify'])
    expect(STANCES).toContain('reject')
  })

  it('agrees with itself: the proposal is the stance the explanation carries', () => {
    const consequential = claim({ importance: 'load_bearing', consequenceLevel: 'high' })
    const defective = state({ evidenceStatus: 'defective', failureFamily: 'stale_evidence' })
    expect(proposeWarrantedStance(consequential, defective, CONCEPTS)).toBe(
      explainWarrantedStance(consequential, defective, CONCEPTS).stance,
    )
  })

  it('names every rule it can fire, and no rule it cannot', () => {
    expect(new Set(WARRANTED_STANCE_RULES).size).toBe(WARRANTED_STANCE_RULES.length)
  })
})
