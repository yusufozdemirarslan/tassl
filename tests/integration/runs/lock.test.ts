// Step 8.2 — the Decision Brief, the lock gate, the Decision Lock, the addendum and the auto-lock,
// against Postgres (docs/tech/10-backend-spec-modules.md §6; 10-backend-spec.md §8, §9; PRD §7.10;
// FR-084, FR-100 to FR-108, DATA-037, D-044).
//
// The Decision Lock is the moment the run stops being editable, and three claims about it are worth
// a database to prove rather than a mock.
//
//   * **The gate is real.** FR-084 refuses a lock when a claim the student relied on has no stance,
//     and reliance arrives by three different routes — a mark in the Delegation Log, a figure typed
//     into a named numeric field, the Turn window. Each is a different table write, and the refusal
//     names the *first* claim by the instant it was surfaced, so the ordering only means anything
//     against rows that were actually surfaced in an order.
//   * **The lock is immutable, by grant.** The service offers no update path, and neither does the
//     database: `run_briefs_locked` (migration 0006) refuses any UPDATE of a row whose `locked_at`
//     is set. That is asserted here through the `tassl_app` role, so what is proven is the trigger
//     rather than the service's good manners.
//   * **The clock locks the decision by itself.** The auto-lock of FR-105 is a timer materialized on
//     the next read, and its whole content is what it records: the fields as they stand (empty as
//     empty), the relied-on claims with no stance as unstanced, and `occurred_at` at the instant the
//     clock reached zero rather than the instant somebody looked.
// @db:truncate
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { TEST_DATABASE_URL, asUser, testSql, truncateAll } from '@tests/setup/integration'
import {
  FIXTURE,
  claimByKey,
  codeOf,
  delegate,
  eventsOfType,
  forcePaused,
  openDocument,
  runClaimRows,
  runInWorking,
  setClockRemaining,
  setupAssistantFixture,
  type AssistantFixture,
} from '../reliance/fixture'
import { isAppError } from '@/lib/errors'

type Runs = typeof import('@/server/modules/runs')
type Assistant = typeof import('@/server/modules/assistant')
type Reliance = typeof import('@/server/modules/reliance')
type AdvanceClockRoute = typeof import('@/app/api/v1/test/runs/[runId]/advance-clock/route')

let runs: Runs
let assistant: Assistant
let reliance: Reliance
let advanceClock: AdvanceClockRoute
let fx: AssistantFixture

/** The application role as preview and production run it (D-085, D-110); the password is local. */
const appSql = postgres(
  (() => {
    const url = new URL(TEST_DATABASE_URL)
    url.username = 'tassl_app'
    url.password = 'test'
    return url.toString()
  })(),
  { max: 1, prepare: false },
)

/** A brief that meets FR-100 and names no figure, so a test opts into reliance deliberately. */
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

type Refusal = { code: string; details: unknown }

const refusalOf = async (promise: Promise<unknown>): Promise<Refusal> => {
  try {
    await promise
    return { code: 'no error', details: null }
  } catch (error) {
    if (!isAppError(error)) return { code: String(error), details: null }
    return { code: error.code, details: error.opts.details }
  }
}

async function briefRow(runId: string) {
  const [row] = await testSql<
    {
      recommendation: string
      rationale: string
      assumptions: string[]
      change_my_mind: string
      confidence: number | null
      named_values: Record<string, number>
      locked_at: Date | null
      auto_locked: boolean
      speed_outlier: boolean
    }[]
  >`select recommendation, rationale, assumptions, change_my_mind, confidence, named_values,
           locked_at, auto_locked, speed_outlier
      from run_briefs where run_id = ${runId}`
  return row
}

async function addendumRow(runId: string) {
  const [row] = await testSql<{ text: string; created_at: Date }[]>`
    select text, created_at from run_addenda where run_id = ${runId}`
  return row
}

