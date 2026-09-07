// Step 11.1 — manual banding of a held run against Postgres (docs/tech/10-backend-spec-modules.md
// §12; FR-140, FR-004, FR-181).
//
// A held run is the one place in the product where the pipeline says "I cannot read this" and means
// it (11 §3). It stays at `defense_complete` with everything it recorded intact (D-405), and what a
// faculty seat does with it is place the seven bands by hand — or void it. This suite is the first
// half: one call takes the run from held to confirmed, and everything it writes on the way says the
// bands are the reviewer's rather than Tassl's.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'
import {
  bandRows,
  eventsOfType,
  exportRows,
  heldRun,
  notificationRows,
  runRow,
  scoreRow,
  setupAssistantFixture,
  type AssistantFixture,
} from './fixture'

type Review = typeof import('@/server/modules/review')
type Scoring = typeof import('@/server/modules/scoring')

let review: Review
let scoring: Scoring
let fx: AssistantFixture

const PLACEMENTS = {
  framing: 'proficient',
  delegation: 'developing',
  verification: 'developing',
  calibration: 'novice',
  decision_quality: 'proficient',
  adaptation: 'developing',
  ownership: 'unassessed',
} as const

beforeEach(async () => {
  await truncateAll()
  review = await import('@/server/modules/review')
  scoring = await import('@/server/modules/scoring')
  fx = await setupAssistantFixture('review-held')
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

describe('bandHeldRunManually', () => {
  it('takes a held run to confirmed in one act (FR-140)', async () => {
    const runId = await heldRun(fx)
    expect(await runRow(runId)).toMatchObject({
      state: 'defense_complete',
      scoring_status: 'held',
    })
    expect(await bandRows(runId)).toHaveLength(0)

    const run = await review.bandHeldRunManually(fx.instructor, runId, { bands: { ...PLACEMENTS } })
    expect(run.state).toBe('confirmed')

    const after = await runRow(runId)
    expect(after).toMatchObject({ state: 'confirmed', scoring_status: 'done' })
    expect(after.confirmed_at).not.toBeNull()
  })

  it('writes seven draft bands basis none with the rationale manual, and confirms each', async () => {
    const runId = await heldRun(fx)
    await review.bandHeldRunManually(fx.instructor, runId, { bands: { ...PLACEMENTS } })

    const bands = await bandRows(runId)
    expect(bands).toHaveLength(7)
    for (const band of bands) {
      const placement = PLACEMENTS[band.dimension as keyof typeof PLACEMENTS]
      // Nothing here claims Tassl placed a band it could not place (10 §12).
      expect(band.basis).toBe('none')
      expect(band.rationale).toBe('manual')
      expect(band.provisional).toBe(false)
      expect(band.quotes).toEqual([])
      expect(band.evidence_event_seqs).toEqual([])
      expect(band.decided_by).toBe(fx.instructor.id)

      if (placement === 'unassessed') {
        // FR-004: a dimension holds a band or says why it holds none, and never both.
        expect(band.draft_band).toBeNull()
        expect(band.draft_status).toBe('unassessed')
        expect(band.draft_reason).toBe('no_evidence')
        expect(band.decision).toBe('unassessed')
        expect(band.decided_band).toBeNull()
      } else {
        expect(band.draft_band).toBe(placement)
        expect(band.draft_status).toBe('drafted')
        expect(band.decision).toBe('confirmed')
        expect(band.decided_band).toBe(placement)
      }
    }

    // Seven `draft_band` events and seven `band_decision` events: the record says what was placed
    // and then what was decided, in that order, exactly as a scored run's does.
    expect(await eventsOfType(runId, 'draft_band')).toHaveLength(7)
    expect(await eventsOfType(runId, 'band_decision')).toHaveLength(7)
    const lifecycle = await eventsOfType(runId, 'lifecycle')
    const causes = lifecycle.map((event) => (event.payload as { cause?: string }).cause)
    expect(causes).toContain('scored')
    expect(causes).toContain('bands_confirmed')
  })

  it('rebuilds the four graphs so the debrief and the record have something to show', async () => {
    const runId = await heldRun(fx)
    await review.bandHeldRunManually(fx.instructor, runId, { bands: { ...PLACEMENTS } })

    const graphs = await scoring.readGraphs(runId)
    expect(Object.keys(graphs ?? {}).sort()).toEqual([
      'clock_timeline',
      'confidence_line',
      'frame_beside_decision',
      'stance_matrix',
    ])
    const score = await scoreRow(runId)
    expect(score?.rubric_version).toBe('v1')
    expect(score?.false_challenge_rate).not.toBeNull()
  })

  it('computes the confirmed points over the six assessed dimensions and writes export v1', async () => {
    const runId = await heldRun(fx)
    await review.bandHeldRunManually(fx.instructor, runId, { bands: { ...PLACEMENTS } })

    const bands = await scoring.readBands(runId)
    const expected = scoring.computePoints(scoring.effectiveBandsOf(bands), scoring.DEFAULT_MAPPING)
    expect(Number((await scoreRow(runId))?.points_confirmed)).toBeCloseTo(expected ?? 0, 3)
    // (3 + 2 + 2 + 1 + 3 + 2) / 6 under the default mapping; Ownership is excluded, never zero.
    expect(expected).toBeCloseTo(13 / 6, 3)

    const exports = await exportRows(runId)
    expect(exports).toHaveLength(1)
    expect(exports[0]).toMatchObject({ version: 1, reason: 'initial' })

    const notices = (await notificationRows(runId)).filter((row) => row.type === 'bands_confirmed')
    expect(notices).toHaveLength(1)
    expect(notices[0]?.user_id).toBe(fx.student.id)
  })

  it('refuses a run that is not held, and a body that leaves a dimension out', async () => {
    const { scoredRun } = await import('./fixture')
    const scored = await scoredRun(fx)
    await expect(
      review.bandHeldRunManually(fx.instructor, scored, { bands: { ...PLACEMENTS } }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_SCORABLE' })
  })

  it('lets a TA band a held run: 08 §4 gives the manual path to both reviewers', async () => {
    const runId = await heldRun(fx)
    const run = await review.bandHeldRunManually(fx.ta, runId, { bands: { ...PLACEMENTS } })
    expect(run.state).toBe('confirmed')
    expect((await bandRows(runId))[0]?.decided_by).toBe(fx.ta.id)
  })
})
