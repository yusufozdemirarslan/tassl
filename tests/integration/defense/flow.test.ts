// Step 9.2 — the defense against Postgres (docs/tech/10-backend-spec-modules.md §9; PRD §7.12;
// FR-025, FR-120 to FR-126, DATA-039, D-031, D-046, D-080, D-090, D-106).
//
// Five claims about the defense are worth a database to prove rather than a mock.
//
//   * **It is selected once and resumed, never re-drawn.** FR-126's dropped connection comes back to
//     the same interview, and "the same" is a fact about rows and about the trace: the second open
//     writes no second `defense_question`, and the questions come back in the order they were asked
//     with the answers already given marked.
//   * **A follow-up is a question the run recorded asking.** It carries `follow_up_of` and writes
//     its own `defense_question` event (FR-123), at most once per question, and never in a chain.
//   * **An empty answer is an answer** (FR-124), and a defense of nothing but empty answers sets
//     `flags.nothing_answered` — a flag for the instructor that the student is never shown.
//   * **Completing enqueues scoring** (D-046): a `pgboss.job` row with the singleton key, written
//     after the transaction committed, on a queue whose handler arrives in Phase 10.
//   * **The interview is not a function of the variant.** Two runs, one on the defective variant and
//     one on the sound one, doing exactly the same things, are asked exactly the same questions in
//     exactly the same words. This is the invariant sweep of CLAUDE.md read where it can actually be
//     falsified — `selection.ts` reads no variant table, and this is what keeps it that way.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import {
  FIXTURE,
  FRAME,
  codeOf,
  runInWorking,
  setupAssistantFixture,
  type AssistantFixture,
} from '../reliance/fixture'
import { isAppError } from '@/lib/errors'
import { findForbiddenKeys } from '@/server/auth/student-view'
import { stopBoss } from '@/server/jobs/boss'

type Defense = typeof import('@/server/modules/defense')
type Reliance = typeof import('@/server/modules/reliance')
type Runs = typeof import('@/server/modules/runs')
type Factories = typeof import('@tests/factories')
type AdvanceClockRoute = typeof import('@/app/api/v1/test/runs/[runId]/advance-clock/route')

let defense: Defense
let reliance: Reliance
let runs: Runs
let advanceClock: AdvanceClockRoute
let fx: AssistantFixture

const TURN_DELAY_MS = FIXTURE.version.turnDelaySeconds * 1000

/**
 * A brief that files two figures no claim carries and no document states (FR-025).
 *
 * 19 months and 35 percent are checked against the fixture's own numbers: neither is a claim's
 * carried value and neither appears in any of the nine document bodies, so both draw the figure
 * provenance question and neither marks a claim relied on at the lock (FR-101).
 *
 * The three assumptions are near-copies of the frame's, so no assumption question is drawn and the
 * interview stays inside the cap — the departure rule has its own suite in
 * `tests/unit/defense/selection.test.ts`, where it can be varied one assumption at a time.
 */
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
  // Above the frame's 40, so D-080's confidence question is drawn.
  confidence: 45,
  namedValues: { budget_share_to_premium: 35, premium_payback_months: 19 },
}

const RESPONSE = {
  response: 'revise' as const,
  justification:
    'The 78 percent was one cohort acquired under the old pricing, so the payback the recommendation was priced on does not hold and the share sized on it comes down.',
  confidence: 55,
}

// ---------------------------------------------------------------------------------------------
// Reading the record back as it is written, rather than through a projection
// ---------------------------------------------------------------------------------------------

async function questionRows(runId: string) {
  return testSql<
    {
      id: string
      seq: number
      rendered_text: string
      follow_up_of: string | null
      selecting_event_seq: number | null
      key: string
      kind: string
    }[]
  >`select q.id, q.seq, q.rendered_text, q.follow_up_of, q.selecting_event_seq, dq.key, dq.kind
      from run_defense_questions q join defense_questions dq on dq.id = q.question_id
     where q.run_id = ${runId} order by q.seq`
}

async function answerRows(runId: string) {
  return testSql<{ run_defense_question_id: string; text: string; duration_ms: number }[]>`
    select run_defense_question_id, text, duration_ms from run_defense_answers
     where run_id = ${runId} order by answered_at, id`
}

