// Step 9.1 — the Turn's delivery, its window, the response and the implicit hold, against Postgres
// (docs/tech/10-backend-spec-modules.md §6; 10-backend-spec.md §8 branches 3 and 4; PRD §7.11;
// FR-110 to FR-115, DATA-038, NFR-002, D-043, D-077, D-132).
//
// Four claims about the Turn are worth a database to prove rather than a mock.
//
//   * **It fires on a clock and is delivered by a read.** There is no scheduler (D-043), so the
//     `turn_delivered` event has to be stamped at `turn_due_at` by whatever read happens to notice —
//     five seconds later or an hour later, the same instant (NFR-002). The trace is where that is
//     visible, and the trace needs a database.
//   * **An offline student gets the full twelve minutes** (FR-115). The window starts at the
//     delivery read, so the two instants differ by the length of the absence, and the row the
//     student comes back to is the assertion.
//   * **The window makes its claims relied on by rule** (D-077). That is three writes in one
//     transaction — a `run_claims` row, `relied_on_via`, a `claim_used` event — and the response is
//     refused while any of them has no stance (FR-111).
//   * **The window is the only clock left** (D-132). A document opened or an action run inside it is
//     recorded `in_turn_window` and deducts from `turn_window_ends_at`, never from the working
//     clock, which ended at the Decision Lock.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import { delegationRows } from '../assistant/fixture'
import {
  FIXTURE,
  FRAME,
  codeOf,
  delegate,
  eventsOfType,
  inLockedRun,
  runClaimRows,
  runInWorking,
  setupAssistantFixture,
  type AssistantFixture,
} from '../reliance/fixture'
import { isAppError } from '@/lib/errors'
import { findForbiddenKeys } from '@/server/auth/student-view'

type Runs = typeof import('@/server/modules/runs')
type Reliance = typeof import('@/server/modules/reliance')
type AdvanceClockRoute = typeof import('@/app/api/v1/test/runs/[runId]/advance-clock/route')

let runs: Runs
let reliance: Reliance
let advanceClock: AdvanceClockRoute
let fx: AssistantFixture

const MINUTE = 60_000
const TURN_DELAY_MS = FIXTURE.version.turnDelaySeconds * 1000
/** FR-115's twelve minutes, read from the module rather than restated (`runs/limits.ts`). */
const WINDOW_MS = 12 * MINUTE
/** FR-070's Source Trace, the cheapest action and the one C2 and C3 both offer. */
const SOURCE_TRACE_MS = 60_000
/** FR-090's five minutes, the most expensive move in the run and here taken out of the window. */
const ESCALATION_COST_MS = 300_000

/** A brief that meets FR-100 and names no figure, so nothing is relied on before the window. */
const BRIEF = {
  recommendation: 'Hold the acquisition spend in the value tier for this quarter.',
  rationale:
    'The premium payback figure is load-bearing and has not been traced to the cohort table, so moving spend on it would be a bet on a number nobody has checked.',
  assumptions: [
    'Premium retention holds near the piloted level',
    'Value tier payback stays close to four months',
    'Green coffee cost per bag is stable through the crop year',
  ],
  changeMyMind: 'A cohort table showing premium payback under six months would change this.',
  confidence: 45,
  namedValues: {} as Record<string, number>,
}

/** A response that meets FR-112: one of the three categories, words, and a confidence. */
const RESPONSE = {
  response: 'revise' as const,
  justification:
    'The 78 percent was one cohort acquired under the old pricing, so the payback the recommendation was priced on does not hold and the share sized on it comes down.',
  confidence: 55,
}

// ---------------------------------------------------------------------------------------------
// Reading the run back as it is written, rather than through a projection
// ---------------------------------------------------------------------------------------------

async function turnRow(runId: string) {
  const [row] = await testSql<
    {
      state: string
      decision_locked_at: Date | null
      turn_due_at: Date | null
      turn_delivered_at: Date | null
      turn_window_ends_at: Date | null
      turn_locked_at: Date | null
      confidence_after_turn: number | null
      charged_ms: string
    }[]
  >`select state, decision_locked_at, turn_due_at, turn_delivered_at, turn_window_ends_at,
           turn_locked_at, confidence_after_turn, charged_ms
      from runs where id = ${runId}`
  if (!row) throw new Error(`no run ${runId}`)
  return { ...row, charged_ms: Number(row.charged_ms) }
}

