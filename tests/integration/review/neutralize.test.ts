// Step 11.1 — neutralization against Postgres (docs/tech/10-backend-spec-modules.md §11.5, §12;
// FR-003, FR-005, FR-232, D-092, D-420, D-423).
//
// A neutralization is Tassl admitting its own error on a run that may already have been graded, so
// the properties worth a database are the ones about what it must *not* disturb.
//
//   * **The recompute never lowers anything.** Every affected dimension keeps the higher of its pre-
//     and post-correction band, and the run keeps the higher of its two point totals (FR-005).
//   * **The instructor's decision survives it** (FR-182, D-422, D-423). A correction writes the two
//     correction columns and nothing else: `decision`, `decided_band`, `decided_by` and the note
//     read the same before and after, and the effective band is the decision with the correction as
//     a floor beneath it — never the other way round.
//   * **A confirmed run re-exports**, with the version incrementing and the reason recorded
//     (FR-184, FR-232, D-087); a run that is only `scored` writes no export, because it has none.
//   * **The package version is flagged for its author** (FR-003).
//   * **The credit path marks `inconsistency_credited`** (D-092), for that run only.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'
import {
  auditRows,
  bandRows,
  claimByKey,
  eventsOfType,
  exportRows,
  packageVersionReview,
  runClaimRow,
  runRow,
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

const RANK: Record<string, number> = { novice: 0, developing: 1, proficient: 2, professional: 3 }
const atLeast = (band: string | null, floor: string | null): boolean =>
  floor === null || (band !== null && (RANK[band] ?? 0) >= (RANK[floor] ?? 0))

beforeEach(async () => {
  await truncateAll()
  review = await import('@/server/modules/review')
  scoring = await import('@/server/modules/scoring')
  fx = await setupAssistantFixture('review-neutralize')
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

const NOTE = 'Document D4 contradicts D2 unintentionally, so this claim was never fair to judge.'

describe('neutralizeClaim on a scored run', () => {
  it('recomputes the two computed dimensions and never lowers a band or the points', async () => {
    const runId = await scoredRun(fx)
    const before = await scoring.readBands(runId)
    const claimId = fx.claimId(claimByKey('C3').key)

    const result = await review.neutralizeClaim(fx.instructor, runId, claimId, {
      reason: 'unintended_defect',
      creditChallenge: false,
      note: NOTE,
    })

    expect(result.recompute.dimensions).toEqual(['verification', 'calibration'])
    for (const dimension of result.recompute.dimensions) {
      const beforeBand = before.find((band) => band.dimension === dimension)?.effectiveBand ?? null
      expect(result.recompute.bandsBefore[dimension] ?? null).toBe(beforeBand)
      // FR-005: the effective band is the higher of the two, so it can rise and can never fall.
      expect(atLeast(result.recompute.bandsEffective[dimension] ?? null, beforeBand)).toBe(true)
    }
    expect(
      result.recompute.pointsEffective === null ||
        result.recompute.pointsBefore === null ||
        result.recompute.pointsEffective >= result.recompute.pointsBefore,
    ).toBe(true)

    // The stored effective band agrees with what the call reported.
    const after = await scoring.readBands(runId)
    for (const dimension of result.recompute.dimensions) {
      expect(after.find((band) => band.dimension === dimension)?.effectiveBand).toBe(
        result.recompute.bandsEffective[dimension] ?? null,
      )
    }
  })

  it('writes the correction columns and leaves the decision half untouched (D-422, D-423)', async () => {
    const runId = await scoredRun(fx)
    await review.decideBand(fx.instructor, runId, 'calibration', {
      decision: 'overridden',
      band: 'professional',
      note: 'The two false challenges were both on weakly sourced claims.',
    })
    const before = (await bandRows(runId)).find((band) => band.dimension === 'calibration')
    if (!before) throw new Error('no calibration band')

    await review.neutralizeClaim(fx.instructor, runId, fx.claimId(claimByKey('C3').key), {
      reason: 'wrong_verification_result',
      creditChallenge: false,
      note: NOTE,
    })

    const after = (await bandRows(runId)).find((band) => band.dimension === 'calibration')
    // D-423: the correction writer names the two correction columns and no decision column.
    expect(after?.decision).toBe('overridden')
    expect(after?.decided_band).toBe('professional')
    expect(after?.decided_by).toBe(fx.instructor.id)
    expect(after?.note).toBe(before.note)
    expect(after?.draft_band).toBe(before.draft_band)
    expect(after?.rationale).toBe(before.rationale)
    expect(after?.band_after_correction).not.toBeNull()

    // D-422: the instructor's decision stands, with the correction as a floor beneath it. An
    // override to Professional is never read back as the recomputed band.
    const view = (await scoring.readBands(runId)).find((band) => band.dimension === 'calibration')
    expect(view?.effectiveBand).toBe('professional')
  })

  it('writes the claim_neutralized event with the recompute block and its two point totals', async () => {
    const runId = await scoredRun(fx)
    const claimId = fx.claimId(claimByKey('C3').key)
    await review.neutralizeClaim(fx.instructor, runId, claimId, {
      reason: 'unintended_defect',
      creditChallenge: false,
      note: NOTE,
    })

    const events = await eventsOfType(runId, 'claim_neutralized')
    expect(events).toHaveLength(1)
    const payload = events[0]?.payload as Record<string, unknown>
    expect(payload).toMatchObject({
      claim_id: claimId,
      reason: 'unintended_defect',
      credit_challenge: false,
      note: NOTE,
    })
    // D-420: the two point totals sit at the top level, where `owner-view.ts` can withhold them
    // from the student's copy of their own record; `recompute` carries only what moved.
    expect(payload).toHaveProperty('points_before')
    expect(payload).toHaveProperty('points_after')
    const block = payload.recompute as Record<string, unknown>
    expect(block.dimensions).toEqual(['verification', 'calibration'])
    expect(JSON.stringify(block)).not.toContain('points')

    // FR-232: the run is stamped adjusted, and stays in the state it was in.
    const run = await runRow(runId)
    expect(run.adjusted_at).not.toBeNull()
    expect(run.state).toBe('scored')
  })

  it('flags the package version for its author and writes an audit row (FR-003)', async () => {
    const runId = await scoredRun(fx)
    await review.neutralizeClaim(fx.instructor, runId, fx.claimId(claimByKey('C3').key), {
      reason: 'misbehaving_material',
      creditChallenge: false,
      note: NOTE,
    })

    const version = await packageVersionReview(fx.versionId)
    expect(version?.review_requested_at).not.toBeNull()
    expect(version?.review_reason).toBe('misbehaving_material')

    const audits = (await auditRows(runId)).filter((row) => row.action === 'claim.neutralize')
    expect(audits).toHaveLength(1)
    expect(audits[0]?.actor_id).toBe(fx.instructor.id)
  })

  it('marks inconsistency_credited on the credit-challenge path (D-092)', async () => {
    const runId = await scoredRun(fx)
    const claimId = fx.claimId(claimByKey('C1').key)

    await review.neutralizeClaim(fx.instructor, runId, claimId, {
      reason: 'wrong_verification_result',
      creditChallenge: true,
      note: 'The Source Trace returned the wrong passage, and the challenge was right.',
    })

    const claim = await runClaimRow(runId, claimId)
    expect(claim).toMatchObject({ inconsistency_credited: true })
    expect(claim?.neutralization_id).not.toBeNull()

    const events = await eventsOfType(runId, 'claim_neutralized')
    expect(events[0]?.payload).toMatchObject({ credit_challenge: true })
  })

  it('refuses a second correction on the same claim, and a claim from another package', async () => {
    const runId = await scoredRun(fx)
    const claimId = fx.claimId(claimByKey('C3').key)
    await review.neutralizeClaim(fx.instructor, runId, claimId, {
      reason: 'unintended_defect',
      creditChallenge: false,
      note: NOTE,
    })
    await expect(
      review.neutralizeClaim(fx.instructor, runId, claimId, {
        reason: 'other',
        creditChallenge: false,
        note: NOTE,
      }),
    ).rejects.toMatchObject({ code: 'NEUTRALIZATION_EXISTS' })

    await expect(
      review.neutralizeClaim(fx.instructor, runId, crypto.randomUUID(), {
        reason: 'other',
        creditChallenge: false,
        note: NOTE,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('refuses a TA: void, re-offer and neutralize are the instructor’s (08 §4)', async () => {
    const runId = await scoredRun(fx)
    await expect(
      review.neutralizeClaim(fx.ta, runId, fx.claimId(claimByKey('C3').key), {
        reason: 'other',
        creditChallenge: false,
        note: NOTE,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('writes no export on a run that was never confirmed', async () => {
    const runId = await scoredRun(fx)
    const result = await review.neutralizeClaim(
      fx.instructor,
      runId,
      fx.claimId(claimByKey('C3').key),
      {
        reason: 'unintended_defect',
        creditChallenge: false,
        note: NOTE,
      },
    )
    expect(result.exportVersion).toBeNull()
    expect(await exportRows(runId)).toHaveLength(0)
  })
})

describe('neutralizeClaim on a confirmed run (FR-232, FR-184)', () => {
  it('increments the export version with reason neutralization and floors the points', async () => {
    const runId = await scoredRun(fx)
    await review.confirmRemaining(fx.instructor, runId)
    const confirmedPoints = Number((await scoreRow(runId))?.points_confirmed)
    expect(await exportRows(runId)).toHaveLength(1)

    const result = await review.neutralizeClaim(
      fx.instructor,
      runId,
      fx.claimId(claimByKey('C3').key),
      { reason: 'unintended_defect', creditChallenge: false, note: NOTE },
    )

    const exports = await exportRows(runId)
    expect(exports.map((row) => [row.version, row.reason])).toEqual([
      [1, 'initial'],
      [2, 'neutralization'],
    ])
    expect(result.exportVersion).toBe(2)

    // FR-005: the run keeps the higher of its two point totals, and all three are recorded.
    const score = await scoreRow(runId)
    expect(score?.points_before_correction).not.toBeNull()
    expect(score?.points_after_correction).not.toBeNull()
    expect(Number(score?.points_effective)).toBeGreaterThanOrEqual(
      Number(score?.points_before_correction),
    )
    expect(Number(score?.points_before_correction)).toBeCloseTo(confirmedPoints, 3)

    // D-423 the other way round, restated by D-510: the correction wrote **every** point column,
    // and each is what `scoring.priceBands` says of the bands the run now stands on — which is the
    // arithmetic the replay and the debrief print. `points_confirmed` moves with the correction's
    // floor because that is what `priceBands.confirmed` has always meant (the mean of the effective
    // bands), and the figure the confirmation itself computed is kept where FR-005 puts it, in
    // `points_before_correction` asserted three lines above. A frozen `points_confirmed` was a
    // second answer to what a run is worth, and it was the answer the export read.
    const priced = scoring.priceBands(await scoring.readBands(runId), scoring.DEFAULT_MAPPING)
    expect(Number(score?.points_confirmed)).toBeCloseTo(Number(priced.confirmed), 3)
    expect(Number(score?.points_before_correction)).toBeCloseTo(Number(priced.beforeCorrection), 3)
    expect(Number(score?.points_after_correction)).toBeCloseTo(Number(priced.afterCorrection), 3)
    expect(Number(score?.points_effective)).toBeCloseTo(Number(priced.effective), 3)
    expect(Number(score?.points_draft)).toBeCloseTo(Number(priced.draft), 3)
    expect(score?.points_draft).not.toBeNull()

    // The newest file carries the effective points, which is what a gradebook reads (FR-005).
    const latest = exports[1]?.file as { computed?: { points?: number | null } }
    expect(latest.computed?.points).toBeCloseTo(Number(score?.points_effective), 3)

    // The run stays confirmed and is stamped adjusted rather than transitioned (10 §9).
    expect(await runRow(runId)).toMatchObject({ state: 'confirmed' })
    expect((await runRow(runId)).adjusted_at).not.toBeNull()
  })
})