async function eventsOfType(runId: string, type: string) {
  return testSql<{ seq: number; payload: Record<string, unknown> }[]>`
    select seq, payload from run_events where run_id = ${runId} and type = ${type} order by seq`
}

async function runRow(runId: string) {
  const [row] = await testSql<
    {
      state: string
      scoring_status: string
      defense_opened_at: Date | null
      defense_completed_at: Date | null
      flags: Record<string, unknown>
    }[]
  >`select state, scoring_status, defense_opened_at, defense_completed_at, flags
      from runs where id = ${runId}`
  if (!row) throw new Error(`no run ${runId}`)
  return row
}

async function scoreRunJobs(runId: string) {
  return testSql<{ singleton_key: string | null; name: string }[]>`
    select singleton_key, name from pgboss.job
     where name = 'score_run' and data->>'runId' = ${runId}`
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

/**
 * A run in `defense_pending`: framed, filed, the Turn delivered, its claims stanced, a revision
 * filed. This is the walkthrough's step 9 finishing, and step 10 about to begin.
 */
async function runInDefense(assignmentId = fx.assignment.id): Promise<string> {
  const runId =
    assignmentId === fx.assignment.id ? await runInWorking(fx) : await runInWorkingOn(assignmentId)
  await runs.lockDecision(fx.student, runId, BRIEF)
  await advance(runId, TURN_DELAY_MS + 2_000)
  for (const claim of await reliance.listRunClaims(fx.student, runId)) {
    if (claim.inTurnWindow && claim.stance === null) {
      await reliance.setStance(fx.student, runId, claim.id, 'verify')
    }
  }
  await runs.respondToTurn(fx.student, runId, RESPONSE)
  return runId
}

/** `runInWorking`, on an assignment other than the fixture's (the sound-variant run). */
async function runInWorkingOn(assignmentId: string): Promise<string> {
  const started = await runs.startRun(fx.student, assignmentId)
  await runs.acknowledgePolicy(fx.student, started.id)
  await runs.submitReadiness(fx.student, started.id)
  await runs.lockFrame(fx.student, started.id, FRAME)
  return started.id
}

/** Answers every unanswered question, following the follow-ups the answers produce. */
async function answerEverything(runId: string, text: string): Promise<number> {
  let answered = 0
  for (let round = 0; round < 40; round += 1) {
    const view = await defense.openDefense(fx.student, runId)
    const next = view.questions.find((question) => !question.answered)
    if (!next) return answered
    await defense.answerQuestion(fx.student, runId, next.runQuestionId, {
      text,
      durationMs: 1_000,
    })
    answered += 1
  }
  throw new Error('the defense never ran out of questions')
}

beforeEach(async () => {
  await truncateAll()
  defense = await import('@/server/modules/defense')
  reliance = await import('@/server/modules/reliance')
  runs = await import('@/server/modules/runs')
  advanceClock = await import('@/app/api/v1/test/runs/[runId]/advance-clock/route')
  fx = await setupAssistantFixture('defense-flow')
  await testSql`delete from pgboss.job where name = 'score_run'`
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// Opening (FR-120, FR-121, FR-126)
// ---------------------------------------------------------------------------------------------

describe('opening the defense', () => {
  it('selects six to nine questions and writes one `defense_question` each', async () => {
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)

    expect(view.questions.length).toBeGreaterThanOrEqual(6)
    expect(view.questions.length).toBeLessThanOrEqual(9)
    expect(view.questions.map((question) => question.seq)).toEqual(
      view.questions.map((_, index) => index + 1),
    )
    expect(view.questions.every((question) => question.text.length > 0)).toBe(true)
    expect(view.questions.every((question) => !question.answered)).toBe(true)

    const events = await eventsOfType(runId, 'defense_question')
    expect(events).toHaveLength(view.questions.length)
    expect(events.map((event) => event.payload.run_question_id)).toEqual(
      view.questions.map((question) => question.runQuestionId),
    )
    expect(events.every((event) => event.payload.follow_up_of === null)).toBe(true)
    // No clock runs in the defense, so no event may record one running.
    const [clock] = await testSql<{ clock_remaining_ms: number | null }[]>`
      select clock_remaining_ms from run_events
       where run_id = ${runId} and type = 'defense_question' order by seq limit 1`
    expect(clock?.clock_remaining_ms).toBeNull()

    expect((await runRow(runId)).defense_opened_at).not.toBeNull()
  })

  it('draws the conditions this run actually met, in 10 §9’s order', async () => {
    const runId = await runInDefense()
    await defense.openDefense(fx.student, runId)

    const rows = await questionRows(runId)
    expect(rows.map((row) => row.kind)).toEqual([
      // The two claims the Turn window raised, relied on by rule and never traced (D-077).
      'provenance',
      'provenance',
      // Both figures in the brief match no claim and no document (FR-025).
      'figure_provenance',
      'figure_provenance',
      // Confidence rose from 40 at the frame to 45 at the lock (D-080).
      'confidence',
      // A response the student filed, not the window's implicit hold (D-106).
      'frame_vs_response',
      'counterfactual',
    ])
    // FR-122: the student's own claims and figures are in the sentences.
    expect(rows[0]?.rendered_text).toContain('78 percent')
    expect(rows.map((row) => row.rendered_text).join(' ')).toContain('35 percent')
    expect(rows.map((row) => row.rendered_text).join(' ')).toContain('19 months')
    // Every rendered sentence is finished: no placeholder reaches a student.
    expect(rows.every((row) => !row.rendered_text.includes('{'))).toBe(true)
  })

  it('carries the frozen record and no room (UI-026, FR-120)', async () => {
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)

    expect(view.artifacts.frame?.decision).toBe(FRAME.decision)
    expect(view.artifacts.brief?.recommendation).toBe(BRIEF.recommendation)
    expect(view.artifacts.brief?.namedValues).toEqual(BRIEF.namedValues)
    expect(view.artifacts.turnResponse).toMatchObject({ response: 'revise', implicit: false })
    expect(view.artifacts.namedFields.length).toBeGreaterThan(0)
    expect(Object.keys(view).sort()).toEqual(['artifacts', 'questions'])
    expect(Object.keys(view.artifacts).sort()).toEqual([
      'addendum',
      'brief',
      'frame',
      'namedFields',
      'turnResponse',
    ])

    // The room is sealed for the run's own student in this state (D-279, UI-026).
    expect(await codeOf(reliance.listRunClaims(fx.student, runId))).toBe('FORBIDDEN')
  })

  it('selects once: a second open writes no second question and no second event', async () => {
    const runId = await runInDefense()
    const first = await defense.openDefense(fx.student, runId)
    const openedAt = (await runRow(runId)).defense_opened_at

    const second = await defense.openDefense(fx.student, runId)
    expect(second.questions).toEqual(first.questions)
    expect(await eventsOfType(runId, 'defense_question')).toHaveLength(first.questions.length)
    expect((await runRow(runId)).defense_opened_at).toEqual(openedAt)
  })

  it('refuses a run that is not in the defense, with the state it is in', async () => {
    const runId = await runInWorking(fx)
    expect(await codeOf(defense.openDefense(fx.student, runId))).toBe('DEFENSE_NOT_OPEN')
    expect(await detailsOf(defense.openDefense(fx.student, runId))).toEqual({ state: 'working' })
  })

  it('is the owner’s alone: an instructor of the section is not served it', async () => {
    const runId = await runInDefense()
    expect(await codeOf(defense.openDefense(fx.instructor, runId))).toBe('NOT_FOUND')
    expect(await codeOf(defense.openDefense(fx.classmate, runId))).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------------------------
// Answering and the follow-up (FR-123, FR-124)
// ---------------------------------------------------------------------------------------------

describe('answering a question', () => {
  it('writes `defense_answer` and returns the next question', async () => {
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)
    const [first, second] = view.questions
    if (!first || !second) throw new Error('expected at least two questions')

    const result = await defense.answerQuestion(fx.student, runId, first.runQuestionId, {
      text: 'I traced it to the quarterly acquisition cohort table, dated 15 July 2026.',
      durationMs: 42_000,
    })

    expect(result.next?.runQuestionId).toBe(second.runQuestionId)
    // The answer named a document and a number, so no follow-up (D-031).
    expect(result.followUpQuestion).toBeNull()

    const answers = await answerRows(runId)
    expect(answers).toHaveLength(1)
    expect(answers[0]).toMatchObject({
      run_defense_question_id: first.runQuestionId,
      duration_ms: 42_000,
    })

    const events = await eventsOfType(runId, 'defense_answer')
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({
      run_question_id: first.runQuestionId,
      duration_ms: 42_000,
    })
  })

  it('inserts the authored follow-up when the answer names nothing (D-031)', async () => {
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)
    const first = view.questions[0]
    if (!first) throw new Error('expected a question')

    const result = await defense.answerQuestion(fx.student, runId, first.runQuestionId, {
      text: 'The assistant said so.',
      durationMs: 9_000,
    })

    expect(result.followUpQuestion).not.toBeNull()
    expect(result.followUpQuestion?.followUpOf).toBe(first.runQuestionId)
    expect(result.followUpQuestion?.answered).toBe(false)
    // The follow-up is not "next": UI-026 draws it beneath its parent.
    expect(result.next?.runQuestionId).toBe(view.questions[1]?.runQuestionId)

    const rows = await questionRows(runId)
    const followUp = rows.find((row) => row.follow_up_of === first.runQuestionId)
    expect(followUp?.seq).toBe(view.questions.length + 1)
    // It is the author's own sentence, from the bank row the parent was rendered from.
    const [authored] = await testSql<{ follow_up: string }[]>`
      select dq.follow_up from run_defense_questions q
        join defense_questions dq on dq.id = q.question_id
       where q.id = ${first.runQuestionId}`
    expect(followUp?.rendered_text).toBe(authored?.follow_up)

    const events = await eventsOfType(runId, 'defense_question')
    const followUpEvent = events.find((event) => event.payload.follow_up_of === first.runQuestionId)
    expect(followUpEvent?.payload).toMatchObject({
      run_question_id: followUp?.id,
      seq: followUp?.seq,
      selecting_event_seq: null,
    })
  })

  it('asks a follow-up at most once per question, and never of a follow-up', async () => {
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)
    const first = view.questions[0]
    if (!first) throw new Error('expected a question')

    const { followUpQuestion: followUp } = await defense.answerQuestion(
      fx.student,
      runId,
      first.runQuestionId,
      {
        text: 'The assistant said so.',
        durationMs: 9_000,
      },
    )
    if (!followUp) throw new Error('expected a follow-up')

    // Answering the follow-up with nothing does not produce a follow-up of a follow-up.
    const second = await defense.answerQuestion(fx.student, runId, followUp.runQuestionId, {
      text: 'I do not know.',
      durationMs: 4_000,
    })
    expect(second.followUpQuestion).toBeNull()

    const rows = await questionRows(runId)
    expect(rows.filter((row) => row.follow_up_of !== null)).toHaveLength(1)
  })

  it('asks one authored follow-up sentence once, across the questions that share a bank row (D-366)', async () => {
    // The brief files two figures no claim carries and no document states, so `figure_provenance`
    // draws two questions — and both reuse the one bank row D-135 requires, because `question_id` is
    // not unique per run. There is one authored sentence on that row and nothing renders it, so two
    // empty answers used to earn the identical question twice, with nothing in either saying which
    // figure it was pressing on.
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)

    const rows = await questionRows(runId)
    const figures = rows.filter((row) => row.kind === 'figure_provenance')
    expect(figures.length).toBeGreaterThanOrEqual(2)
    expect(new Set(figures.map((row) => row.key)).size).toBe(1)

    const asked: (string | null)[] = []
    for (const row of figures) {
      const question = view.questions.find((entry) => entry.runQuestionId === row.id)
      if (!question) throw new Error(`the interview is missing question ${row.seq}`)
      const result = await defense.answerQuestion(fx.student, runId, question.runQuestionId, {
        text: '',
        durationMs: 0,
      })
      asked.push(result.followUpQuestion?.text ?? null)
    }

    // The first press lands; the second is the same sentence and is not asked again.
    expect(asked[0]).not.toBeNull()
    expect(asked.slice(1).every((text) => text === null)).toBe(true)

    const after = await questionRows(runId)
    const followUps = after.filter((row) => row.follow_up_of !== null)
    expect(followUps).toHaveLength(1)
    expect(new Set(after.map((row) => row.rendered_text)).size).toBe(after.length)
  })

  it('refuses a second answer to the same question (FR-124)', async () => {
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)
    const first = view.questions[0]
    if (!first) throw new Error('expected a question')

    const answer = { text: 'From the cohort table of 15 July 2026.', durationMs: 1_000 }
    await defense.answerQuestion(fx.student, runId, first.runQuestionId, answer)
    expect(
      await codeOf(defense.answerQuestion(fx.student, runId, first.runQuestionId, answer)),
    ).toBe('QUESTION_ALREADY_ANSWERED')
    expect(await answerRows(runId)).toHaveLength(1)
  })

  it('refuses a question that belongs to another run, as a miss', async () => {
    const runId = await runInDefense()
    await defense.openDefense(fx.student, runId)
    expect(
      await codeOf(
        defense.answerQuestion(fx.student, runId, crypto.randomUUID(), {
          text: 'x',
          durationMs: 0,
        }),
      ),
    ).toBe('NOT_FOUND')
  })

  it('refuses an answer over five thousand characters, naming the field', async () => {
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)
    const first = view.questions[0]
    if (!first) throw new Error('expected a question')

    const promise = defense.answerQuestion(fx.student, runId, first.runQuestionId, {
      text: 'a'.repeat(5_001),
      durationMs: 1_000,
    })
    expect(await codeOf(promise)).toBe('VALIDATION_ERROR')
    expect(await answerRows(runId)).toHaveLength(0)
  })

  it('records a nonsense duration as a day at most, rather than failing on int4 (D-362)', async () => {
    // `duration_ms` is a client measurement the server cannot check, and `run_defense_answers`
    // stores it in an `integer` (DATA-039). Unbounded, 3,000,000,000 passed the schema, reached the
    // insert and came back as a raw Postgres 22003 — a 500 with no code, on the answer itself, which
    // is the student's own work. It is clamped instead: the ceiling is the same day D-249 puts on a
    // document open, and the answer is stored.
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)
    const [first, second] = view.questions
    if (!first || !second) throw new Error('expected at least two questions')

    await defense.answerQuestion(fx.student, runId, first.runQuestionId, {
      text: 'From the cohort table of 15 July 2026, which I opened after the Turn.',
      durationMs: 3_000_000_000,
    })
    const rows = await answerRows(runId)
    expect(rows[0]?.duration_ms).toBe(86_400_000)
    expect((await eventsOfType(runId, 'defense_answer'))[0]?.payload).toMatchObject({
      duration_ms: 86_400_000,
    })

    // A negative reading is nothing rather than a refusal, for the same reason.
    await defense.answerQuestion(fx.student, runId, second.runQuestionId, {
      text: 'The positioning review of February 2025 gives the 61 percent figure.',
      durationMs: -5,
    })
    const both = await answerRows(runId)
    expect(
      both.find((row) => row.run_defense_question_id === second.runQuestionId)?.duration_ms,
    ).toBe(0)
  })

  it('stores an empty answer, and it is an answer (FR-124)', async () => {
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)
    const first = view.questions[0]
    if (!first) throw new Error('expected a question')

    await defense.answerQuestion(fx.student, runId, first.runQuestionId, {
      text: '',
      durationMs: 500,
    })
    const rows = await answerRows(runId)
    expect(rows[0]?.text).toBe('')

    const reopened = await defense.openDefense(fx.student, runId)
    expect(reopened.questions[0]?.answered).toBe(true)
    expect(reopened.questions[0]?.answer?.text).toBe('')
    expect(typeof reopened.questions[0]?.answer?.answeredAt).toBe('string')
  })
})

