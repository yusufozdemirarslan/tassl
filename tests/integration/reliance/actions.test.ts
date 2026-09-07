// Step 8.1 — interrogation actions (FR-070 to FR-074, D-132), against a real database.
//
// Four rules, and each one fails in a way a screen would not show:
//
//   * **Only what the author authored.** Source Trace is on every sourced claim; the Replication and
//     Decomposition Checks only where the confirmed verification paths name them (FR-071). An
//     action offered where no path exists would return nothing and charge for it.
//   * **The cost is taken at the start, before the result** (FR-072). The trace stamps the clock
//     reading from the run row as the transaction leaves it, so a charge written after the event
//     would record the time the student had *before* they spent it — and Phase 10's clock timeline
//     is drawn from exactly that number.
//   * **An action that started with time left completes** (FR-072), even when its cost outruns the
//     clock. The cap is in `chargeCost`: a four-minute check begun with thirty seconds left costs
//     thirty seconds, returns its result, and leaves the clock on zero.
//   * **Nothing says whether the claim is right** (FR-073). The result is the author's payload
//     verbatim and carries no verdict, and no path but the one asked for comes back.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import {
  CLOCK_SKEW_MS,
  actionRows,
  codeOf,
  delegate,
  eventsOfType,
  forcePaused,
  forceState,
  openDocument,
  runInWorking,
  runRow,
  setClockRemaining,
  setupAssistantFixture,
  verificationPaths,
  type AssistantFixture,
} from './fixture'

type Reliance = typeof import('@/server/modules/reliance')

let reliance: Reliance
let fx: AssistantFixture
let runId: string

const SOURCE_TRACE_MS = 60_000
const REPLICATION_MS = 180_000
const DECOMPOSITION_MS = 240_000

beforeEach(async () => {
  await truncateAll()
  reliance = await import('@/server/modules/reliance')
  fx = await setupAssistantFixture('reliance-actions')
  runId = await runInWorking(fx)
})

afterAll(async () => {
  await truncateAll()
})

describe('Source Trace (FR-070)', () => {
  it('is available on every sourced claim, for one minute, and returns the author’s payload', async () => {
    // The four document-sourced claims of the fixture package, each surfaced by opening its
    // document: the trace has to work on all of them, not on the one the walkthrough happens to use.
    const sourced: [string, string][] = [
      ['D5', 'C1'],
      ['D3', 'C5'],
      ['D7', 'C6'],
      ['D8', 'C7'],
    ]
    for (const [documentKey, claimKey] of sourced) {
      await openDocument(fx, runId, documentKey)
      const claimId = fx.claimId(claimKey)
      const result = await reliance.runAction(fx.student, runId, claimId, 'source_trace')

      expect(result.type).toBe('source_trace')
      expect(result.clockCostMs).toBe(SOURCE_TRACE_MS)
      expect(result.inTurnWindow).toBe(false)
      // Verbatim: the document, the passage, the date and the author, exactly as authored.
      expect(result.result).toEqual((await verificationPaths(runId, claimId)).source_trace)
      expect(Object.keys(result.result).sort()).toEqual([
        'author',
        'dated_on',
        'document_id',
        'passage',
      ])
    }

    expect((await runRow(runId)).charged_ms).toBe(4 * SOURCE_TRACE_MS)
  })

  it('writes the row and the event, and both carry the cost that bought the result', async () => {
    await openDocument(fx, runId, 'D5')
    const claimId = fx.claimId('C1')
    const result = await reliance.runAction(fx.student, runId, claimId, 'source_trace')

    const rows = await actionRows(runId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: result.actionId,
      claim_id: claimId,
      type: 'source_trace',
      clock_cost_ms: SOURCE_TRACE_MS,
      in_turn_window: false,
    })
    expect(rows[0]?.completed_at.getTime()).toBeGreaterThanOrEqual(rows[0]!.started_at.getTime())

    const events = await eventsOfType(runId, 'action')
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toEqual({
      action_id: result.actionId,
      type: 'source_trace',
      claim_id: claimId,
      clock_cost_ms: SOURCE_TRACE_MS,
      result: result.result,
      in_turn_window: false,
    })
  })

  it('charges the clock before the result, so the event records the time already spent', async () => {
    await openDocument(fx, runId, 'D5')
    await setClockRemaining(runId, 600_000)

    await reliance.runAction(fx.student, runId, fx.claimId('C1'), 'source_trace')

    const [event] = await eventsOfType(runId, 'action')
    const [row] = await actionRows(runId)
    // `trace.append` reads the clock from the run row as the transaction has it, so a charge written
    // afterwards would stamp ~600,000 here. Both readings are the post-charge one, and the whole
    // property is that 60,000 ms gap — `CLOCK_SKEW_MS` is the Postgres-versus-Node tolerance the
    // bound cannot do without and is two orders of magnitude below the charge it is proving.
    const reading = await clockReadingOf(event!.seq)
    expect(reading).toBeLessThanOrEqual(600_000 - SOURCE_TRACE_MS + CLOCK_SKEW_MS)
    expect(reading).toBeGreaterThan(600_000 - SOURCE_TRACE_MS - 30_000)
    expect(row?.clock_remaining_ms).toBeLessThanOrEqual(600_000 - SOURCE_TRACE_MS + CLOCK_SKEW_MS)
    expect((await runRow(runId)).charged_ms).toBe(SOURCE_TRACE_MS)
  })
})

