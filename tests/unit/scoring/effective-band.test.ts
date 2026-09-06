// `effectiveBandOf` — the band a dimension actually stands at (10 §11.4; FR-005, FR-182, D-422).
//
// This is the number the gradebook is computed from. `computePoints` takes the effective band set,
// `run_scores.points_*` are written from it, and the Judgment Record and the course export both
// carry the result — so a defect here is not a display problem, it is a grade.
//
// Two rules meet in one function and the order they are applied in is the whole of it:
//
//   *FR-182 — the instructor's judgment is final.* The decided band is what the run stands on, and
//   `unassessed` is terminal: nothing may band a dimension a faculty seat has said this run cannot
//   be assessed on.
//
//   *FR-005 — a correction for Tassl's own error can raise a band and never lowers one.* So the
//   recomputed band is a **floor** under the decision, never a replacement for it (D-397: "a
//   correction has no business undoing an override").
//
// The table in the first describe block is the regression: before D-422, `bandBeforeCorrection`
// being non-null meant `decided` was never consulted at all, so every decision on a corrected
// dimension was silently discarded — including an override that *raised* the band, which FR-005's
// floor cannot excuse in any reading.
import { describe, expect, it } from 'vitest'
import { effectiveBandOf, type Band } from '@/server/modules/scoring'

type Row = Parameters<typeof effectiveBandOf>[0]

const row = (over: Partial<Row> = {}): Row => ({
  draftBand: 'proficient',
  decision: null,
  decidedBand: null,
  bandBeforeCorrection: null,
  bandAfterCorrection: null,
  ...over,
})

// ---------------------------------------------------------------------------------------------
// The decision survives a correction (D-422)
// ---------------------------------------------------------------------------------------------

describe('an instructor’s decision on a corrected dimension', () => {
  const cases: {
    before: Band | null
    after: Band | null
    decision: Row['decision']
    decidedBand: Band | null
    effective: Band | null
    why: string
  }[] = [
    {
      before: 'proficient',
      after: 'proficient',
      decision: 'overridden',
      decidedBand: 'professional',
      effective: 'professional',
      why: 'an override that raises, on a dimension a correction did not move',
    },
    {
      before: 'professional',
      after: 'novice',
      decision: 'overridden',
      decidedBand: 'developing',
      effective: 'developing',
      why: 'an override that lowers: FR-182 is final, and the correction may only raise',
    },
    {
      before: 'proficient',
      after: 'proficient',
      decision: 'unassessed',
      decidedBand: null,
      effective: null,
      why: 'unassessed is terminal — no correction bands a dimension the seat could not assess',
    },
  ]

  it.each(cases)(
    '$before/$after decided $decision → $effective ($why)',
    ({ before, after, decision, decidedBand, effective }) => {
      expect(
        effectiveBandOf(
          row({
            draftBand: 'novice',
            decision,
            decidedBand,
            bandBeforeCorrection: before,
            bandAfterCorrection: after,
          }),
        ),
      ).toBe(effective)
    },
  )

  it('confirms the draft when the decision is `confirmed` and carries no band of its own', () => {
    expect(
      effectiveBandOf(
        row({
          draftBand: 'developing',
          decision: 'confirmed',
          decidedBand: null,
          bandBeforeCorrection: 'developing',
          bandAfterCorrection: 'novice',
        }),
      ),
    ).toBe('developing')
  })
})

// ---------------------------------------------------------------------------------------------
// FR-005's floor still holds (D-397)
// ---------------------------------------------------------------------------------------------

describe('the correction is a floor and never a ceiling', () => {
  it('raises a draft the recompute placed higher', () => {
    expect(
      effectiveBandOf(
        row({
          draftBand: 'novice',
          bandBeforeCorrection: 'novice',
          bandAfterCorrection: 'proficient',
        }),
      ),
    ).toBe('proficient')
  })

  it('raises a decision the recompute placed higher, so a correction cannot cost a raise', () => {
    // The instructor decided `developing` and the correction then found `proficient`. FR-005 says a
    // correction for Tassl's own error raises; refusing it here would make the student pay for the
    // defect that caused the correction.
    expect(
      effectiveBandOf(
        row({
          draftBand: 'novice',
          decision: 'overridden',
          decidedBand: 'developing',
          bandBeforeCorrection: 'developing',
          bandAfterCorrection: 'proficient',
        }),
      ),
    ).toBe('proficient')
  })

  it('never lowers: a recompute that says less than the run stood at changes nothing', () => {
    expect(
      effectiveBandOf(
        row({
          draftBand: 'professional',
          bandBeforeCorrection: 'professional',
          bandAfterCorrection: 'novice',
        }),
      ),
    ).toBe('professional')
  })

  it('treats an unassessed recompute as below every band (D-397)', () => {
    expect(
      effectiveBandOf(
        row({
          draftBand: 'proficient',
          bandBeforeCorrection: 'proficient',
          bandAfterCorrection: null,
        }),
      ),
    ).toBe('proficient')
  })

  it('takes the recompute where the run had no band at all', () => {
    expect(
      effectiveBandOf(
        row({ draftBand: null, bandBeforeCorrection: null, bandAfterCorrection: 'developing' }),
      ),
    ).toBe('developing')
  })
})

// ---------------------------------------------------------------------------------------------
// With no correction at all
// ---------------------------------------------------------------------------------------------

describe('a run nobody has corrected', () => {
  it('reads the draft where nobody decided', () => {
    expect(effectiveBandOf(row({ draftBand: 'developing' }))).toBe('developing')
  })

  it('reads the decided band where somebody did', () => {
    expect(effectiveBandOf(row({ decision: 'overridden', decidedBand: 'professional' }))).toBe(
      'professional',
    )
  })

  it('falls back to the draft when an override names no band', () => {
    expect(effectiveBandOf(row({ decision: 'overridden', decidedBand: null }))).toBe('proficient')
  })

  it('answers null for an unassessed decision', () => {
    expect(effectiveBandOf(row({ decision: 'unassessed' }))).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// `bandBeforeCorrection` is a record, not an input (D-422)
// ---------------------------------------------------------------------------------------------

describe('what the function does not read', () => {
  it('answers the same whatever `bandBeforeCorrection` holds', () => {
    const answers = (['novice', 'developing', 'proficient', 'professional', null] as const).map(
      (before) =>
        effectiveBandOf(
          row({
            draftBand: 'novice',
            decision: 'overridden',
            decidedBand: 'proficient',
            bandBeforeCorrection: before,
            bandAfterCorrection: 'developing',
          }),
        ),
    )
    // It is the record of what the recompute saw. When the decision came first it *is* the decision;
    // when the decision came later the decision is the fresher of the two and FR-182 makes it final.
    expect(new Set(answers)).toEqual(new Set(['proficient']))
  })
})