async function eventRows(runId: string, type: string) {
  return testSql<
    {
      seq: number
      occurred_at: Date
      clock_remaining_ms: number | null
      payload: Record<string, unknown>
    }[]
  >`select seq, occurred_at, clock_remaining_ms, payload
      from run_events where run_id = ${runId} and type = ${type} order by seq`
}

async function turnResponseRow(runId: string) {
  const [row] = await testSql<
    {
      response: string
      justification: string | null
      confidence: number | null
      implicit: boolean
      locked_at: Date
    }[]
  >`select response, justification, confidence, implicit, locked_at
      from run_turn_responses where run_id = ${runId}`
  return row
}

async function documentOpenRows(runId: string) {
  return testSql<{ in_turn_window: boolean }[]>`
    select in_turn_window from run_document_opens where run_id = ${runId} order by opened_at`
}

async function actionRows(runId: string) {
  return testSql<{ type: string; clock_cost_ms: number; in_turn_window: boolean }[]>`
    select type, clock_cost_ms, in_turn_window from run_actions where run_id = ${runId}
     order by started_at`
}

/** The `details` an `AppError` carried, or `{}` when the promise resolved. */
async function detailsOf(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await promise
    return {}
  } catch (error) {
    return isAppError(error) ? ((error.opts.details ?? {}) as Record<string, unknown>) : {}
  }
}

/** `POST /api/v1/test/runs/{runId}/advance-clock` (D-109): the only honest way to reach a timer. */
async function advance(runId: string, ms: number): Promise<Response> {
  const headers = await asUser(fx.student.id, { activeOrganizationId: fx.orgId })
  headers.set('x-requested-with', 'tassl')
  headers.set('content-type', 'application/json')
  return advanceClock.POST(
    new Request(`http://localhost:3000/api/v1/test/runs/${runId}/advance-clock`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ms }),
    }),
    { params: Promise.resolve({ runId }) },
  )
}

/** A run with its decision filed and the Turn still to come. */
async function runWithDecisionLocked(): Promise<string> {
  const runId = await runInWorking(fx)
  await runs.lockDecision(fx.student, runId, BRIEF)
  return runId
}

/**
 * A run in the Turn window, delivered `lateBy` milliseconds after the Turn fell due.
 *
 * The default is two seconds, which is the ordinary case — the student's five-second poll. Passing
 * an hour is FR-115's case, and nothing else about the call changes.
 */
async function runInTurnWindow(lateBy = 2_000): Promise<string> {
  const runId = await runWithDecisionLocked()
  await advance(runId, TURN_DELAY_MS + lateBy)
  return runId
}

beforeEach(async () => {
  await truncateAll()
  runs = await import('@/server/modules/runs')
  reliance = await import('@/server/modules/reliance')
  advanceClock = await import('@/app/api/v1/test/runs/[runId]/advance-clock/route')
  fx = await setupAssistantFixture('runs-turn')
})