describe('the two authored checks (FR-071)', () => {
  it('offers a Decomposition Check where the author wrote one, and refuses a Replication Check where they did not', async () => {
    await openDocument(fx, runId, 'D5')
    const claimId = fx.claimId('C1')

    const decomposition = await reliance.runAction(
      fx.student,
      runId,
      claimId,
      'decomposition_check',
    )
    expect(decomposition.clockCostMs).toBe(DECOMPOSITION_MS)
    expect(decomposition.result).toEqual(
      (await verificationPaths(runId, claimId)).decomposition_check,
    )

    expect(await codeOf(reliance.runAction(fx.student, runId, claimId, 'replication_check'))).toBe(
      'ACTION_NOT_AVAILABLE',
    )
    // The refused action left no row, no event, and no charge.
    expect(await actionRows(runId)).toHaveLength(1)
    expect((await runRow(runId)).charged_ms).toBe(DECOMPOSITION_MS)
  })

  it('offers a Replication Check where the author wrote one, and refuses the other two there', async () => {
    // C4 is the cohort-comparison claim: `replication_check` only, and no source document at all.
    await delegate(fx, runId, 'Can you compare the cohorts for me?')
    const claimId = fx.claimId('C4')

    const replication = await reliance.runAction(fx.student, runId, claimId, 'replication_check')
    expect(replication.clockCostMs).toBe(REPLICATION_MS)
    expect(replication.result).toEqual((await verificationPaths(runId, claimId)).replication_check)

    expect(await codeOf(reliance.runAction(fx.student, runId, claimId, 'source_trace'))).toBe(
      'ACTION_NOT_AVAILABLE',
    )
    expect(
      await codeOf(reliance.runAction(fx.student, runId, claimId, 'decomposition_check')),
    ).toBe('ACTION_NOT_AVAILABLE')
  })

  it('lists exactly the authored actions on the claim view, in cost order', async () => {
    await openDocument(fx, runId, 'D5') // C1: source_trace + decomposition_check
    await openDocument(fx, runId, 'D3') // C5: source_trace only
    await delegate(fx, runId, 'Can you compare the cohorts for me?') // C4: replication_check only

    const claims = await reliance.listRunClaims(fx.student, runId)
    const byKey = new Map(claims.map((claim) => [claim.key, claim]))
    expect(byKey.get('C1')?.availableActions).toEqual(['source_trace', 'decomposition_check'])
    expect(byKey.get('C5')?.availableActions).toEqual(['source_trace'])
    expect(byKey.get('C4')?.availableActions).toEqual(['replication_check'])
  })

  it('carries the actions run so far on the claim view (FR-073)', async () => {
    await openDocument(fx, runId, 'D5')
    const claimId = fx.claimId('C1')
    const trace = await reliance.runAction(fx.student, runId, claimId, 'source_trace')
    const decomposition = await reliance.runAction(
      fx.student,
      runId,
      claimId,
      'decomposition_check',
    )

    const claims = await reliance.listRunClaims(fx.student, runId)
    const claim = claims.find((entry) => entry.id === claimId)
    expect(claim?.actions.map((action) => action.actionId)).toEqual([
      trace.actionId,
      decomposition.actionId,
    ])
    // And no other claim inherited them.
    expect(claims.filter((entry) => entry.actions.length > 0)).toHaveLength(1)
  })
})

