// The neutralization recompute and its floor (10-backend-spec-modules.md §11.5; PRD §7 standing
// rules, §7.19; FR-003, FR-005, FR-087, FR-232).
//
// One rule is being defended, and it only points one way: "a correction for Tassl's own error can
// raise a band or neutralize a dimension and never lowers a band or the points computed from it".
// So there are two kinds of test below — a correction that raises, and a correction that would have
// lowered and does not.
//
// The raising case is built on the Marco fixture with five of his nine challenge-or-reject acts
// turned into accepts, which is a smaller version of the same run: he still catches the planted
// defect, and three of his remaining challenges land on sound claims. That derived run bands
// Calibration Developing, and neutralizing the one false challenge that Appendix A.4's
// Developing-to-Proficient boundary does not excuse lifts it to Proficient. The claim being
// neutralized is the case FR-003 and A.3's fixed modifier exist for: the student challenged a claim
// the author marked sound, the faculty seat agreed the student was right, and the challenge is
// credited.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAPPING,
  buildGraphs,
  calibrationBand,
  categoricalFacts,
  computePoints,
  recomputeAfterNeutralization,
  withNeutralization,
  type Band,
  type Dimension,
  type GraphInput,
  type Neutralization,
  type StanceValue,
} from '@/server/modules/scoring'
import { loadFixture } from './graphs/fixtures'

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

/** The same run with the final stance on named claims replaced. Nothing else moves. */
function restance(input: GraphInput, changes: Record<string, StanceValue>): GraphInput {
  const idOf = (key: string) => input.packageVersion.claims.find((c) => c.key === key)?.id
  const byId = new Map(
    Object.entries(changes).map(([key, stance]) => [idOf(key) ?? key, stance] as const),
  )
  return {
    ...input,
    events: input.events.map((event) => {
      if (event.type !== 'stance_set') return event
      const stance = byId.get(event.payload.claim_id as string)
      return stance === undefined ? event : { ...event, payload: { ...event.payload, stance } }
    }),
  }
}

const claimId = (input: GraphInput, key: string): string => {
  const id = input.packageVersion.claims.find((claim) => claim.key === key)?.id
  if (id === undefined) throw new Error(`No claim ${key} in this fixture`)
  return id
}

const neutralization = (id: string, over: Partial<Neutralization> = {}): Neutralization => ({
  neutralizationId: '00000000-0000-4000-8000-0000000000ff',
  claimId: id,
  reason: 'unintended_defect',
  creditChallenge: true,
  note: 'The claim was defective by accident; the challenge stands.',
  ...over,
})

const bandOf = (input: GraphInput): Band =>
  calibrationBand(categoricalFacts(input, buildGraphs(input)))

/**
 * Marco with five of his challenges turned into accepts: three false challenges left, one of them
 * on a claim that is neither load-bearing, high-stakes, weakly sourced, nor on a concept the
 * Readiness Check left open — which is what holds the run at Developing.
 */
const DEVELOPING_RUN = restance(loadFixture('marco-8-of-11'), {
  claim_02: 'accept',
  claim_03: 'accept',
  claim_06: 'accept',
  claim_07: 'accept',
  claim_09: 'accept',
})

/** The bands the run stands on before the correction: five reads, and the two computed ones. */
const EFFECTIVE: Record<Dimension, Band> = {
  framing: 'proficient',
  delegation: 'proficient',
  verification: 'professional',
  calibration: 'developing',
  decision_quality: 'proficient',
  adaptation: 'proficient',
  ownership: 'proficient',
}

// ---------------------------------------------------------------------------------------------
// The derived run is what the test says it is
// ---------------------------------------------------------------------------------------------

describe('the run the recompute is run against', () => {
  it('bands Calibration Developing, held there by one indefensible false challenge (A.4)', () => {
    const facts = categoricalFacts(DEVELOPING_RUN, buildGraphs(DEVELOPING_RUN))
    expect(facts.fcr).toBe(0.273)
    expect(facts.falseChallengeCount).toBe(3)
    expect(facts.consequentialClaimCount).toBe(11)
    expect(facts.allDefectsKeptFromDecision).toBe(true)
    expect(
      facts.indefensibleFalseChallengeClaimIds.map(
        (id) => DEVELOPING_RUN.packageVersion.claims.find((c) => c.id === id)?.key,
      ),
    ).toStrictEqual(['claim_04'])
    expect(bandOf(DEVELOPING_RUN)).toBe('developing')
  })
})