// ---------------------------------------------------------------------------------------------
// Resuming (FR-126)
// ---------------------------------------------------------------------------------------------

describe('a dropped connection', () => {
  it('resumes at the first unanswered question, with the earlier answers in place', async () => {
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)
    const [first, second, third] = view.questions
    if (!first || !second || !third) throw new Error('expected three questions')

    const answer = { text: 'From the cohort table of 15 July 2026.', durationMs: 1_000 }
    await defense.answerQuestion(fx.student, runId, first.runQuestionId, answer)
    await defense.answerQuestion(fx.student, runId, second.runQuestionId, answer)

    const resumed = await defense.openDefense(fx.student, runId)
    expect(resumed.questions.find((question) => !question.answered)?.runQuestionId).toBe(
      third.runQuestionId,
    )
    expect(resumed.questions[0]?.answer?.text).toBe(answer.text)
    expect(resumed.questions.map((question) => question.runQuestionId)).toEqual(
      view.questions.map((question) => question.runQuestionId),
    )
  })
})

// ---------------------------------------------------------------------------------------------
// Completing (FR-120, FR-125, D-046)
// ---------------------------------------------------------------------------------------------

describe('completing the defense', () => {
  it('is refused while a question has no answer, and names how many', async () => {
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)
    const first = view.questions[0]
    if (!first) throw new Error('expected a question')
    await defense.answerQuestion(fx.student, runId, first.runQuestionId, {
      text: 'From the cohort table of 15 July 2026.',
      durationMs: 1_000,
    })

    expect(await codeOf(defense.completeDefense(fx.student, runId))).toBe('DEFENSE_INCOMPLETE')
    expect(await detailsOf(defense.completeDefense(fx.student, runId))).toEqual({
      unanswered: view.questions.length - 1,
    })
    expect((await runRow(runId)).state).toBe('defense_pending')
    expect(await scoreRunJobs(runId)).toEqual([])
  })

  it('is refused on a defense nobody opened', async () => {
    const runId = await runInDefense()
    expect(await codeOf(defense.completeDefense(fx.student, runId))).toBe('DEFENSE_NOT_OPEN')
  })

  it('transitions, queues scoring, and writes the lifecycle event (D-046)', async () => {
    const runId = await runInDefense()
    await defense.openDefense(fx.student, runId)
    const answered = await answerEverything(
      runId,
      'I traced it to the quarterly acquisition cohort table, dated 15 July 2026.',
    )
    expect(answered).toBeGreaterThanOrEqual(6)

    // What the endpoint answers is the run as this transaction left it: the transition happened and
    // the job is on the queue (D-046). The job runs afterwards, so the summary never says `scored`.
    const summary = await defense.completeDefense(fx.student, runId)
    expect(summary.state).toBe('defense_complete')
    expect(summary.scoringStatus).toBe('queued')
    expect(summary.links.next).toBe(`/runs/${runId}`)

    const row = await runRow(runId)
    expect(row.defense_completed_at).not.toBeNull()
    expect(row.flags.nothing_answered).toBeUndefined()

    const lifecycle = await eventsOfType(runId, 'lifecycle')
    expect(lifecycle.map((event) => event.payload)).toContainEqual({
      from: 'defense_pending',
      to: 'defense_complete',
      cause: 'defense_completed',
    })

    const jobs = await scoreRunJobs(runId)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.singleton_key).toBe(`score_run:${runId}`)

    // Step 10.4 registered the handler, so `enqueue` drains it in this same call (D-181) and the run
    // is scored by the time `completeDefense` returns. Before that step the job sat unclaimed and
    // this row read `defense_complete`; the queue behaviour has not changed, only what answers it.
    expect(row.state).toBe('scored')
    expect(lifecycle.at(-1)?.payload).toEqual({
      from: 'defense_complete',
      to: 'scored',
      cause: 'scored',
    })
  })

  it('sets `nothing_answered` when every answer is empty or under three words (FR-125)', async () => {
    const runId = await runInDefense()
    await defense.openDefense(fx.student, runId)
    await answerEverything(runId, '')

    await defense.completeDefense(fx.student, runId)
    expect((await runRow(runId)).flags.nothing_answered).toBe(true)
  })

  it('does not set it when one answer says three words', async () => {
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)
    const first = view.questions[0]
    if (!first) throw new Error('expected a question')
    await defense.answerQuestion(fx.student, runId, first.runQuestionId, {
      text: 'The cohort table.',
      durationMs: 1_000,
    })
    await answerEverything(runId, '')

    await defense.completeDefense(fx.student, runId)
    expect((await runRow(runId)).flags.nothing_answered).toBeUndefined()
  })

  it('refuses a second completion and every mutation after it', async () => {
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)
    const first = view.questions[0]
    if (!first) throw new Error('expected a question')
    await answerEverything(runId, 'From the cohort table of 15 July 2026.')
    await defense.completeDefense(fx.student, runId)

    expect(await codeOf(defense.completeDefense(fx.student, runId))).toBe('DEFENSE_NOT_OPEN')
    expect(
      await codeOf(
        defense.answerQuestion(fx.student, runId, first.runQuestionId, {
          text: 'again',
          durationMs: 1,
        }),
      ),
    ).toBe('DEFENSE_NOT_OPEN')
    // The interview stays on the record whatever the run does next; where a student reads it once
    // the run is scored is the debrief's question (10 §13), not this endpoint's.
    const rows = await testSql<{ answered: boolean }[]>`
      select (a.id is not null) as answered from run_defense_questions q
        left join run_defense_answers a on a.run_defense_question_id = q.id
       where q.run_id = ${runId}`
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.answered)).toBe(true)
  })

  it('still serves the interview while the run sits at defense_complete', async () => {
    // `DEFENSE_STATES` includes `defense_complete` so a student who finishes and refreshes sees what
    // they gave rather than a 409 (10 §9). Since Step 10.4 the scoring job runs inside
    // `completeDefense` and the run is usually `scored` a moment later, so reaching that state on
    // purpose means giving the pipeline something it cannot finish: `MOCK_FAIL_READS` holds the run
    // (FR-140, D-401), which leaves it exactly where this rule is about.
    const runId = await runInDefense()
    await defense.openDefense(fx.student, runId)
    await answerEverything(runId, 'From the cohort table of 15 July 2026.')

    process.env.MOCK_FAIL_READS = 'true'
    try {
      await defense.completeDefense(fx.student, runId)
    } finally {
      delete process.env.MOCK_FAIL_READS
    }

    const row = await runRow(runId)
    expect([row.state, row.scoring_status]).toEqual(['defense_complete', 'held'])

    const after = await defense.openDefense(fx.student, runId)
    expect(after.questions.every((question) => question.answered)).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// The addendum's far edge (FR-107, D-363)
// ---------------------------------------------------------------------------------------------

describe('the addendum closes when the defense opens', () => {
  const NOTE = 'On reflection the payback figure should have been traced before the spend moved.'

  it('is open through the lock and the whole Turn window', async () => {
    const runId = await runInWorking(fx)
    await runs.lockDecision(fx.student, runId, BRIEF)
    // `decision_locked`: the pressure FR-107 exists for, and where the control is on UI-024.
    expect((await runRow(runId)).state).toBe('decision_locked')
    expect((await runs.getDecision(fx.student, runId)).canAddAddendum).toBe(true)

    // And still open inside the window, which is where a student is when the news lands on the
    // decision they just filed.
    await advance(runId, TURN_DELAY_MS + 2_000)
    expect((await runRow(runId)).state).toBe('turn_open')
    expect((await runs.getDecision(fx.student, runId)).canAddAddendum).toBe(true)

    await runs.addAddendum(fx.student, runId, { text: NOTE })
    expect((await eventsOfType(runId, 'addendum'))[0]?.payload).toEqual({ text: NOTE })
  })

  it('is refused once the Turn is over, in `defense_pending`', async () => {
    // The questions are drawn from the run and say what is being probed, so fifty words written
    // after reading them are not the artifact FR-107 offers.
    const runId = await runInDefense()
    expect((await runRow(runId)).state).toBe('defense_pending')

    expect(await codeOf(runs.addAddendum(fx.student, runId, { text: NOTE }))).toBe(
      'ILLEGAL_TRANSITION',
    )
    expect(await detailsOf(runs.addAddendum(fx.student, runId, { text: NOTE }))).toEqual({
      state: 'defense_pending',
    })
    expect((await runs.getDecision(fx.student, runId)).canAddAddendum).toBe(false)
    expect(await eventsOfType(runId, 'addendum')).toEqual([])
  })

  it('is refused after the window expired into the implicit hold (FR-113)', async () => {
    // The other route out of `turn_open` stamps the same column, so the rule needs no second clause.
    const runId = await runInWorking(fx)
    await runs.lockDecision(fx.student, runId, BRIEF)
    await advance(runId, TURN_DELAY_MS + 2_000)
    await advance(runId, runs.TURN_WINDOW_MS + 5_000)
    expect((await runRow(runId)).state).toBe('defense_pending')

    expect(await codeOf(runs.addAddendum(fx.student, runId, { text: NOTE }))).toBe(
      'ILLEGAL_TRANSITION',
    )
  })

  it('cannot land on a record already handed to scoring', async () => {
    // The demonstrated race: `completeDefense` enqueues `score_run`, and an addendum written a
    // moment later was a new `run_addenda` row in the record the in-flight job was reading. Since
    // Step 10.4 the job has a handler and the drain runs it in the same call, so the run has been
    // read and scored by the time the addendum is attempted — which is the same rule one step
    // further on, and the refusal is what keeps the record the bands were drafted from intact.
    const runId = await runInDefense()
    await answerEverything(runId, '')
    await defense.completeDefense(fx.student, runId)
    const row = await runRow(runId)
    expect([row.state, row.scoring_status]).toEqual(['scored', 'done'])

    expect(await codeOf(runs.addAddendum(fx.student, runId, { text: NOTE }))).toBe(
      'ILLEGAL_TRANSITION',
    )
    expect(await eventsOfType(runId, 'addendum')).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// The invariant (CLAUDE.md, 12 §8): the interview says nothing about the answer key
// ---------------------------------------------------------------------------------------------

describe('what a question may not be a function of', () => {
  it('asks the same questions, in the same words, on both variants', async () => {
    const f = (await import('@tests/factories')) as Factories
    const [sound] = await testSql<{ id: string }[]>`
      select id from scenario_variants
       where package_version_id = ${fx.versionId} and key = 'sound'`
    if (!sound) throw new Error('the fixture package has no sound variant')

    const soundAssignment = await f.createAssignment(
      fx.orgId,
      fx.assignment.sectionId,
      'defense-flow-sound',
      { packageVersionId: fx.versionId, variantId: sound.id, label: 'Decision Run (sound)' },
    )

    const defective = await runInDefense()
    const soundRun = await runInDefense(soundAssignment.id)

    const onDefective = await defense.openDefense(fx.student, defective)
    const onSound = await defense.openDefense(fx.student, soundRun)

    const shape = (view: Awaited<ReturnType<Defense['openDefense']>>) =>
      view.questions.map((question) => [question.seq, question.kind, question.text])

    expect(shape(onSound)).toEqual(shape(onDefective))
  })

  it('carries no forbidden key, over a payload with something in every field', async () => {
    const runId = await runInDefense()
    const view = await defense.openDefense(fx.student, runId)

    // The negative control: an empty finding list must be a statement about a payload, not about
    // three nulls. Phase 8 shipped a sweep that passed because its fixture had never saved a brief.
    expect(view.questions.length).toBeGreaterThanOrEqual(6)
    expect(view.artifacts.brief?.recommendation.length).toBeGreaterThan(0)
    expect(view.artifacts.frame?.decision.length).toBeGreaterThan(0)
    expect(view.artifacts.turnResponse?.justification?.length).toBeGreaterThan(0)

    expect(findForbiddenKeys(view, { scored: false })).toEqual([])

    // And not as a value under another name: the bank's own machinery is nowhere in it.
    const serialized = JSON.stringify(view)
    for (const question of FIXTURE.defenseQuestions) {
      if (question.expectedAnswerNotes.length > 0) {
        expect(serialized).not.toContain(question.expectedAnswerNotes)
      }
    }
  })
})