async function runRow(runId: string) {
  const [row] = await testSql<
    { state: string; decision_locked_at: Date | null; turn_due_at: Date | null }[]
  >`select state, decision_locked_at, turn_due_at from runs where id = ${runId}`
  if (!row) throw new Error(`no run ${runId}`)
  return row
}

async function eventTypes(runId: string): Promise<string[]> {
  const rows = await testSql<{ type: string }[]>`
    select type from run_events where run_id = ${runId} order by seq`
  return rows.map((row) => row.type)
}

/** Marks a claim used in the Delegation Log, which is one of FR-084's three routes into reliance. */
async function markUsed(runId: string, delegationId: string, claimId: string): Promise<void> {
  await assistant.updateDelegation(fx.student, runId, delegationId, { usedClaimIds: [claimId] })
}

beforeEach(async () => {
  await truncateAll()
  runs = await import('@/server/modules/runs')
  assistant = await import('@/server/modules/assistant')
  reliance = await import('@/server/modules/reliance')
  advanceClock = await import('@/app/api/v1/test/runs/[runId]/advance-clock/route')
  fx = await setupAssistantFixture('lock')
})

afterAll(async () => {
  await truncateAll()
  await appSql.end({ timeout: 5 })
})

// ---------------------------------------------------------------------------------------------
// The lock gate (FR-084, FR-101)
// ---------------------------------------------------------------------------------------------