// ---------------------------------------------------------------------------------------------
// A correction that raises (FR-003, FR-005)
// ---------------------------------------------------------------------------------------------

describe('neutralizing the claim raises Calibration from Developing to Proficient', () => {
  const result = recomputeAfterNeutralization({
    input: DEVELOPING_RUN,
    neutralization: neutralization(claimId(DEVELOPING_RUN, 'claim_04')),
    occurredAt: '2026-09-06T12:00:00.000Z',
    effectiveBands: EFFECTIVE,
    mapping: DEFAULT_MAPPING,
  })

  it('moves Calibration up one band and records both sides of the move', () => {
    expect(result.bandsBefore.calibration).toBe('developing')
    expect(result.bandsAfter.calibration).toBe('proficient')
    expect(result.bandsEffective.calibration).toBe('proficient')
  })

  it('drops the neutralized row out of the rate, numerator and denominator alike (D-107)', () => {
    expect(result.facts.consequentialClaimCount).toBe(11)
    expect(result.graphs.stance_matrix.consequential_claim_count).toBe(10)
    expect(result.facts.fcr).toBe(0.2)
    expect(result.facts.falseChallengeCount).toBe(2)
    expect(result.facts.indefensibleFalseChallengeClaimIds).toStrictEqual([])
  })

  it('keeps the row itself visible, credited as a match (FR-003, A.3)', () => {
    const row = result.graphs.stance_matrix.rows.find(
      (r) => r.claim_id === claimId(DEVELOPING_RUN, 'claim_04'),
    )
    expect(row?.neutralized).toBe(true)
    expect(row?.inconsistency_credited).toBe(true)
    expect(row?.match).toBe(true)
  })

  it('leaves Verification where it was: the correction touched no check', () => {
    expect(result.bandsBefore.verification).toBe('professional')
    expect(result.bandsAfter.verification).toBe('professional')
    expect(result.bandsEffective.verification).toBe('professional')
  })

  it('recomputes only the two dimensions the stance matrix feeds (§11.5)', () => {
    expect(result.dimensions).toStrictEqual(['verification', 'calibration'])
    expect(Object.keys(result.bandsAfter).sort()).toStrictEqual(['calibration', 'verification'])
  })

  it('raises the points with the band, and records before, after and effective (FR-005)', () => {
    expect(result.pointsBefore).toBe(3) // 3+3+4+2+3+3+3 over seven
    expect(result.pointsAfter).toBe(
      computePoints({ ...EFFECTIVE, calibration: 'proficient' }, DEFAULT_MAPPING),
    )
    expect(result.pointsAfter).toBe(3.143)
    expect(result.pointsEffective).toBe(3.143)
  })

  it('hands the service the block the claim_neutralized event carries (10 §10)', () => {
    expect(result.block).toStrictEqual({
      dimensions: ['verification', 'calibration'],
      bands_before: { verification: 'professional', calibration: 'developing' },
      bands_after: { verification: 'professional', calibration: 'proficient' },
    })
  })

  it('hands the two point totals over separately, because the record withholds them (D-420)', () => {
    // They are fields of the `claim_neutralized` payload, not members of its `recompute` block:
    // `trace/owner-view.ts` classifies the top level of a payload, so a `points_*` inside the block
    // was carried into the student's copy of their own record by the block's own classification —
    // the last row of 12 §8.1, `points` inside the record export form.
    expect(result.points).toStrictEqual({ points_before: 3, points_after: 3.143 })
    expect(Object.keys(result.block)).not.toContain('points_before')
    expect(Object.keys(result.block)).not.toContain('points_after')
  })
})

// ---------------------------------------------------------------------------------------------
// A correction that would have lowered, and does not (FR-005)
// ---------------------------------------------------------------------------------------------

