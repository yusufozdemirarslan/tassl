// Step 11 audit — the figure the export files is the figure the screens show (D-510, D-512;
// FR-005, FR-202, FR-204, FR-182, D-445, D-451).
//
// Three writers touch a run's point columns and every screen prices from the bands: the debrief
// (D-445), the reviewer's replay (D-451) and the mapping-change preview all call
// `scoring.priceBands` over the `BandView`s in front of them, because reading `run_scores` back
// would print a total the seven bands beside it no longer support. The **export** did not: it reads
// `points_effective ?? points_confirmed` off the row (`trace/repository.findExportScore`).
//
// So the two only agreed while the columns were fresh, and the confirmation wrote one of the five.
// `settleConfirmation` wrote `points_confirmed`; the three correction columns were written once by
// `applyNeutralization` and never again. On any corrected run the stale `points_effective` outranked
// every decision made afterwards, in both directions:
//
//   confirm → correct → override Framing **up** — bands say 3.000, the filed version says 2.857;
//   correct → override up → confirm      — the walkthrough's own order, same result;
//   confirm → correct → override **down** — the run keeps points its bands no longer support.
//
// Every screen was right and the ledger was wrong, which is the contradiction FR-005 and D-445 exist
// to prevent, moved one document over. The fix is that `scoring.writeBandDecisions` writes the bands
// **and** all five figures in one statement pair, from `priceBands` — so there is one function that
// says what a run is worth and no way to write a decision without re-asking it.
//
// The fourth case is D-512: a correction may not re-price a dimension a faculty seat marked
// unassessed. `recomputeAfterNeutralization` merged its two recomputed bands over the effective set
// unconditionally, so an instructor's `unassessed` on Verification was overwritten by the recomputed
// draft and the columns divided by seven where `effectiveBandOf` and `priceBands` divide by six.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'
import {
  bandRows,
  claimByKey,
  exportRows,
  scoreRow,
  scoredRun,
  setupAssistantFixture,
  type AssistantFixture,
} from './fixture'

type Review = typeof import('@/server/modules/review')
type Scoring = typeof import('@/server/modules/scoring')

let review: Review
let scoring: Scoring
let fx: AssistantFixture