describe('lockDecision refuses over an unstanced relied-on claim', () => {
  it('names the claim the student marked used in the Delegation Log', async () => {
    const runId = await runInWorking(fx)
    const delegationId = await delegate(fx, runId, 'What is the premium payback?')
    const c3 = fx.claimId('C3')
    await markUsed(runId, delegationId, c3)

    expect(await refusalOf(runs.lockDecision(fx.student, runId, BRIEF))).toEqual({
      code: 'LOCK_REFUSED_UNSTANCED_CLAIM',
      details: { claimId: c3, claimText: claimByKey('C3').text },
    })

    // The refusal is part of the record, and it survives the transaction that raised it (rule 2 of
    // the service's own header): a reader of the trace sees the lock the student did not get.
    const refusals = await eventsOfType(runId, 'lock_refused')
    expect(refusals).toHaveLength(1)
    expect(refusals[0]?.payload).toEqual({
      reason: 'unstanced_relied_on',
      claim_id: c3,
      claim_text: claimByKey('C3').text,
    })
    // And nothing was locked: the run is still working and the brief has no `locked_at`.
    expect((await runRow(runId)).state).toBe('working')
    expect(await briefRow(runId)).toBeUndefined()
  })

  it('names the claim whose figure the student typed into a named field (FR-101, D-076)', async () => {
    const runId = await runInWorking(fx)
    // D5 carries C1, which carries 4.2 months with no field key of its own.
    await openDocument(fx, runId, 'D5')
    const c1 = fx.claimId('C1')

    const refusal = await refusalOf(
      runs.lockDecision(fx.student, runId, {
        ...BRIEF,
        namedValues: { premium_payback_months: 4.2 },
      }),
    )

    expect(refusal).toEqual({
      code: 'LOCK_REFUSED_UNSTANCED_CLAIM',
      details: { claimId: c1, claimText: claimByKey('C1').text },
    })
    // The mark itself stands: FR-101's reliance is a statement the student made about their own
    // work, and a route that took it back would be a way past the gate rather than through it
    // (D-270). The `claim_used` event says so.
    const rows = await runClaimRows(runId)
    expect(rows.find((row) => row.key === 'C1')?.relied_on_via).toEqual(['named_field'])
    const used = await eventsOfType(runId, 'claim_used')
    expect(used.map((event) => event.payload)).toEqual([
      { claim_id: c1, via: 'named_field', field_key: 'premium_payback_months' },
    ])
  })

  it('names the earliest of the two when a mark and a figure both point at claims', async () => {
    const runId = await runInWorking(fx)
    // C1 is surfaced first, by the document; C3 second, by the delegation. The gate reads
    // `surfaced_at`, so the claim the student met first is the one they are asked about.
    await openDocument(fx, runId, 'D5')
    const delegationId = await delegate(fx, runId, 'What is the premium payback?')
    await markUsed(runId, delegationId, fx.claimId('C3'))

    const refusal = await refusalOf(
      runs.lockDecision(fx.student, runId, {
        ...BRIEF,
        namedValues: { premium_payback_months: 4.2 },
      }),
    )

    expect(refusal).toEqual({
      code: 'LOCK_REFUSED_UNSTANCED_CLAIM',
      details: { claimId: fx.claimId('C1'), claimText: claimByKey('C1').text },
    })
    // Both are relied on; both would be named in turn as the student takes each stance.
    const relied = (await runClaimRows(runId)).filter((row) => row.relied_on).map((row) => row.key)
    expect(relied.sort()).toEqual(['C1', 'C3'])
  })

  it('lets the lock through once the stance is taken', async () => {
    const runId = await runInWorking(fx)
    await openDocument(fx, runId, 'D5')
    const brief = { ...BRIEF, namedValues: { premium_payback_months: 4.2 } }

    expect((await refusalOf(runs.lockDecision(fx.student, runId, brief))).code).toBe(
      'LOCK_REFUSED_UNSTANCED_CLAIM',
    )
    await reliance.setStance(fx.student, runId, fx.claimId('C1'), 'verify')

    const summary = await runs.lockDecision(fx.student, runId, brief)
    expect(summary.state).toBe('decision_locked')
    // One refusal and one lock, in that order: the record shows both attempts (FR-084, FR-108).
    expect((await eventTypes(runId)).filter((type) => type.startsWith('lock'))).toEqual([
      'lock_refused',
    ])
    const locked = await eventsOfType(runId, 'decision_locked')
    expect(locked).toHaveLength(1)
  })

  it('refuses a brief over its limits before it touches reliance, and names the field', async () => {
    const runId = await runInWorking(fx)
    await openDocument(fx, runId, 'D5')
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

    const refusal = await refusalOf(
      runs.lockDecision(fx.student, runId, {
        ...BRIEF,
        rationale: words(251),
        namedValues: { premium_payback_months: 4.2 },
      }),
    )

    expect(refusal).toEqual({
      code: 'BRIEF_INVALID',
      details: { field: 'rationale', reason: 'word_limit' },
    })
    // Nothing was marked: the student is told about the rationale, and their reliance is untouched
    // because the lock never got past its own form.
    expect((await runClaimRows(runId)).every((row) => !row.relied_on)).toBe(true)
    expect(await eventsOfType(runId, 'claim_used')).toEqual([])
    // The refusal is still recorded, with the field it refused over.
    const refusals = await eventsOfType(runId, 'lock_refused')
    expect(refusals[0]?.payload).toEqual({ reason: 'brief_invalid', field: 'rationale' })
  })
})

// ---------------------------------------------------------------------------------------------
// The lock itself (FR-102, FR-106, FR-110)
// ---------------------------------------------------------------------------------------------