afterAll(async () => {
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// Delivery (10 §8 branch 3, FR-110, NFR-002)
// ---------------------------------------------------------------------------------------------

describe('before the Turn falls due', () => {
  it('leaves the run in `decision_locked` however often it is polled', async () => {
    const runId = await runWithDecisionLocked()

    for (let poll = 0; poll < 3; poll += 1) {
      expect((await runs.getRun(fx.student, runId)).state).toBe('decision_locked')
    }
    expect(await eventsOfType(runId, 'turn_delivered')).toEqual([])

    const row = await turnRow(runId)
    expect(row.turn_delivered_at).toBeNull()
    expect(row.turn_window_ends_at).toBeNull()
    // FR-110: the Turn is due the package's delay after the decision was filed.
    expect(row.turn_due_at?.getTime()).toBe(
      (row.decision_locked_at as Date).getTime() + TURN_DELAY_MS,
    )
  })

  it('refuses the Turn read with the state the run is actually in', async () => {
    const runId = await runWithDecisionLocked()
    expect(await codeOf(runs.getTurn(fx.student, runId))).toBe('TURN_NOT_OPEN')
    expect(await detailsOf(runs.getTurn(fx.student, runId))).toEqual({ state: 'decision_locked' })
  })

  it('refuses a response with the same code', async () => {
    const runId = await runWithDecisionLocked()
    expect(await codeOf(runs.respondToTurn(fx.student, runId, RESPONSE))).toBe('TURN_NOT_OPEN')
    expect(await turnResponseRow(runId)).toBeUndefined()
  })
})

describe('the read that finds the Turn due delivers it (D-043)', () => {
  it('writes `turn_delivered` at `turn_due_at` and opens the window at the read', async () => {
    const runId = await runWithDecisionLocked()
    const readAt = Date.now()
    await advance(runId, TURN_DELAY_MS + 2_000)

    const row = await turnRow(runId)
    expect(row.state).toBe('turn_open')

    const [event] = await eventRows(runId, 'turn_delivered')
    // NFR-002: the instant the Turn fired, computed from the run's columns, not the read's `now`.
    expect(event?.occurred_at.getTime()).toBe(row.turn_due_at?.getTime())
    expect(event?.payload).toMatchObject({
      text: FIXTURE.turn.text,
      voice: 'stakeholder_message',
      window_ends_at: row.turn_window_ends_at?.toISOString(),
    })
    // The window opened at the read and runs twelve minutes from there (FR-115).
    expect(row.turn_delivered_at?.getTime()).toBeGreaterThanOrEqual(readAt - 1_000)
    expect((row.turn_window_ends_at as Date).getTime() - readAt).toBeGreaterThan(WINDOW_MS - 5_000)
    expect((row.turn_window_ends_at as Date).getTime() - readAt).toBeLessThan(WINDOW_MS + 5_000)
  })

  // D-364: the test control moves the run's whole timeline, so a run it has advanced is a run
  // production could have produced. These two assertions are the ones that would have caught the
  // control shifting the deadlines and not the instants behind them — and they are asserted here
  // rather than in a file of their own because every Phase 9 fixture, and the walkthrough, reaches
  // the Turn exactly this way, and Phase 10 replays what they leave behind.
  it('leaves a shape production could have produced, and a trace that reads forwards', async () => {
    const runId = await runInTurnWindow()

    const row = await turnRow(runId)
    // FR-110: the Turn is due the package's delay after the decision was filed, before and after any
    // shift. The control used to leave `turn_due_at` two seconds *before* the lock.
    expect(row.turn_due_at?.getTime()).toBe(
      (row.decision_locked_at as Date).getTime() + TURN_DELAY_MS,
    )
    expect((row.turn_due_at as Date).getTime()).toBeGreaterThanOrEqual(
      (row.decision_locked_at as Date).getTime(),
    )
    expect((row.turn_delivered_at as Date).getTime()).toBeGreaterThanOrEqual(
      (row.turn_due_at as Date).getTime(),
    )

    // The trace is the record Phase 10 replays, and `seq` is the order it was written in: an
    // `occurred_at` that goes backwards between two sequences is a record that cannot be drawn.
    const events = await testSql<{ seq: number; type: string; occurred_at: Date }[]>`
      select seq, type, occurred_at from run_events where run_id = ${runId} order by seq`
    expect(events.length).toBeGreaterThan(5)
    const backwards = events.filter(
      (event, index) =>
        index > 0 &&
        event.occurred_at.getTime() <
          (events[index - 1] as { occurred_at: Date }).occurred_at.getTime(),
    )
    expect(backwards.map((event) => `${event.seq} ${event.type}`)).toEqual([])
  })

  it('happens on an ordinary poll, with no scheduler and no test route (ADR-019)', async () => {
    const runId = await runWithDecisionLocked()
    // Move the deadline into the past the way the clock would have, without going through a timer.
    await testSql`update runs set turn_due_at = now() - interval '3 seconds' where id = ${runId}`

    const summary = await runs.getRun(fx.student, runId)
    expect(summary.state).toBe('turn_open')
    expect(summary.turn?.windowEndsAt).toBe(
      (await turnRow(runId)).turn_window_ends_at?.toISOString(),
    )
  })

  it('gives a student who was offline the full twelve minutes (FR-115)', async () => {
    const runId = await runWithDecisionLocked()
    const readAt = Date.now()
    // The laptop was shut when the Turn fired and is opened an hour later.
    await advance(runId, TURN_DELAY_MS + 60 * MINUTE)

    const row = await turnRow(runId)
    const [event] = await eventRows(runId, 'turn_delivered')

    // The Turn is recorded as having fired an hour ago …
    expect(readAt - (event?.occurred_at as Date).getTime()).toBeGreaterThan(59 * MINUTE)
    // … and the window still has its whole twelve minutes, measured from the read.
    const remaining = (row.turn_window_ends_at as Date).getTime() - readAt
    expect(remaining).toBeGreaterThan(WINDOW_MS - 5_000)
    expect(remaining).toBeLessThanOrEqual(WINDOW_MS + 5_000)
    expect(await runs.getTurn(fx.student, runId)).toMatchObject({ text: FIXTURE.turn.text })
  })

  it('surfaces the Turn’s claims, relied on by rule (FR-111, D-077)', async () => {
    const runId = await runInTurnWindow()

    const surfaced = (await runClaimRows(runId)).filter((claim) => claim.surfaced_by === 'turn')
    expect(surfaced.map((claim) => claim.key).sort()).toEqual(['C2', 'C3'])
    for (const claim of surfaced) {
      expect([claim.key, claim.relied_on, claim.relied_on_via]).toEqual([
        claim.key,
        true,
        ['turn_window'],
      ])
      expect(claim.stance).toBeNull()
    }

    // D-077 is a trace fact as well as a column: each claim carries its own `claim_used`.
    const used = await eventsOfType(runId, 'claim_used')
    expect(used).toHaveLength(2)
    expect(used.every((event) => event.payload.via === 'turn_window')).toBe(true)
  })

  it('delivers once: a second poll writes no second Turn', async () => {
    const runId = await runInTurnWindow()
    const endsAt = (await turnRow(runId)).turn_window_ends_at?.toISOString()

    await runs.getRun(fx.student, runId)
    await runs.getTurn(fx.student, runId)

    expect(await eventsOfType(runId, 'turn_delivered')).toHaveLength(1)
    expect(await eventsOfType(runId, 'claim_used')).toHaveLength(2)
    // And the window is not extended by looking at it.
    expect((await turnRow(runId)).turn_window_ends_at?.toISOString()).toBe(endsAt)
  })
})

// ---------------------------------------------------------------------------------------------
// The Turn read (07 §7, UI-025) and the invariant it must hold
// ---------------------------------------------------------------------------------------------

describe('GET /runs/{runId}/turn', () => {
  it('carries the Turn, its window and the frozen pre-Turn record', async () => {
    const runId = await runInTurnWindow()
    const view = await runs.getTurn(fx.student, runId)

    expect(view.text).toBe(FIXTURE.turn.text)
    expect(view.voice).toBe('stakeholder_message')
    expect(view.windowEndsAt).toBe((await turnRow(runId)).turn_window_ends_at?.toISOString())
    expect(view.remainingMs).toBeGreaterThan(WINDOW_MS - 10_000)
    // The record the response is taken against, and it is really there — a frame the student locked
    // and a brief they filed, not two nulls a leak sweep would pass over (12 §8).
    expect(view.frozen.frame?.decision).toBe(FRAME.decision)
    expect(view.frozen.brief?.recommendation).toBe(BRIEF.recommendation)
    expect(view.frozen.brief?.lockedAt).not.toBeNull()
    expect(view.namedFields.map((field) => field.key)).toContain('premium_payback_months')
    expect(view.run.state).toBe('turn_open')
  })

  it('carries nothing the Turn declares about itself (FR-114, 12 §8.1)', async () => {
    const runId = await runInTurnWindow()
    const view = await runs.getTurn(fx.student, runId)

    // The sweep with something to look at: the frame, the brief and the named fields are populated
    // above, so an empty finding list is a statement about a payload rather than about nothing.
    expect(findForbiddenKeys(view, { scored: false })).toEqual([])
    const json = JSON.stringify(view)
    for (const authored of [
      'warrantsChange',
      'warrants_change',
      'proportionateResponse',
      'proportionate_response',
      'windowClaimIds',
      'window_claim_ids',
      'disruptedAssumptionKeys',
      'stakeholderId',
    ]) {
      expect([authored, json.includes(`"${authored}"`)]).toEqual([authored, false])
    }
    // The Turn's authored `evidence` is the reading the student is being asked to do for themselves.
    expect(json).not.toContain(FIXTURE.turn.evidence)
  })

  it('is the run’s own student’s and nobody else’s (08 §4)', async () => {
    const runId = await runInTurnWindow()
    for (const seat of ['instructor', 'ta', 'classmate'] as const) {
      expect([seat, await codeOf(runs.getTurn(fx[seat], runId))]).toEqual([seat, 'NOT_FOUND'])
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The response (FR-112) and the gate in front of it (FR-111)
// ---------------------------------------------------------------------------------------------

describe('the response', () => {
  /** Takes a position on both claims the Turn raised, which is what FR-111 asks for. */
  async function stanceTheWindow(runId: string): Promise<void> {
    for (const key of ['C2', 'C3'] as const) {
      await reliance.setStance(fx.student, runId, fx.claimId(key), 'verify')
    }
  }

  it('is refused while a claim the window raised has no stance (FR-111)', async () => {
    const runId = await runInTurnWindow()

    expect(await codeOf(runs.respondToTurn(fx.student, runId, RESPONSE))).toBe(
      'TURN_CLAIMS_UNSTANCED',
    )
    const details = await detailsOf(runs.respondToTurn(fx.student, runId, RESPONSE))
    expect(details.claimIds).toEqual([fx.claimId('C2'), fx.claimId('C3')])

    // Nothing was written: the refusal reads and returns, so the run is exactly where it was.
    expect((await turnRow(runId)).state).toBe('turn_open')
    expect(await turnResponseRow(runId)).toBeUndefined()
    expect(await eventsOfType(runId, 'turn_response_locked')).toEqual([])
  })

  it('is still refused when only one of the two has a stance', async () => {
    const runId = await runInTurnWindow()
    await reliance.setStance(fx.student, runId, fx.claimId('C2'), 'accept')

    const details = await detailsOf(runs.respondToTurn(fx.student, runId, RESPONSE))
    expect(details.claimIds).toEqual([fx.claimId('C3')])
  })

  it('answers for the response before it answers for a claim (FR-112 first)', async () => {
    const runId = await runInTurnWindow()
    const tooLong = Array.from({ length: 151 }, (_, i) => `word${i}`).join(' ')

    // Both rules are broken; the student is told about the one they can see on their own form.
    expect(
      await detailsOf(
        runs.respondToTurn(fx.student, runId, { ...RESPONSE, justification: tooLong }),
      ),
    ).toEqual({ field: 'justification', reason: 'word_limit' })
    expect(
      await detailsOf(runs.respondToTurn(fx.student, runId, { ...RESPONSE, justification: '  ' })),
    ).toEqual({ field: 'justification', reason: 'required' })
    expect(
      await detailsOf(runs.respondToTurn(fx.student, runId, { ...RESPONSE, confidence: 101 })),
    ).toEqual({ field: 'confidence', reason: 'invalid' })
  })

  it('locks the response and takes the run to the defense in one transaction (FR-112)', async () => {
    const runId = await runInTurnWindow()
    await stanceTheWindow(runId)

    const summary = await runs.respondToTurn(fx.student, runId, RESPONSE)
    expect(summary.state).toBe('defense_pending')
    expect(summary.links.next).toBe(`/runs/${runId}/defense`)

    const row = await turnRow(runId)
    expect(row.state).toBe('defense_pending')
    expect(row.turn_locked_at).not.toBeNull()
    expect(row.confidence_after_turn).toBe(RESPONSE.confidence)

    expect(await turnResponseRow(runId)).toMatchObject({
      response: 'revise',
      justification: RESPONSE.justification,
      confidence: RESPONSE.confidence,
      implicit: false,
    })

    const [event] = await eventRows(runId, 'turn_response_locked')
    expect(event?.payload).toEqual({
      response: 'revise',
      justification: RESPONSE.justification,
      confidence: RESPONSE.confidence,
      implicit: false,
    })

    // `turn_open → turn_locked → defense_pending`: both moves, at one instant, in one transaction.
    const lifecycle = (await eventRows(runId, 'lifecycle')).slice(-2)
    expect(lifecycle.map((entry) => entry.payload)).toEqual([
      { from: 'turn_open', to: 'turn_locked', cause: 'turn_response_locked' },
      { from: 'turn_locked', to: 'defense_pending', cause: 'automatic' },
    ])
    expect(lifecycle[0]?.occurred_at.getTime()).toBe(lifecycle[1]?.occurred_at.getTime())
  })

  it('cannot be filed twice', async () => {
    const runId = await runInTurnWindow()
    await stanceTheWindow(runId)
    await runs.respondToTurn(fx.student, runId, RESPONSE)

    expect(await codeOf(runs.respondToTurn(fx.student, runId, RESPONSE))).toBe('TURN_NOT_OPEN')
    expect(await eventsOfType(runId, 'turn_response_locked')).toHaveLength(1)
  })

  it('closes the Turn read: the defense is what comes next (UI-026)', async () => {
    const runId = await runInTurnWindow()
    await stanceTheWindow(runId)
    await runs.respondToTurn(fx.student, runId, RESPONSE)

    expect(await detailsOf(runs.getTurn(fx.student, runId))).toEqual({ state: 'defense_pending' })
  })
})

// ---------------------------------------------------------------------------------------------
// The implicit hold (10 §8 branch 4, FR-113)
// ---------------------------------------------------------------------------------------------

describe('the window running out', () => {
  it('records an implicit hold at the window’s end and moves the run on', async () => {
    const runId = await runInTurnWindow()
    const endsAt = (await turnRow(runId)).turn_window_ends_at as Date

    const readAt = Date.now()
    await advance(runId, WINDOW_MS + 3_000)

    const row = await turnRow(runId)
    expect(row.state).toBe('defense_pending')
    expect(row.turn_locked_at).not.toBeNull()
    // FR-113: no justification, no confidence, and the Confidence Line keeps its third point empty.
    expect(row.confidence_after_turn).toBeNull()
    expect(await turnResponseRow(runId)).toMatchObject({
      response: 'hold',
      justification: null,
      confidence: null,
      implicit: true,
    })

    const [event] = await eventRows(runId, 'turn_response_locked')
    // The instant the window closed, computed from the run's own column — not the read's `now`.
    expect(event?.occurred_at.getTime()).toBe(
      new Date(endsAt.getTime() - (WINDOW_MS + 3_000)).getTime(),
    )
    expect(readAt - (event?.occurred_at as Date).getTime()).toBeGreaterThan(2_000)
    expect(event?.payload).toEqual({
      response: 'hold',
      justification: null,
      confidence: null,
      implicit: true,
    })
    expect(row.turn_locked_at?.getTime()).toBe(event?.occurred_at.getTime())
  })

  it('does not wait for the student to have taken a stance (FR-113)', async () => {
    // The claims the window raised are unstanced — which refuses a *response* and never the expiry.
    const runId = await runInTurnWindow()
    await advance(runId, WINDOW_MS + 3_000)

    expect((await turnRow(runId)).state).toBe('defense_pending')
    const unstanced = (await runClaimRows(runId)).filter((claim) => claim.stance === null)
    expect(unstanced.map((claim) => claim.key).sort()).toEqual(['C2', 'C3'])
  })

  it('is reached by an ordinary poll, and only once', async () => {
    const runId = await runInTurnWindow()
    await testSql`update runs set turn_window_ends_at = now() - interval '2 seconds'
                   where id = ${runId}`

    expect((await runs.getRun(fx.student, runId)).state).toBe('defense_pending')
    await runs.getRun(fx.student, runId)
    expect(await eventsOfType(runId, 'turn_response_locked')).toHaveLength(1)
  })

  it('delivers and then holds when nobody came back at all (10 §8 cascade)', async () => {
    // The browser closed during the working period and the run is opened the next day: the clock
    // expired, the decision auto-locked, the Turn fell due, and the window ran out — all of it
    // materialized by reads, each event stamped at the instant it happened.
    const runId = await runInWorking(fx)
    await advance(runId, FIXTURE.version.workingClockSeconds * 1000 + 5_000)
    await advance(runId, TURN_DELAY_MS + 5_000)
    await advance(runId, WINDOW_MS + 5_000)

    expect((await turnRow(runId)).state).toBe('defense_pending')
    expect(await eventsOfType(runId, 'decision_locked')).toHaveLength(1)
    expect(await eventsOfType(runId, 'turn_delivered')).toHaveLength(1)
    expect(await turnResponseRow(runId)).toMatchObject({ implicit: true })
  })
})

// ---------------------------------------------------------------------------------------------
// A component failure inside the window (FR-001, D-133, D-367)
// ---------------------------------------------------------------------------------------------

describe('a pause taken inside the window', () => {
  it('leaves the run on the Turn, with the Turn still readable behind the overlay', async () => {
    // `paused` is not a screen: it is the modal overlay drawn over whichever screen the run was on,
    // and there are two of those. `NEXT_ROUTE.paused` answered the workspace for both, so a student
    // who met a component failure mid-window and reloaded landed on a locked workspace instead of
    // the Turn they were answering — and `getTurn` refused `paused` outright, so the screen could
    // not have drawn it even if the route had sent them there.
    const runId = await runInTurnWindow()
    await inLockedRun(fx, runId, async (tx, run) => {
      await runs.pauseRun(tx, run, 'assistant_failure', {})
    })
    expect((await turnRow(runId)).state).toBe('paused')

    const summary = await runs.getRun(fx.student, runId)
    expect(summary.links.next).toBe(`/runs/${runId}/turn`)

    const turn = await runs.getTurn(fx.student, runId)
    expect(turn.text).toBe(FIXTURE.turn.text)
    // The workspace read the screen composes beside it still answers, and it carries the open pause
    // the overlay is rendered from.
    const workspace = await runs.getRunWorkspace(fx.student, runId)
    expect(workspace.pause).toMatchObject({ cause: 'assistant_failure' })
    // Nothing is writable while it is paused: the response gates on `turn_open` itself.
    expect(await codeOf(runs.respondToTurn(fx.student, runId, RESPONSE))).toBe('TURN_NOT_OPEN')

    // And the resume puts them back where they were, by the same route.
    await runs.resumeRun(fx.student, runId)
    expect((await turnRow(runId)).state).toBe('turn_open')
    expect((await runs.getRun(fx.student, runId)).links.next).toBe(`/runs/${runId}/turn`)
  })

  it('still sends a pause taken on the working clock to the workspace', async () => {
    const runId = await runInWorking(fx)
    await inLockedRun(fx, runId, async (tx, run) => {
      await runs.pauseRun(tx, run, 'assistant_failure', {})
    })

    const summary = await runs.getRun(fx.student, runId)
    expect(summary.links.next).toBe(`/runs/${runId}/work`)
    expect(await codeOf(runs.getTurn(fx.student, runId))).toBe('TURN_NOT_OPEN')
  })
})

// ---------------------------------------------------------------------------------------------
// The room inside the window (FR-111, D-132)
// ---------------------------------------------------------------------------------------------

describe('the room and the actions inside the window', () => {
  it('records a document open as in the window, with no working clock to charge', async () => {
    const runId = await runInTurnWindow()
    const before = await turnRow(runId)
    expect(before.charged_ms).toBe(0)

    const opened = await runs.openDocument(fx.student, runId, fx.documentId('D5'))
    expect(opened.document.key).toBe('D5')

    expect((await documentOpenRows(runId)).at(-1)?.in_turn_window).toBe(true)
    const [event] = (await eventRows(runId, 'document_open')).slice(-1)
    expect(event?.payload).toMatchObject({ in_turn_window: true })
    // The event's clock reading is the *window's* remaining, not the working clock's (10 §10).
    expect(event?.clock_remaining_ms).toBeGreaterThan(WINDOW_MS - 15_000)
    expect(event?.clock_remaining_ms).toBeLessThanOrEqual(WINDOW_MS)

    const after = await turnRow(runId)
    expect(after.charged_ms).toBe(0)
    expect(after.turn_window_ends_at?.getTime()).toBe(before.turn_window_ends_at?.getTime())
  })

  it('deducts an interrogation action from the window and never from the working clock (D-132)', async () => {
    const runId = await runInTurnWindow()
    const before = await turnRow(runId)

    const result = await reliance.runAction(fx.student, runId, fx.claimId('C2'), 'source_trace')
    expect(result.type).toBe('source_trace')

    const [action] = await actionRows(runId)
    expect(action).toMatchObject({
      type: 'source_trace',
      clock_cost_ms: SOURCE_TRACE_MS,
      in_turn_window: true,
    })

    const after = await turnRow(runId)
    // The working clock is untouched — it ended at the Decision Lock — and the window is a minute
    // shorter than it was.
    expect(after.charged_ms).toBe(0)
    expect(
      (before.turn_window_ends_at as Date).getTime() -
        (after.turn_window_ends_at as Date).getTime(),
    ).toBe(SOURCE_TRACE_MS)
    // And the run's own summary shows no working clock at all in the window.
    expect((await runs.getRun(fx.student, runId)).clock).toBeNull()
  })

  it('records a stance taken in the window as in the window', async () => {
    const runId = await runInTurnWindow()
    await reliance.setStance(fx.student, runId, fx.claimId('C3'), 'challenge')

    const [event] = await eventRows(runId, 'stance_set')
    expect(event?.payload).toMatchObject({
      claim_id: fx.claimId('C3'),
      stance: 'challenge',
      in_turn_window: true,
    })
  })

  it('answers a delegation, and charges no clock for it (FR-111, 10 §7)', async () => {
    // The assistant is in the room again for the twelve minutes, and this is the only way its
    // window path is ever executed: a delegation inside the window carries the Turn's own text as
    // context (11 §2.1), which `prepared.inTurnWindow` gates and no state before Step 9.1 reached.
    const runId = await runInTurnWindow()
    const before = await turnRow(runId)

    const delegationId = await delegate(fx, runId, 'What is the premium payback?')
    expect(delegationId).not.toBe('')

    const [row] = await delegationRows(runId)
    expect(row?.in_turn_window).toBe(true)
    // A delegation costs no clock (10 §7), so the reading it stores is the whole window and the
    // window's end has not moved.
    expect(row?.clock_remaining_ms).toBeGreaterThan(WINDOW_MS - 20_000)
    expect(row?.clock_remaining_ms).toBeLessThanOrEqual(WINDOW_MS)

    const after = await turnRow(runId)
    expect(after.charged_ms).toBe(0)
    expect(after.turn_window_ends_at?.getTime()).toBe(before.turn_window_ends_at?.getTime())
  })

  it('deducts an escalation from the window, five minutes of the twelve (D-132)', async () => {
    const runId = await runInTurnWindow()
    const before = await turnRow(runId)

    await reliance.escalate(fx.student, runId, fx.claimId('C3'), {
      statement: 'I cannot evaluate this payback figure from what the room gives me.',
    })

    const [event] = await eventRows(runId, 'escalation')
    expect(event?.payload).toMatchObject({
      claim_id: fx.claimId('C3'),
      clock_cost_ms: ESCALATION_COST_MS,
      in_turn_window: true,
    })

    const after = await turnRow(runId)
    expect(after.charged_ms).toBe(0)
    expect(
      (before.turn_window_ends_at as Date).getTime() -
        (after.turn_window_ends_at as Date).getTime(),
    ).toBe(ESCALATION_COST_MS)
  })
})

// ---------------------------------------------------------------------------------------------
// A claim the student already met, raised again by the Turn (D-705)
// ---------------------------------------------------------------------------------------------

/** The window flag and the first surfacing of one claim's row, as the table holds them. */
async function windowRow(runId: string, key: string) {
  return testSql<{ in_turn_window: boolean; surfaced_by: string }[]>`
    select rc.in_turn_window, rc.surfaced_by
    from run_claims rc join scenario_claims sc on sc.id = rc.claim_id
    where rc.run_id = ${runId} and sc.key = ${key}`
}

describe('a window claim the student already met (D-705)', () => {
  it('marks the existing row in_turn_window and keeps one row per claim', async () => {
    const runId = await runInWorking(fx)
    // C3 is the seeded Turn's own subject and the assistant's first answer: met before the lock.
    await delegate(fx, runId, 'What is the premium payback?')
    const before = await windowRow(runId, 'C3')
    expect(before).toHaveLength(1)
    expect(before[0]?.in_turn_window).toBe(false)

    await runs.lockDecision(fx.student, runId, BRIEF)
    await advance(runId, TURN_DELAY_MS + 2_000)

    const rows = await windowRow(runId, 'C3')
    expect(rows, 'one row per claim, D-267').toHaveLength(1)
    expect(rows[0]?.in_turn_window).toBe(true)
    // The first meeting is kept: the Turn raises the claim again, it does not re-surface it.
    expect(rows[0]?.surfaced_by).toBe('delegation')

    // What the Turn screen and FR-111's gate read.
    const view = (await reliance.listRunClaims(fx.student, runId)).filter((c) => c.key === 'C3')
    expect(view.map((claim) => claim.inTurnWindow)).toEqual([true])
    expect(await codeOf(runs.respondToTurn(fx.student, runId, RESPONSE))).toBe(
      'TURN_CLAIMS_UNSTANCED',
    )
  })
})