beforeEach(async () => {
  await truncateAll()
  review = await import('@/server/modules/review')
  scoring = await import('@/server/modules/scoring')
  fx = await setupAssistantFixture('review-points-ledger')
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

const NOTE = 'Document D4 contradicts D2 unintentionally, so this claim was never fair to judge.'
const RAISE = 'The frame names both documents the recommendation turns on, and dates the figure.'
const LOWER = 'The frame names one document and does not say what it would take to be wrong.'

/** The number the newest filed version hands a gradebook (FR-204). */
async function filed(runId: string): Promise<{ version: number; points: number | null }> {
  const rows = await exportRows(runId)
  const latest = rows.at(-1)
  if (!latest) throw new Error('no course export was filed')
  return {
    version: latest.version,
    points: (latest.file as { computed?: { points?: number | null } }).computed?.points ?? null,
  }
}

const effectiveOf = async (runId: string, dimension: string) =>
  (await scoring.readBands(runId)).find((band) => band.dimension === dimension)?.effectiveBand ??
  null

async function correct(runId: string) {
  return review.neutralizeClaim(fx.instructor, runId, fx.claimId(claimByKey('C3').key), {
    reason: 'unintended_defect',
    creditChallenge: false,
    note: NOTE,
  })
}

/** Every stored point column, as the numbers they are. */
async function columns(runId: string) {
  const row = await scoreRow(runId)
  const num = (value: string | null): number | null => (value === null ? null : Number(value))
  return {
    draft: num(row?.points_draft ?? null),
    confirmed: num(row?.points_confirmed ?? null),
    beforeCorrection: num(row?.points_before_correction ?? null),
    afterCorrection: num(row?.points_after_correction ?? null),
    effective: num(row?.points_effective ?? null),
  }
}

/**
 * The property, asserted at both ends: every stored column is what `priceBands` says of the bands as
 * they now stand, and the filed file carries the one figure a gradebook takes from those five.
 */
async function expectLedgerAgreesWithBands(runId: string): Promise<number | null> {
  const bands = await scoring.readBands(runId)
  const priced = scoring.priceBands(bands, scoring.DEFAULT_MAPPING)
  expect(await columns(runId)).toEqual(priced)
  const screen = scoring.gradebookPointsOf(priced)
  const file = await filed(runId)
  expect(file.points).toBe(screen)
  return screen
}

describe('a decision made after a correction reaches the gradebook', () => {
  it('confirm → correct → override Framing up', async () => {
    const runId = await scoredRun(fx)
    await review.confirmRemaining(fx.instructor, runId)
    await correct(runId)

    // The correction really did write the three columns; without that the ordering below would be
    // exercising an uncorrected run and would have passed before the fix too.
    expect((await columns(runId)).effective).not.toBeNull()
    const afterCorrection = await filed(runId)

    const before = await effectiveOf(runId, 'framing')
    expect(before, 'the raise has to be a raise for the case to mean anything').not.toBe(
      'professional',
    )
    await review.decideBand(fx.instructor, runId, 'framing', {
      decision: 'overridden',
      band: 'professional',
      note: RAISE,
    })

    const points = await expectLedgerAgreesWithBands(runId)
    const latest = await filed(runId)
    expect(latest.version).toBe(afterCorrection.version + 1)
    expect(points).not.toBeNull()
    expect(points ?? 0).toBeGreaterThan(afterCorrection.points ?? 0)
  })

  it('correct → override up → confirm, which is the walkthrough’s own order', async () => {
    const runId = await scoredRun(fx)
    await correct(runId)
    // A correction on a run that is only `scored` writes no export; the confirmation below files v1.
    expect(await exportRows(runId)).toEqual([])

    expect(await effectiveOf(runId, 'framing')).not.toBe('professional')
    await review.decideBand(fx.instructor, runId, 'framing', {
      decision: 'overridden',
      band: 'professional',
      note: RAISE,
    })
    await review.confirmRemaining(fx.instructor, runId)

    const points = await expectLedgerAgreesWithBands(runId)
    expect((await filed(runId)).version).toBe(1)
    expect(points).not.toBeNull()
  })

  it('confirm → correct → override Framing down to Novice', async () => {
    const runId = await scoredRun(fx)
    await review.confirmRemaining(fx.instructor, runId)
    await correct(runId)
    const afterCorrection = await filed(runId)

    expect(await effectiveOf(runId, 'framing')).not.toBe('novice')
    await review.decideBand(fx.instructor, runId, 'framing', {
      decision: 'overridden',
      band: 'novice',
      note: LOWER,
    })

    // FR-005's floor is on the *correction*, not on the instructor: a correction may never lower a
    // band, and an instructor's override is final either way (FR-182, D-422). So the file follows
    // the bands down, and a run does not keep points its bands no longer support.
    const points = await expectLedgerAgreesWithBands(runId)
    expect(points ?? 0).toBeLessThan(afterCorrection.points ?? 0)
  })
})

describe('a correction leaves a dimension the instructor marked unassessed alone (D-512)', () => {
  it('prices over six dimensions in the columns and the file, not seven', async () => {
    const runId = await scoredRun(fx)
    await review.decideBand(fx.instructor, runId, 'verification', { decision: 'unassessed' })
    await review.confirmRemaining(fx.instructor, runId)
    const result = await correct(runId)

    // Nothing bands a dimension a faculty seat said this run cannot be assessed on — not the
    // recompute, and so not the column it writes, and not the block the `claim_neutralized` event
    // carries or the dialog the instructor presses Apply in.
    const verification = (await bandRows(runId)).find((row) => row.dimension === 'verification')
    expect(verification?.decision).toBe('unassessed')
    expect(verification?.band_after_correction).toBeNull()
    expect(await effectiveOf(runId, 'verification')).toBeNull()
    expect(result.recompute.bandsAfter.verification ?? null).toBeNull()
    expect(result.recompute.bandsEffective.verification ?? null).toBeNull()

    // The divisor is the six dimensions that carry a band, in the stored columns and in the file.
    // `effectiveBandOf` and `priceBands` always divided by six; the correction columns divided by
    // seven, and the export takes `points_effective` before `points_confirmed`.
    const bands = await scoring.readBands(runId)
    expect(bands.filter((band) => band.effectiveBand !== null)).toHaveLength(6)
    const points = await expectLedgerAgreesWithBands(runId)

    // Stated as the arithmetic rather than only as an equality with `priceBands`: the number the
    // gradebook receives is the mean of the six bands that carry one, and the seven-dimension mean
    // the correction used to write is a different number.
    const assessed = bands
      .map((band) => band.effectiveBand)
      .filter((band): band is NonNullable<typeof band> => band !== null)
    const mean =
      Math.round(
        (assessed.reduce((sum, band) => sum + scoring.DEFAULT_MAPPING[band], 0) / 6) * 1000,
      ) / 1000
    expect(points).toBe(mean)
    expect(result.recompute.pointsAfter).toBe((await columns(runId)).afterCorrection)
  })
})