describe('lockDecision', () => {
  it('freezes the brief, moves the run, and sets the Turn’s clock', async () => {
    const runId = await runInWorking(fx)
    const before = await runRow(runId)
    expect(before.state).toBe('working')

    const summary = await runs.lockDecision(fx.student, runId, BRIEF)

    expect(summary.state).toBe('decision_locked')
    expect(summary.clock).toBeNull()
    const row = await runRow(runId)
    expect(row.decision_locked_at).not.toBeNull()
    // FR-110: the Turn is delivered after the package's own delay, measured from the lock.
    expect(row.turn_due_at?.getTime()).toBe(
      (row.decision_locked_at as Date).getTime() + FIXTURE.version.turnDelaySeconds * 1000,
    )
    expect(summary.turn?.dueAt).toBe(row.turn_due_at?.toISOString())

    const brief = await briefRow(runId)
    expect(brief).toMatchObject({
      recommendation: BRIEF.recommendation,
      assumptions: BRIEF.assumptions,
      change_my_mind: BRIEF.changeMyMind,
      confidence: 45,
      auto_locked: false,
    })
    expect(brief?.locked_at).not.toBeNull()
  })

  it('writes decision_locked with the brief and both relied-on lists (10 §10)', async () => {
    const runId = await runInWorking(fx)
    await openDocument(fx, runId, 'D5')
    const c1 = fx.claimId('C1')
    await reliance.setStance(fx.student, runId, c1, 'verify')

    await runs.lockDecision(fx.student, runId, {
      ...BRIEF,
      namedValues: { premium_payback_months: 4.2 },
    })

    const [event] = await eventsOfType(runId, 'decision_locked')
    expect(event?.payload).toMatchObject({
      recommendation: BRIEF.recommendation,
      rationale: BRIEF.rationale,
      assumptions: BRIEF.assumptions,
      change_my_mind: BRIEF.changeMyMind,
      named_values: { premium_payback_months: 4.2 },
      confidence: 45,
      auto: false,
      relied_on_claim_ids: [c1],
      // Empty by construction on a student's lock: the gate is what makes it so (FR-084).
      unstanced_relied_on_claim_ids: [],
    })
    expect(typeof event?.payload.elapsed_ms).toBe('number')

    // The lifecycle event follows it, in the order the two things happened.
    const types = await eventTypes(runId)
    expect(types.slice(-2)).toEqual(['decision_locked', 'lifecycle'])
  })

  it('refuses a brief update after the lock — the trigger, not the service (NFR-005)', async () => {
    const runId = await runInWorking(fx)
    await runs.lockDecision(fx.student, runId, BRIEF)

    // The application role is the one preview and production run as, and migration 0006's
    // `run_briefs_locked` is what refuses it. `RAISE EXCEPTION 'BRIEF_LOCKED'` arrives as a
    // PostgresError with that message.
    await expect(
      appSql`update run_briefs set recommendation = 'edited after the fact' where run_id = ${runId}`,
    ).rejects.toThrow(/BRIEF_LOCKED/)

    expect((await briefRow(runId))?.recommendation).toBe(BRIEF.recommendation)
  })

  it('closes the room and refuses every write of the working period afterwards (FR-102)', async () => {
    const runId = await runInWorking(fx)
    const opened = await openDocument(fx, runId, 'D5')

    await runs.lockDecision(fx.student, runId, BRIEF)

    // 10 §6: a document open without a close is closed by the lock.
    const [row] = await testSql<{ closed_at: Date | null }[]>`
      select closed_at from run_document_opens where id = ${opened.openId}`
    expect(row?.closed_at).not.toBeNull()

    expect(await codeOf(runs.saveBriefDraft(fx.student, runId, { rationale: 'later' }))).toBe(
      'RUN_LOCKED',
    )
    expect(await codeOf(runs.lockDecision(fx.student, runId, BRIEF))).toBe('RUN_LOCKED')
    expect(await codeOf(runs.briefSignal(fx.student, runId, { opened: true }))).toBe('RUN_LOCKED')
    expect(await codeOf(runs.openDocument(fx.student, runId, fx.documentId('D5')))).toBe(
      'RUN_LOCKED',
    )
  })

  it('flags a lock under four minutes of working time, and not one over (FR-106)', async () => {
    const fast = await runInWorking(fx)
    await runs.lockDecision(fx.student, fast, BRIEF)
    expect((await briefRow(fast))?.speed_outlier).toBe(true)
    expect((await eventsOfType(fast, 'decision_locked'))[0]?.payload.speed_outlier).toBe(true)
  })

  it('does not flag a lock five minutes in', async () => {
    const runId = await runInWorking(fx)
    // Twenty of the twenty-five minutes left is five minutes of working time spent, which is what
    // the flag reads — the clock's origin is the frame lock (D-042).
    await setClockRemaining(runId, 20 * 60_000)

    await runs.lockDecision(fx.student, runId, BRIEF)

    expect((await briefRow(runId))?.speed_outlier).toBe(false)
    const [event] = await eventsOfType(runId, 'decision_locked')
    expect(event?.payload.speed_outlier).toBe(false)
    expect(Number(event?.payload.elapsed_ms)).toBeGreaterThanOrEqual(5 * 60_000 - 5_000)
  })

  it('refuses the lock while the run is paused (FR-001)', async () => {
    const runId = await runInWorking(fx)
    await forcePaused(runId)

    expect((await refusalOf(runs.lockDecision(fx.student, runId, BRIEF))).code).toBe('RUN_PAUSED')
    expect(await codeOf(runs.saveBriefDraft(fx.student, runId, { rationale: 'later' }))).toBe(
      'RUN_PAUSED',
    )
    // Nothing was written: not the lock, and not the refusal — a paused run's clock is stopped and
    // there is nothing to record but the pause itself.
    expect(await eventsOfType(runId, 'lock_refused')).toEqual([])
    expect((await runRow(runId)).state).toBe('paused')
  })
})

