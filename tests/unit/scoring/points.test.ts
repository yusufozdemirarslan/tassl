// Points (10-backend-spec-modules.md §11.4; PRD §7.19; FR-202, FR-203, D-091).
//
// The arithmetic is a mean, and every assertion here is about one of the four ways a mean can be
// wrong in a gradebook: counting a dimension that was never assessed, returning a number where
// there is none, printing more precision than the column holds, and mixing a draft band into a
// confirmed total.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAPPING,
  buildGraphs,
  categoricalFacts,
  computePoints,
  draftBands,
  higherPoints,
  round3,
  type Band,
  type BandMapping,
  type Dimension,
  type DraftBand,
  type PointsInput,
} from '@/server/modules/scoring'
import { loadFixture } from './graphs/fixtures'

/** What a draft band contributes to `points_draft`: its band, or nothing at all (FR-202). */
const asPoints = (bands: Record<Dimension, DraftBand>): Record<Dimension, PointsInput> =>
  Object.fromEntries(
    Object.entries(bands).map(([dimension, band]) => [dimension, band.band ?? 'unassessed']),
  ) as Record<Dimension, PointsInput>

describe('computePoints (FR-202)', () => {
  it('is the arithmetic mean of the assessed dimensions under the course mapping', () => {
    expect(
      computePoints(
        {
          framing: 'proficient',
          delegation: 'proficient',
          verification: 'professional',
          calibration: 'novice',
        },
        DEFAULT_MAPPING,
      ),
    ).toBe(2.75) // 3 + 3 + 4 + 1 over four
  })

  it('excludes an unassessed dimension rather than counting it as zero', () => {
    const six = {
      framing: 'proficient',
      delegation: 'proficient',
      verification: 'proficient',
      calibration: 'proficient',
      decision_quality: 'proficient',
      adaptation: 'proficient',
    } as const
    // Six Proficient and one unassessed is 3, not 18 over 7 and certainly not 18 over 7 with a zero
    // in it. This is the assertion PRD §7.13's standing rule turns on.
    expect(computePoints({ ...six, ownership: 'unassessed' }, DEFAULT_MAPPING)).toBe(3)
    expect(computePoints({ ...six, ownership: null }, DEFAULT_MAPPING)).toBe(3)
    expect(computePoints(six, DEFAULT_MAPPING)).toBe(3)
    // What a zero would have produced, so the difference is on the record.
    expect(round3((6 * 3) / 7)).toBe(2.571)
  })

  it('returns null when no dimension is assessed, and never a zero', () => {
    expect(computePoints({}, DEFAULT_MAPPING)).toBeNull()
    expect(
      computePoints(
        { framing: 'unassessed', delegation: null, verification: 'unassessed' },
        DEFAULT_MAPPING,
      ),
    ).toBeNull()
  })

  it('rounds to three decimals (D-091), which is what numeric(6,3) holds', () => {
    // 1 + 1 + 2 over three is 1.333…; 1 + 2 + 2 over three is 1.666…, which rounds up.
    expect(
      computePoints(
        { framing: 'novice', delegation: 'novice', verification: 'developing' },
        DEFAULT_MAPPING,
      ),
    ).toBe(1.333)
    expect(
      computePoints(
        { framing: 'novice', delegation: 'developing', verification: 'developing' },
        DEFAULT_MAPPING,
      ),
    ).toBe(1.667)
    // Seven dimensions is the case the run actually produces, and 19 over 7 is the awkward one.
    expect(
      computePoints(
        {
          framing: 'novice',
          delegation: 'developing',
          verification: 'proficient',
          calibration: 'professional',
          decision_quality: 'professional',
          adaptation: 'proficient',
          ownership: 'developing',
        },
        DEFAULT_MAPPING,
      ),
    ).toBe(2.714)
  })

  it('uses the course’s own mapping, whatever it is (FR-202)', () => {
    const mapping: BandMapping = { novice: 0.5, developing: 1, proficient: 2, professional: 5 }
    expect(computePoints({ framing: 'novice', delegation: 'professional' }, mapping)).toBe(2.75)
  })

  it('takes an absent dimension and an unassessed one to mean the same thing', () => {
    const bands = { framing: 'proficient', delegation: 'professional' } as const
    expect(computePoints(bands, DEFAULT_MAPPING)).toBe(
      computePoints({ ...bands, ownership: 'unassessed' }, DEFAULT_MAPPING),
    )
  })
})

