// Step 11.1 — band decisions against Postgres (docs/tech/10-backend-spec-modules.md §12;
// 07-api-spec.md §8; 08-auth-authz.md §4; FR-181, FR-182, FR-202, FR-184, D-087, D-423).
//
// What only a database can say about a decision is whether the *rest of the run* is still there
// afterwards, and whether the run moves exactly once. Six claims are worth one for.
//
//   * **A decision writes the decision half and nothing else** (D-423). `upsertBands` builds its SET
//     clause from the columns the caller named, and this is that path's first real caller: the
//     draft band, its rationale, its quotes and its evidence sequences must read the same before and
//     after.
//   * **The seventh decision confirms the run**, computes `points_confirmed` from the effective
//     bands under the course's mapping, writes course export v1 with reason `initial`, and tells the
//     student — and does none of that on the sixth.
//   * **A re-decision writes v2** with reason `override` (D-087, FR-184), and the first file is
//     still readable exactly as it was written.
//   * **An override carries its note**; `unassessed` is terminal and takes the dimension out of the
//     arithmetic rather than counting it as zero (FR-202, FR-004).
//   * **A TA cannot change a band the instructor decided** (08 §4), and may decide the others.
//   * **Every act writes an audit row** (SYS-011).
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'
import {
  auditRows,
  bandRows,
  exportRows,
  notificationRows,
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

beforeEach(async () => {
  await truncateAll()
  review = await import('@/server/modules/review')
  scoring = await import('@/server/modules/scoring')
  fx = await setupAssistantFixture('review-decisions')
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

/** Confirms every dimension but the one named, so the next decision is the seventh. */
async function decideAllBut(runId: string, hold: string): Promise<void> {
  for (const dimension of scoring.DIMENSIONS) {
    if (dimension === hold) continue
    await review.decideBand(fx.instructor, runId, dimension, { decision: 'confirmed' })
  }
}

describe('decideBand', () => {
  it('writes the decision half and leaves the draft half exactly as the pipeline wrote it', async () => {
    const runId = await scoredRun(fx)
    const before = await bandRows(runId)
    const framingBefore = before.find((band) => band.dimension === 'framing')
    if (!framingBefore) throw new Error('the scored run has no framing band')

    await review.decideBand(fx.instructor, runId, 'framing', {
      decision: 'overridden',
      band: 'developing',
      note: 'A wider net is defensible when information is thin.',
    })

    const after = await bandRows(runId)
    const framing = after.find((band) => band.dimension === 'framing')
    expect(framing).toMatchObject({
      decision: 'overridden',
      decided_band: 'developing',
      decided_by: fx.instructor.id,
      note: 'A wider net is defensible when information is thin.',
    })

    // D-423: the draft half is not named by the decision writer, so it is not written. Every one of
    // these came back NULL before the SET clause was built from the caller's own columns.
    expect(framing?.draft_band).toBe(framingBefore.draft_band)
    expect(framing?.draft_status).toBe(framingBefore.draft_status)
    expect(framing?.draft_reason).toBe(framingBefore.draft_reason)
    expect(framing?.basis).toBe(framingBefore.basis)
    expect(framing?.provisional).toBe(framingBefore.provisional)
    expect(framing?.graph_keys).toEqual(framingBefore.graph_keys)
    expect(framing?.evidence_event_seqs).toEqual(framingBefore.evidence_event_seqs)
    expect(framing?.quotes).toEqual(framingBefore.quotes)
    expect(framing?.rationale).toBe(framingBefore.rationale)

    // And no other dimension was touched at all.
    for (const row of after) {
      if (row.dimension === 'framing') continue
      expect(row).toEqual(before.find((band) => band.dimension === row.dimension))
    }
  })

  it('writes a band_decision event and an audit row for every decision', async () => {
    const runId = await scoredRun(fx)
    await review.decideBand(fx.instructor, runId, 'ownership', {
      decision: 'unassessed',
      note: 'The interview was cut short by a room change.',
    })

    const { eventsOfType } = await import('./fixture')
    const events = await eventsOfType(runId, 'band_decision')
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({
      dimension: 'ownership',
      decision: 'unassessed',
      band: null,
      note: 'The interview was cut short by a room change.',
    })

    const audits = await auditRows(runId)
    const decision = audits.filter((row) => row.action === 'band.decide')
    expect(decision).toHaveLength(1)
    expect(decision[0]?.actor_id).toBe(fx.instructor.id)
    expect(decision[0]?.metadata).toMatchObject({ dimension: 'ownership', decision: 'unassessed' })
  })

  it('confirms the run only on the seventh decision, and writes export v1 with reason initial', async () => {
    const runId = await scoredRun(fx)
    await decideAllBut(runId, 'ownership')

    // Six decided: still `scored`, no points, no export, no notice.
    expect(await runRow(runId)).toMatchObject({ state: 'scored', confirmed_at: null })
    expect((await scoreRow(runId))?.points_confirmed).toBeNull()
    expect(await exportRows(runId)).toHaveLength(0)
    expect(
      (await notificationRows(runId)).filter((row) => row.type === 'bands_confirmed'),
    ).toHaveLength(0)

    const result = await review.decideBand(fx.instructor, runId, 'ownership', {
      decision: 'confirmed',
    })
    expect(result.run.state).toBe('confirmed')

    const run = await runRow(runId)
    expect(run.state).toBe('confirmed')
    expect(run.confirmed_at).not.toBeNull()

    const exports = await exportRows(runId)
    expect(exports).toHaveLength(1)
    expect(exports[0]).toMatchObject({
      version: 1,
      reason: 'initial',
      created_by: fx.instructor.id,
    })

    // FR-181: the student is told, and is told nothing about how the run was read.
    const notices = (await notificationRows(runId)).filter((row) => row.type === 'bands_confirmed')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ user_id: fx.student.id, link: `/runs/${runId}/debrief` })
    const text = `${notices[0]?.title} ${notices[0]?.body}`.toLowerCase()
    for (const word of ['novice', 'developing', 'proficient', 'professional', 'point']) {
      expect(text).not.toContain(word)
    }
  })

  it('computes points_confirmed as the mean over the assessed dimensions under the mapping', async () => {
    const runId = await scoredRun(fx)
    await review.decideBand(fx.instructor, runId, 'framing', {
      decision: 'overridden',
      band: 'professional',
    })
    await review.decideBand(fx.instructor, runId, 'ownership', { decision: 'unassessed' })
    for (const dimension of scoring.DIMENSIONS) {
      if (dimension === 'framing' || dimension === 'ownership') continue
      await review.decideBand(fx.instructor, runId, dimension, { decision: 'confirmed' })
    }

    const bands = await scoring.readBands(runId)
    const expected = scoring.computePoints(scoring.effectiveBandsOf(bands), scoring.DEFAULT_MAPPING)
    expect(expected).not.toBeNull()
    expect(Number((await scoreRow(runId))?.points_confirmed)).toBeCloseTo(expected ?? 0, 3)

    // FR-202, FR-004: the unassessed dimension is excluded from the mean, never counted as zero.
    const assessed = bands.filter((band) => band.effectiveBand !== null)
    expect(assessed).toHaveLength(6)
    expect(bands.find((band) => band.dimension === 'ownership')?.effectiveBand).toBeNull()
  })

  it('writes a second export with reason override when a confirmed band is re-decided', async () => {
    const runId = await scoredRun(fx)
    await review.confirmRemaining(fx.instructor, runId)
    const first = await exportRows(runId)
    expect(first).toHaveLength(1)

    await review.decideBand(fx.instructor, runId, 'calibration', {
      decision: 'overridden',
      band: 'professional',
      note: 'The two false challenges were both on weakly sourced claims.',
    })

    const exports = await exportRows(runId)
    expect(exports.map((row) => [row.version, row.reason])).toEqual([
      [1, 'initial'],
      [2, 'override'],
    ])
    // D-087: version 1 answers what it answered, whatever version 2 says.
    expect(exports[0]?.file).toEqual(first[0]?.file)

    // The run is still confirmed once, and its points moved with the override.
    const run = await runRow(runId)
    expect(run.state).toBe('confirmed')
    const bands = await scoring.readBands(runId)
    expect(bands.find((band) => band.dimension === 'calibration')?.effectiveBand).toBe(
      'professional',
    )
    expect(Number((await scoreRow(runId))?.points_confirmed)).toBeCloseTo(
      scoring.computePoints(scoring.effectiveBandsOf(bands), scoring.DEFAULT_MAPPING) ?? 0,
      3,
    )
  })

  it('refuses an override that names no band', async () => {
    const runId = await scoredRun(fx)
    await expect(
      review.decideBand(fx.instructor, runId, 'framing', { decision: 'overridden' }),
    ).rejects.toMatchObject({ code: 'BAND_DECISION_INVALID' })
  })

  it('refuses a decision on a run whose bands nobody has drafted', async () => {
    const { runToDefenseComplete } = await import('./fixture')
    const runId = await runToDefenseComplete(fx)
    await expect(
      review.decideBand(fx.instructor, runId, 'framing', { decision: 'confirmed' }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_SCORED' })
  })
})

describe('confirmRemaining', () => {
  it('confirms every undecided dimension with its draft and confirms the run', async () => {
    const runId = await scoredRun(fx)
    const drafts = await scoring.readBands(runId)

    const run = await review.confirmRemaining(fx.instructor, runId)
    expect(run.state).toBe('confirmed')

    const bands = await bandRows(runId)
    expect(bands).toHaveLength(7)
    for (const band of bands) {
      const draft = drafts.find((row) => row.dimension === band.dimension)
      // A drafted band is confirmed at its draft; an unassessed draft becomes `unassessed` (10 §12).
      expect(band.decision).toBe(draft?.band === null ? 'unassessed' : 'confirmed')
      expect(band.decided_band).toBe(draft?.band ?? null)
      expect(band.decided_by).toBe(fx.instructor.id)
    }
    expect(await exportRows(runId)).toHaveLength(1)
  })

  it('leaves an existing decision alone and writes nothing when there is nothing left', async () => {
    const runId = await scoredRun(fx)
    await review.decideBand(fx.instructor, runId, 'framing', {
      decision: 'overridden',
      band: 'novice',
      note: 'The three assumptions are one assumption said three ways.',
    })
    await review.confirmRemaining(fx.instructor, runId)

    const framing = (await bandRows(runId)).find((band) => band.dimension === 'framing')
    expect(framing).toMatchObject({ decision: 'overridden', decided_band: 'novice' })

    // A second press decides nothing and files no second export.
    await review.confirmRemaining(fx.instructor, runId)
    expect(await exportRows(runId)).toHaveLength(1)
  })
})

describe('the TA lock (08 §4)', () => {
  it('lets a TA decide a dimension the instructor has not touched', async () => {
    const runId = await scoredRun(fx)
    const result = await review.decideBand(fx.ta, runId, 'delegation', { decision: 'confirmed' })
    expect(result.band.decision).toBe('confirmed')
    expect(result.band.decidedBy).toBe(fx.ta.id)
  })

  it('refuses a TA changing a band the instructor decided', async () => {
    const runId = await scoredRun(fx)
    await review.decideBand(fx.instructor, runId, 'framing', {
      decision: 'overridden',
      band: 'professional',
    })

    await expect(
      review.decideBand(fx.ta, runId, 'framing', { decision: 'confirmed' }),
    ).rejects.toMatchObject({ code: 'BAND_LOCKED_BY_INSTRUCTOR' })

    // Nothing moved.
    const framing = (await bandRows(runId)).find((band) => band.dimension === 'framing')
    expect(framing).toMatchObject({ decision: 'overridden', decided_band: 'professional' })
  })

  it('lets an instructor change a band the TA decided', async () => {
    const runId = await scoredRun(fx)
    await review.decideBand(fx.ta, runId, 'framing', { decision: 'confirmed' })
    const result = await review.decideBand(fx.instructor, runId, 'framing', {
      decision: 'overridden',
      band: 'novice',
    })
    expect(result.band.decision).toBe('overridden')
    expect(result.band.decidedBy).toBe(fx.instructor.id)
  })

  it('refuses a TA re-deciding after the run is confirmed', async () => {
    const runId = await scoredRun(fx)
    await review.confirmRemaining(fx.instructor, runId)
    await expect(
      review.decideBand(fx.ta, runId, 'framing', { decision: 'overridden', band: 'novice' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
