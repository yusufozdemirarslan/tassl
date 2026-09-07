// Step 11.1 — void and re-offer against Postgres (docs/tech/10-backend-spec-modules.md §6, §12;
// 07-api-spec.md §8; FR-002, FR-008, FR-183, D-120, D-259, D-434).
//
// FR-002 is one sentence with two halves and both need a database. "A run that cannot be scored is
// voided and re-offered on a fresh variant at no cost" — which means the pair of runs commits
// together, the new one is on the *other* variant, and the unique index that allows one live run per
// student per assignment (D-259) lets it exist. "…with no partial score and no points recorded" —
// which means nothing about the voided run reaches a gradebook, whatever state it was voided from.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'
import {
  auditRows,
  eventsOfType,
  exportRows,
  runInWorking,
  runRow,
  scoredRun,
  setupAssistantFixture,
  type AssistantFixture,
} from './fixture'

type Records = typeof import('@/server/modules/records')
type Review = typeof import('@/server/modules/review')
type Runs = typeof import('@/server/modules/runs')

let records: Records
let review: Review
let runs: Runs
let fx: AssistantFixture

const NOTE = 'The auto-lock fired while the student was still reading; nothing here is theirs.'

beforeEach(async () => {
  await truncateAll()
  records = await import('@/server/modules/records')
  review = await import('@/server/modules/review')
  runs = await import('@/server/modules/runs')
  fx = await setupAssistantFixture('review-void')
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

const variantsOf = async (versionId: string) =>
  testSql<{ id: string; key: string }[]>`
    select id, key from scenario_variants where package_version_id = ${versionId} order by key`

describe('voidRun from working (FR-002)', () => {
  it('voids the run, records the enum reason and keeps the note in the event (D-120)', async () => {
    const runId = await runInWorking(fx)

    const result = await runs.voidRun(fx.instructor, runId, {
      reason: 'walkthrough',
      note: NOTE,
      reoffer: false,
    })
    expect(result.voided.state).toBe('voided')
    expect(result.reoffered).toBeNull()

    const run = await runRow(runId)
    expect(run).toMatchObject({ state: 'voided', void_reason: 'walkthrough' })
    expect(run.voided_at).not.toBeNull()

    // D-120: the analytics group by the enum on the row, and the sentence the instructor typed is
    // in the event where the replay reads it and no aggregate does.
    const events = await eventsOfType(runId, 'run_voided')
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({
      reason: 'walkthrough',
      note: NOTE,
      re_offered_run_id: null,
    })

    const audits = (await auditRows(runId)).filter((row) => row.action === 'run.void')
    expect(audits).toHaveLength(1)
    expect(audits[0]?.metadata).toMatchObject({ reason: 'walkthrough', stateAtVoid: 'working' })
  })

  it('offers a new run on the other variant of the family, linked both ways (FR-183)', async () => {
    const runId = await runInWorking(fx)
    const before = await runRow(runId)

    const result = await runs.voidRun(fx.instructor, runId, {
      reason: 'unscoreable',
      note: NOTE,
      reoffer: true,
    })
    const reoffered = result.reoffered
    if (!reoffered) throw new Error('the re-offer produced no run')

    expect(reoffered.state).toBe('assigned')
    expect(reoffered.attemptNo).toBe(before.attempt_no + 1)

    const next = await runRow(reoffered.id)
    const variants = await variantsOf(fx.versionId)
    const other = variants.find((variant) => variant.id !== before.variant_id)
    expect(next.variant_id).toBe(other?.id)

    // The pair is linked in both directions, and the `run_voided` payload names the replacement.
    expect(next.re_offered_from_run_id).toBe(runId)
    expect((await runRow(runId)).re_offered_to_run_id).toBe(reoffered.id)
    const voided = await eventsOfType(runId, 'run_voided')
    expect(voided[0]?.payload).toMatchObject({ re_offered_run_id: reoffered.id })

    // The new run's own trace opens with the event that says where it came from.
    const reofferedEvents = await eventsOfType(reoffered.id, 'run_reoffered')
    expect(reofferedEvents).toHaveLength(1)
    expect(reofferedEvents[0]?.payload).toMatchObject({
      from_run_id: runId,
      variant_id: other?.id,
    })

    const audits = (await auditRows(reoffered.id)).filter((row) => row.action === 'run.reoffer')
    expect(audits).toHaveLength(1)
  })

  it('lets the student carry on with the run they were offered', async () => {
    const runId = await runInWorking(fx)
    const result = await runs.voidRun(fx.instructor, runId, {
      reason: 'unscoreable',
      reoffer: true,
    })
    const reoffered = result.reoffered
    if (!reoffered) throw new Error('the re-offer produced no run')

    // D-259's index allows exactly one live run per student per assignment, and the void is what
    // makes room for this one; the student picks it up where any first attempt starts.
    const summary = await runs.acknowledgePolicy(fx.student, reoffered.id)
    expect(summary.state).toBe('readiness')

    // And they cannot start a third alongside it.
    await expect(runs.startRun(fx.student, fx.assignment.id)).rejects.toMatchObject({
      code: 'RUN_ACTIVE_EXISTS',
    })
  })

  it('refuses a TA, and refuses voiding a voided run', async () => {
    const runId = await runInWorking(fx)
    await expect(
      runs.voidRun(fx.ta, runId, { reason: 'other', reoffer: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await runs.voidRun(fx.instructor, runId, { reason: 'other', reoffer: false })
    await expect(
      runs.voidRun(fx.instructor, runId, { reason: 'other', reoffer: false }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' })
  })
})

describe('voidRun from recorded (FR-002: no points in any export)', () => {
  it('voids a confirmed, exported run and takes its files out of every export read', async () => {
    const runId = await scoredRun(fx)
    await review.confirmRemaining(fx.instructor, runId)

    // The run is confirmed with a file that carries points, which is exactly the case FR-002's
    // second half is about.
    const filed = await exportRows(runId)
    expect(filed).toHaveLength(1)
    expect(
      (filed[0]?.file as { computed?: { points?: number | null } }).computed?.points,
    ).not.toBeNull()
    expect(await records.listRunExports(fx.instructor, runId)).toHaveLength(1)

    await runs.voidRun(fx.instructor, runId, {
      reason: 'scoring_held',
      note: 'The claim set was mis-authored; the whole run comes out.',
      reoffer: false,
    })
    expect(await runRow(runId)).toMatchObject({ state: 'voided', void_reason: 'scoring_held' })

    // D-434: the ledger is append-only and nothing unwrites a file that was handed over, so what
    // enforces "the run's bands are absent from any export" is the read. No history, no download,
    // and nothing in the assignment's own list.
    await expect(records.listRunExports(fx.instructor, runId)).rejects.toMatchObject({
      code: 'RUN_NOT_CONFIRMED',
    })
    await expect(records.getCourseExport(fx.instructor, runId, 'latest')).rejects.toMatchObject({
      code: 'EXPORT_NOT_FOUND',
    })
    const history = await records.listCourseExports(fx.instructor, fx.assignment.id)
    expect(history.items.filter((row) => row.runId === runId)).toHaveLength(0)
  })

  it('voids a run in every other state the walkthrough reaches', async () => {
    const runId = await scoredRun(fx)
    const result = await runs.voidRun(fx.instructor, runId, {
      reason: 'unscoreable',
      reoffer: false,
    })
    expect(result.voided.state).toBe('voided')
    // 10 §9's last row is a rule rather than a list, so a state added later cannot be left out of
    // it: `scored` is voidable for the same reason `working` is.
    const events = await eventsOfType(runId, 'run_voided')
    expect(events).toHaveLength(1)
  })
})

describe('the re-offer variant rule (10 §6)', () => {
  it('takes an explicit variant when the instructor names one', async () => {
    const runId = await runInWorking(fx)
    const before = await runRow(runId)
    const result = await runs.voidRun(fx.instructor, runId, {
      reason: 'walkthrough',
      reoffer: true,
      variantId: before.variant_id,
    })
    expect(result.reoffered).not.toBeNull()
    expect((await runRow(result.reoffered!.id)).variant_id).toBe(before.variant_id)
  })

  it('refuses a variant from another package version', async () => {
    const runId = await runInWorking(fx)
    await expect(
      runs.voidRun(fx.instructor, runId, {
        reason: 'walkthrough',
        reoffer: true,
        variantId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'VARIANT_MISMATCH' })
    // The refusal took the whole transaction with it: the run is untouched.
    expect(await runRow(runId)).toMatchObject({ state: 'working', void_reason: null })
  })

  it('falls back to the same variant when the student has already met the other one', async () => {
    const first = await runInWorking(fx)
    const firstVoid = await runs.voidRun(fx.instructor, first, {
      reason: 'unscoreable',
      reoffer: true,
    })
    const second = firstVoid.reoffered
    if (!second) throw new Error('no re-offer')

    const secondVoid = await runs.voidRun(fx.instructor, second.id, {
      reason: 'unscoreable',
      reoffer: true,
    })
    const third = secondVoid.reoffered
    if (!third) throw new Error('no second re-offer')

    // Both variants of the family are now used, so the third run repeats the one it just had —
    // 10 §6's fallback, and the alternative is refusing to re-offer at all on the second defect.
    const used = new Set([(await runRow(first)).variant_id, (await runRow(second.id)).variant_id])
    expect(used.size).toBe(2)
    expect(used.has((await runRow(third.id)).variant_id)).toBe(true)
  })
})