describe('draft points and confirmed points are different numbers (FR-203, D-091)', () => {
  const input = loadFixture('marco-8-of-11')
  const graphs = buildGraphs(input)
  const facts = categoricalFacts(input, graphs)
  const drafts = draftBands({
    facts,
    graphs,
    reads: {
      framing: { band: 'proficient', quotes: [], rationale: 'r' },
      delegation: { band: 'proficient', quotes: [], rationale: 'r' },
      decision_quality: {
        band: 'proficient',
        quotes: [],
        rationale: 'r',
        matchedPosition: 'defensible',
        minimumCommitmentExists: false,
      },
      adaptation: { band: 'proficient', quotes: [], rationale: 'r' },
      ownership: { band: 'proficient', quotes: [], rationale: 'r' },
    },
  })

  it('computes points_draft from the drafted bands', () => {
    // Five Proficient reads, Verification Professional, Calibration Novice: 3+3+4+1+3+3+3 over 7.
    expect(asPoints(drafts).calibration).toBe('novice')
    expect(computePoints(asPoints(drafts), DEFAULT_MAPPING)).toBe(round3(20 / 7))
    expect(computePoints(asPoints(drafts), DEFAULT_MAPPING)).toBe(2.857)
  })

  it('computes points_confirmed from the decided bands, which are not the drafted ones', () => {
    // PRD §6: the instructor raises Marco's Calibration one band from Novice. Only confirmed bands
    // enter the mapping, so this is the number the gradebook sees and the draft above is not.
    const decided: Record<Dimension, Band> = {
      framing: 'proficient',
      delegation: 'proficient',
      verification: 'professional',
      calibration: 'developing',
      decision_quality: 'proficient',
      adaptation: 'proficient',
      ownership: 'proficient',
    }
    const confirmed = computePoints(decided, DEFAULT_MAPPING)
    expect(confirmed).toBe(3)
    expect(confirmed).not.toBe(computePoints(asPoints(drafts), DEFAULT_MAPPING))
  })

  it('leaves an unassessed dimension out of the confirmed total too (FR-087, FR-202)', () => {
    const lost = loadFixture('stance-records-lost-third')
    const lostGraphs = buildGraphs(lost)
    const lostBands = draftBands({
      facts: categoricalFacts(lost, lostGraphs),
      graphs: lostGraphs,
      reads: {
        framing: { band: 'proficient', quotes: [], rationale: 'r' },
        delegation: { band: 'proficient', quotes: [], rationale: 'r' },
        decision_quality: {
          band: 'proficient',
          quotes: [],
          rationale: 'r',
          matchedPosition: 'defensible',
          minimumCommitmentExists: false,
        },
        adaptation: { band: 'proficient', quotes: [], rationale: 'r' },
        ownership: { band: 'proficient', quotes: [], rationale: 'r' },
      },
    })
    expect(lostBands.verification.status).toBe('unassessed')
    expect(lostBands.calibration.status).toBe('unassessed')
    // Five dimensions at Proficient, two excluded: 3, not 15 over 7.
    expect(computePoints(asPoints(lostBands), DEFAULT_MAPPING)).toBe(3)
  })
})

describe('the FR-005 floor on the points', () => {
  it('keeps the higher of the two, in either order', () => {
    expect(higherPoints(2.5, 3)).toBe(3)
    expect(higherPoints(3, 2.5)).toBe(3)
    expect(higherPoints(3, 3)).toBe(3)
  })

  it('treats null as the absence of a number rather than a low one', () => {
    expect(higherPoints(2.5, null)).toBe(2.5)
    expect(higherPoints(null, 2.5)).toBe(2.5)
    expect(higherPoints(null, null)).toBeNull()
  })
})