// ---------------------------------------------------------------------------------------------
// The draft and its two timing signals (FR-100, FR-108)
// ---------------------------------------------------------------------------------------------

describe('saveBriefDraft and briefSignal', () => {
  it('saves what changed and leaves the rest alone', async () => {
    const runId = await runInWorking(fx)

    await runs.saveBriefDraft(fx.student, runId, { recommendation: 'Hold the spend' })
    await runs.saveBriefDraft(fx.student, runId, {
      namedValues: { premium_payback_months: 11 },
      confidence: 30,
    })

    const row = await briefRow(runId)
    expect(row).toMatchObject({
      recommendation: 'Hold the spend',
      confidence: 30,
      named_values: { premium_payback_months: 11 },
    })
    // A draft writes no trace event: it is a scratchpad row until the lock.
    expect(await eventTypes(runId)).not.toContain('decision_locked')
    expect(await eventsOfType(runId, 'brief_opened')).toEqual([])
  })

  it('reads back on the workspace, which is what a refused lock returns to (FR-108)', async () => {
    const runId = await runInWorking(fx)
    await runs.saveBriefDraft(fx.student, runId, {
      recommendation: 'Hold the spend',
      assumptions: BRIEF.assumptions,
    })

    const workspace = await runs.getRunWorkspace(fx.student, runId)
    expect(workspace.briefDraft).toMatchObject({
      recommendation: 'Hold the spend',
      assumptions: BRIEF.assumptions,
      confidence: null,
      lockedAt: null,
    })
    expect(workspace.capabilities.canWriteBrief).toBe(true)
    expect(workspace.addendum).toBeNull()
  })

  it('refuses a draft field over its limit, naming it (FR-103)', async () => {
    const runId = await runInWorking(fx)
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

    expect(
      await refusalOf(runs.saveBriefDraft(fx.student, runId, { recommendation: words(121) })),
    ).toEqual({ code: 'BRIEF_INVALID', details: { field: 'recommendation', reason: 'word_limit' } })
    expect(await briefRow(runId)).toBeUndefined()
  })

  it('refuses a body carrying more named values than a brief has fields (D-333)', async () => {
    // `BriefNamedValuesSchema`'s own note said the bounds existed — "a body carrying two thousand
    // keys is not a brief" — and nothing enforced the count. Two thousand keys were accepted,
    // stored on `run_briefs.named_values`, and would have travelled whole into the immutable
    // `decision_locked` payload.
    const runId = await runInWorking(fx)
    const many: Record<string, number> = {}
    for (let i = 0; i < 2_000; i += 1) many[`k${i}`] = i

    expect(await refusalOf(runs.saveBriefDraft(fx.student, runId, { namedValues: many }))).toEqual({
      code: 'BRIEF_INVALID',
      details: { field: 'namedValues', reason: 'invalid' },
    })
    expect(await briefRow(runId)).toBeUndefined()

    // And the lock refuses the same body, because the rule is on both schemas rather than on the
    // draft alone (D-291's split kept).
    expect(
      (await refusalOf(runs.lockDecision(fx.student, runId, { ...BRIEF, namedValues: many }))).code,
    ).toBe('BRIEF_INVALID')

    // The number a real package asks for is still accepted.
    await runs.saveBriefDraft(fx.student, runId, {
      namedValues: { premium_payback_months: 4.2 },
    })
    expect(await briefRow(runId)).toMatchObject({
      named_values: { premium_payback_months: 4.2 },
    })
  })

  it('writes brief_opened and brief_closed with the duration', async () => {
    const runId = await runInWorking(fx)

    await runs.briefSignal(fx.student, runId, { opened: true })
    await runs.briefSignal(fx.student, runId, { closed: true, durationMs: 42_000 })

    expect((await eventsOfType(runId, 'brief_opened'))[0]?.payload).toEqual({})
    expect((await eventsOfType(runId, 'brief_closed'))[0]?.payload).toEqual({ duration_ms: 42_000 })
  })
})