describe('the clock (FR-072, D-132)', () => {
  it('refuses an action that arrives with nothing left on the clock', async () => {
    await openDocument(fx, runId, 'D5')
    // A second past zero rather than exactly on it. At the instant the clock reads zero the two
    // rules tie — `dueTimer` fires at `at <= now` and `chargeCost` refuses at `before <= 0` — and
    // which one answers depends on the millisecond between taking the row lock and charging, so
    // the boundary is not a thing to assert an error code on (D-300).
    await setClockRemaining(runId, -1_000)

    // `RUN_LOCKED`, not `CLOCK_EXPIRED`, and the difference is Step 8.2's auto-lock: a working
    // clock past zero *is* a locked decision (10 §8 branch 2, FR-105), and `lockRunForMutation`
    // materializes it before this module applies any rule — which is what the header of
    // `reliance/service.ts` means by "a run whose clock ran out while the student was typing meets
    // its own auto-lock rather than this". The rule under test is unchanged and still asserted:
    // nothing runs, nothing is charged, nothing is written.
    expect(
      await codeOf(reliance.runAction(fx.student, runId, fx.claimId('C1'), 'source_trace')),
    ).toBe('RUN_LOCKED')
    expect((await runRow(runId)).charged_ms).toBe(0)
    expect(await actionRows(runId)).toHaveLength(0)
    expect(await eventsOfType(runId, 'action')).toHaveLength(0)
  })

  it('completes an action that started before expiry, and charges only what was left', async () => {
    await openDocument(fx, runId, 'D5')
    await setClockRemaining(runId, 30_000)

    // Four minutes asked of a clock with thirty seconds on it: the check runs and returns its
    // authored result, the student is charged what they had, and the clock lands on zero.
    const result = await reliance.runAction(
      fx.student,
      runId,
      fx.claimId('C1'),
      'decomposition_check',
    )
    expect(result.result).toEqual(
      (await verificationPaths(runId, fx.claimId('C1'))).decomposition_check,
    )
    // The cap is the property: uncapped this would be 240,000, so `CLOCK_SKEW_MS` on the bound
    // leaves it proven with five figures to spare.
    expect(result.clockCostMs).toBeLessThanOrEqual(30_000 + CLOCK_SKEW_MS)
    expect(result.clockCostMs).toBeGreaterThan(25_000)

    // And the next one finds the decision locked: the charge landed the clock exactly on zero, and
    // the read that follows is the one that auto-locks the run (D-300). Either way there is nothing
    // left to start an action with, and only the one that had a clock was recorded.
    expect(
      await codeOf(reliance.runAction(fx.student, runId, fx.claimId('C1'), 'source_trace')),
    ).toBe('RUN_LOCKED')
    expect(await actionRows(runId)).toHaveLength(1)
  })
})

describe('who and when', () => {
  it('refuses a claim this run has not surfaced', async () => {
    expect(
      await codeOf(reliance.runAction(fx.student, runId, fx.claimId('C1'), 'source_trace')),
    ).toBe('CLAIM_NOT_SURFACED')
  })

  it('refuses while paused and once the decision is locked', async () => {
    await openDocument(fx, runId, 'D5')
    await forcePaused(runId)
    expect(
      await codeOf(reliance.runAction(fx.student, runId, fx.claimId('C1'), 'source_trace')),
    ).toBe('RUN_PAUSED')

    await forceState(runId, 'decision_locked')
    expect(
      await codeOf(reliance.runAction(fx.student, runId, fx.claimId('C1'), 'source_trace')),
    ).toBe('RUN_LOCKED')
    expect((await runRow(runId)).charged_ms).toBe(0)
  })

  it('refuses everyone but the run’s own student', async () => {
    await openDocument(fx, runId, 'D5')
    for (const seat of [fx.classmate, fx.instructor, fx.ta] as const) {
      expect(await codeOf(reliance.runAction(seat, runId, fx.claimId('C1'), 'source_trace'))).toBe(
        'NOT_FOUND',
      )
    }
  })
})

/** `run_events.clock_remaining_ms` for one sequence number — the reading the trace stamped. */
async function clockReadingOf(seq: number): Promise<number> {
  const { testSql } = await import('@tests/setup/integration')
  const [row] = await testSql<{ clock_remaining_ms: number | null }[]>`
    select clock_remaining_ms from run_events where run_id = ${runId} and seq = ${seq}`
  if (!row || row.clock_remaining_ms === null) throw new Error('the event carries no clock reading')
  return row.clock_remaining_ms
}