describe('a recompute never lowers a band or the points computed from it', () => {
  const marco = loadFixture('marco-8-of-11')
  // PRD §6: the instructor raised Marco's Calibration one band from Novice, and an instructor's
  // decision is final (FR-182). Neutralizing his planted defect then takes a claim out of the
  // denominator and pushes the rate *up* — the recompute says Novice, and the floor refuses it.
  const raised: Record<Dimension, Band> = { ...EFFECTIVE, calibration: 'developing' }
  const result = recomputeAfterNeutralization({
    input: marco,
    neutralization: neutralization(claimId(marco, 'claim_01'), {
      reason: 'wrong_verification_result',
      creditChallenge: false,
    }),
    occurredAt: '2026-09-06T12:00:00.000Z',
    effectiveBands: raised,
    mapping: DEFAULT_MAPPING,
  })

  it('recomputes a lower band and says so on the record', () => {
    expect(result.bandsBefore.calibration).toBe('developing')
    expect(result.bandsAfter.calibration).toBe('novice')
    expect(result.facts.fcr).toBe(0.8)
  })

  it('but the effective band is the higher of the two (FR-005)', () => {
    expect(result.bandsEffective.calibration).toBe('developing')
  })

  it('and the effective points are the higher of the two', () => {
    expect(result.pointsAfter).toBeLessThan(result.pointsBefore ?? 0)
    expect(result.pointsEffective).toBe(result.pointsBefore)
  })

  it('holds for every dimension the recompute touched', () => {
    for (const dimension of result.dimensions) {
      const before = result.bandsBefore[dimension] ?? null
      const effective = result.bandsEffective[dimension] ?? null
      const rank = (band: Band | null) =>
        band === null ? -1 : ['novice', 'developing', 'proficient', 'professional'].indexOf(band)
      expect(rank(effective), dimension).toBeGreaterThanOrEqual(rank(before))
    }
  })
})

describe('a correction that leaves a dimension unassessed keeps the band the run had (FR-087)', () => {
  // Two of six consequential claims lose their stance record, which is a third or fewer: the run
  // stands and the two computed dimensions cannot be read. Neither may take a band away.
  const base = loadFixture('hold-with-reason')
  const first = withNeutralization(
    base,
    neutralization(claimId(base, 'claim_05'), { reason: 'record_lost', creditChallenge: false }),
    '2026-09-06T11:00:00.000Z',
  )
  const result = recomputeAfterNeutralization({
    input: first,
    neutralization: neutralization(claimId(base, 'claim_06'), {
      neutralizationId: '00000000-0000-4000-8000-0000000000fe',
      reason: 'record_lost',
      creditChallenge: false,
    }),
    occurredAt: '2026-09-06T12:00:00.000Z',
    effectiveBands: { ...EFFECTIVE, calibration: 'professional' },
    mapping: DEFAULT_MAPPING,
  })

  it('reports the two dimensions unassessed after the correction', () => {
    expect(result.facts.stanceRecordsLost).toBe(2)
    expect(result.facts.stanceRecordLoss).toBe('dimensions_unassessed')
    expect(result.bands.calibration.reason).toBe('stance_records_lost')
    expect(result.bandsAfter.calibration).toBeNull()
    expect(result.bandsAfter.verification).toBeNull()
  })

  it('and keeps the bands the run already had, because unassessed is not higher than a band', () => {
    expect(result.bandsEffective.calibration).toBe('professional')
    expect(result.bandsEffective.verification).toBe('professional')
  })

  it('and keeps the higher points, whichever way the exclusion moved the mean', () => {
    expect(result.pointsEffective).toBe(Math.max(result.pointsBefore ?? 0, result.pointsAfter ?? 0))
    expect(result.pointsEffective).toBeGreaterThanOrEqual(result.pointsBefore ?? 0)
  })
})

// ---------------------------------------------------------------------------------------------
// The synthetic event
// ---------------------------------------------------------------------------------------------

describe('withNeutralization', () => {
  const base = loadFixture('hold-with-reason')
  const after = withNeutralization(
    base,
    neutralization(claimId(base, 'claim_02')),
    '2026-09-06T12:00:00.000Z',
  )

  it('appends the correction at the next sequence number, leaving the trace gapless (NFR-005)', () => {
    const highest = Math.max(...base.events.map((event) => event.seq))
    const appended = after.events[after.events.length - 1]
    expect(after.events).toHaveLength(base.events.length + 1)
    expect(appended?.seq).toBe(highest + 1)
    expect(appended?.type).toBe('claim_neutralized')
    expect(appended?.occurredAt).toBe('2026-09-06T12:00:00.000Z')
  })

  it('does not touch the run it was given', () => {
    expect(base.events.some((event) => event.type === 'claim_neutralized')).toBe(false)
  })
})