// ---------------------------------------------------------------------------------------------
// The addendum (FR-107)
// ---------------------------------------------------------------------------------------------

describe('addAddendum', () => {
  const TEXT = 'On reflection the payback figure should have been traced before the spend moved.'

  it('is offered only after the lock', async () => {
    const runId = await runInWorking(fx)
    expect(await codeOf(runs.addAddendum(fx.student, runId, { text: TEXT }))).toBe(
      'ILLEGAL_TRANSITION',
    )

    await runs.lockDecision(fx.student, runId, BRIEF)
    await runs.addAddendum(fx.student, runId, { text: TEXT })

    expect((await addendumRow(runId))?.text).toBe(TEXT)
    expect((await eventsOfType(runId, 'addendum'))[0]?.payload).toEqual({ text: TEXT })
  })

  it('is offered once', async () => {
    const runId = await runInWorking(fx)
    await runs.lockDecision(fx.student, runId, BRIEF)
    await runs.addAddendum(fx.student, runId, { text: TEXT })

    expect(await codeOf(runs.addAddendum(fx.student, runId, { text: 'A second thought.' }))).toBe(
      'ADDENDUM_EXISTS',
    )
    expect((await addendumRow(runId))?.text).toBe(TEXT)
    expect(await eventsOfType(runId, 'addendum')).toHaveLength(1)
  })

  it('is fifty words, and never empty', async () => {
    const runId = await runInWorking(fx)
    await runs.lockDecision(fx.student, runId, BRIEF)
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

    expect(await codeOf(runs.addAddendum(fx.student, runId, { text: words(51) }))).toBe(
      'VALIDATION_ERROR',
    )
    expect(await codeOf(runs.addAddendum(fx.student, runId, { text: '   ' }))).toBe(
      'VALIDATION_ERROR',
    )
    expect(await addendumRow(runId)).toBeUndefined()

    await runs.addAddendum(fx.student, runId, { text: words(50) })
    expect((await addendumRow(runId))?.text).toBe(words(50))
  })

  it('is rendered apart from the brief, which is unchanged (FR-107)', async () => {
    const runId = await runInWorking(fx)
    await runs.lockDecision(fx.student, runId, BRIEF)
    await runs.addAddendum(fx.student, runId, { text: TEXT })

    expect((await briefRow(runId))?.recommendation).toBe(BRIEF.recommendation)
    expect((await addendumRow(runId))?.text).toBe(TEXT)
  })
})

// ---------------------------------------------------------------------------------------------
// The auto-lock at expiry (FR-105, D-044, 10 §8 branch 2)
// ---------------------------------------------------------------------------------------------

describe('the clock locks the decision by itself', () => {
  /** `POST /api/v1/test/runs/{runId}/advance-clock` (D-109): the only honest way to reach an expiry. */
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

  const PAST_EXPIRY = FIXTURE.version.workingClockSeconds * 1000 + 5_000

  it('records the empty fields as empty and the unstanced relied-on claims as unstanced', async () => {
    const runId = await runInWorking(fx)
    // The student opened the room, typed one figure into the brief, and never filed it.
    await openDocument(fx, runId, 'D5')
    const c1 = fx.claimId('C1')
    await runs.saveBriefDraft(fx.student, runId, {
      namedValues: { premium_payback_months: 4.2 },
    })

    const response = await advance(runId, PAST_EXPIRY)
    expect(response.status).toBe(200)

    expect((await runRow(runId)).state).toBe('decision_locked')
    const brief = await briefRow(runId)
    expect(brief).toMatchObject({
      recommendation: '',
      rationale: '',
      assumptions: ['', '', ''],
      change_my_mind: '',
      confidence: null,
      named_values: { premium_payback_months: 4.2 },
      auto_locked: true,
    })

    const [event] = await eventsOfType(runId, 'decision_locked')
    expect(event?.payload).toMatchObject({
      auto: true,
      recommendation: '',
      confidence: null,
      relied_on_claim_ids: [c1],
      // FR-105: unstanced, never accepted. This is the whole of what the auto-lock decides.
      unstanced_relied_on_claim_ids: [c1],
    })
    // The claim's own row agrees: relied on, no stance (`stance: null, relied_on: true`).
    const row = (await runClaimRows(runId)).find((claim) => claim.key === 'C1')
    expect(row?.relied_on).toBe(true)
    expect(row?.stance).toBeNull()
  })

  it('stamps the expiry instant, not the instant of the read that noticed it (NFR-002)', async () => {
    const runId = await runInWorking(fx)
    const readAt = Date.now()
    await advance(runId, PAST_EXPIRY)

    const [row] = await testSql<{ occurred_at: Date; clock_remaining_ms: number | null }[]>`
      select occurred_at, clock_remaining_ms from run_events
       where run_id = ${runId} and type = 'decision_locked'`
    // Five seconds past the clock's end when the read arrived, so the event is stamped about five
    // seconds ago rather than now.
    expect(readAt - (row as { occurred_at: Date }).occurred_at.getTime()).toBeGreaterThan(3_000)
    // And the clock reading on it is the moment it ran out.
    expect(row?.clock_remaining_ms).toBe(0)

    // `turn_due_at` is measured from the same instant, so a browser closed for the whole clock comes
    // back to a run whose Turn is due when it would have been (D-109, 10 §8).
    const run = await runRow(runId)
    expect(run.turn_due_at?.getTime()).toBe(
      (run.decision_locked_at as Date).getTime() + FIXTURE.version.turnDelaySeconds * 1000,
    )
  })

  it('locks a run whose student never opened the brief at all', async () => {
    const runId = await runInWorking(fx)
    await advance(runId, PAST_EXPIRY)

    expect((await runRow(runId)).state).toBe('decision_locked')
    expect(await briefRow(runId)).toMatchObject({ recommendation: '', auto_locked: true })
    const [event] = await eventsOfType(runId, 'decision_locked')
    expect(event?.payload).toMatchObject({
      auto: true,
      relied_on_claim_ids: [],
      unstanced_relied_on_claim_ids: [],
    })
  })

  it('happens on an ordinary read, without a scheduler (ADR-019)', async () => {
    const runId = await runInWorking(fx)
    await setClockRemaining(runId, -2_000)

    // No test route, no job: the poll every run screen makes is what materializes it.
    const summary = await runs.getRun(fx.student, runId)
    expect(summary.state).toBe('decision_locked')
    expect((await briefRow(runId))?.auto_locked).toBe(true)
  })

  it('leaves the addendum as the one thing still open', async () => {
    const runId = await runInWorking(fx)
    await advance(runId, PAST_EXPIRY)

    await runs.addAddendum(fx.student, runId, { text: 'The clock beat me to it.' })
    expect((await addendumRow(runId))?.text).toBe('The clock beat me to it.')
  })
})
