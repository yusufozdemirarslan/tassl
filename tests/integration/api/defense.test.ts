// Step 9.2 — the three endpoints of docs/tech/07-api-spec.md §7 this step owns, driven as Next
// drives them: a real `Request` through the handler `src/app/api/v1/**/route.ts` exports, with the
// session cookie `asUser()` mints and the `X-Requested-With: tassl` header every cookie-authenticated
// mutation carries (08 §2.7).
//
//   GET  /runs/{runId}/defense                                   open or resume (FR-120, FR-126)
//   POST /runs/{runId}/defense/questions/{runQuestionId}/answer  one answer (FR-124)
//   POST /runs/{runId}/defense/complete                          finish and queue scoring (D-046)
//
// All three are the student's own run and nobody else's (08 §4: "✓* own run" for the student, "—"
// for every other seat, the instructor and the TA included). What only the wire can show is asserted
// here rather than in the service suite: the status codes, and the envelope a refusal carries —
// `details.state` on `DEFENSE_NOT_OPEN` so a stale screen can follow `links.next`, and
// `details.unanswered` on `DEFENSE_INCOMPLETE` so UI-026's confirm dialog can name a number.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, truncateAll } from '@tests/setup/integration'
import {
  FIXTURE,
  runInWorking,
  setupAssistantFixture,
  type AssistantFixture,
} from '../reliance/fixture'
import { stopBoss } from '@/server/jobs/boss'

type DefenseRoute = typeof import('@/app/api/v1/runs/[runId]/defense/route')
type AnswerRoute =
  typeof import('@/app/api/v1/runs/[runId]/defense/questions/[runQuestionId]/answer/route')
type CompleteRoute = typeof import('@/app/api/v1/runs/[runId]/defense/complete/route')
type AdvanceClockRoute = typeof import('@/app/api/v1/test/runs/[runId]/advance-clock/route')

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

let defenseRoute: DefenseRoute
let answerRoute: AnswerRoute
let completeRoute: CompleteRoute
let advanceClock: AdvanceClockRoute
let fx: AssistantFixture

type Called = { status: number; body: unknown }

async function call(
  handler: RouteHandler,
  options: {
    method?: string
    path: string
    session?: Headers | null
    params?: Record<string, string>
    body?: unknown
  },
): Promise<Called> {
  const method = options.method ?? 'GET'
  const headers = new Headers(options.session ?? undefined)
  if (method !== 'GET') {
    headers.set('x-requested-with', 'tassl')
    headers.set('content-type', 'application/json')
  }
  const response = await handler(
    new Request(`http://localhost:3000/api/v1${options.path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    { params: Promise.resolve(options.params ?? {}) },
  )
  const text = await response.text()
  return { status: response.status, body: text === '' ? null : JSON.parse(text) }
}

const errorOf = (called: Called) =>
  ((called.body as { error?: { code?: unknown; details?: unknown } } | null)?.error ?? {}) as {
    code?: unknown
    details?: unknown
  }

const sessionFor = (who: 'student' | 'instructor' | 'ta' | 'classmate'): Promise<Headers> =>
  asUser(fx[who].id, { activeOrganizationId: fx.orgId })

/** The three seats 08 §4 refuses this run's own endpoints to. */
const DENIED = ['instructor', 'ta', 'classmate'] as const

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
  namedValues: { budget_share_to_premium: 35, premium_payback_months: 19 },
}

const RESPONSE = {
  response: 'revise' as const,
  justification:
    'The retention we priced on was one cohort under the old pricing, so the share sized on that payback comes down.',
  confidence: 55,
}

/** An answer that names a document and a number, so no follow-up is drawn (D-031). */
const SOURCED = {
  text: 'From the quarterly acquisition cohort table, dated 15 July 2026.',
  durationMs: 21_000,
}

/** A run in `defense_pending`, reached the way the product reaches it. */
async function runInDefense(): Promise<string> {
  const runs = await import('@/server/modules/runs')
  const reliance = await import('@/server/modules/reliance')
  const runId = await runInWorking(fx)
  await runs.lockDecision(fx.student, runId, BRIEF)

  const headers = await sessionFor('student')
  headers.set('x-requested-with', 'tassl')
  headers.set('content-type', 'application/json')
  await advanceClock.POST(
    new Request(`http://localhost:3000/api/v1/test/runs/${runId}/advance-clock`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ms: FIXTURE.version.turnDelaySeconds * 1000 + 2_000 }),
    }),
    { params: Promise.resolve({ runId }) },
  )
  for (const key of ['C2', 'C3'] as const) {
    await reliance.setStance(fx.student, runId, fx.claimId(key), 'verify')
  }
  await runs.respondToTurn(fx.student, runId, RESPONSE)
  return runId
}

type QuestionRow = { runQuestionId: string; answered: boolean; seq: number }

async function openAsStudent(runId: string): Promise<QuestionRow[]> {
  const called = await call(defenseRoute.GET, {
    path: `/runs/${runId}/defense`,
    session: await sessionFor('student'),
    params: { runId },
  })
  if (called.status !== 200) throw new Error(`open answered ${called.status}`)
  return (called.body as { questions: QuestionRow[] }).questions
}

/** Answers every unanswered question through the endpoint, follow-ups included. */
async function answerEverything(runId: string): Promise<void> {
  for (let round = 0; round < 40; round += 1) {
    const questions = await openAsStudent(runId)
    const next = questions.find((question) => !question.answered)
    if (!next) return
    const called = await call(answerRoute.POST, {
      method: 'POST',
      path: `/runs/${runId}/defense/questions/${next.runQuestionId}/answer`,
      session: await sessionFor('student'),
      params: { runId, runQuestionId: next.runQuestionId },
      body: SOURCED,
    })
    if (called.status !== 200) throw new Error(`answer ${next.seq} answered ${called.status}`)
  }
  throw new Error('the defense never ran out of questions')
}

beforeEach(async () => {
  await truncateAll()
  defenseRoute = await import('@/app/api/v1/runs/[runId]/defense/route')
  answerRoute =
    await import('@/app/api/v1/runs/[runId]/defense/questions/[runQuestionId]/answer/route')
  completeRoute = await import('@/app/api/v1/runs/[runId]/defense/complete/route')
  advanceClock = await import('@/app/api/v1/test/runs/[runId]/advance-clock/route')
  fx = await setupAssistantFixture('api-defense')
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

describe('GET /runs/{runId}/defense', () => {
  it('answers the owner the interview and the frozen record', async () => {
    const runId = await runInDefense()
    const called = await call(defenseRoute.GET, {
      path: `/runs/${runId}/defense`,
      session: await sessionFor('student'),
      params: { runId },
    })

    expect(called.status).toBe(200)
    const body = called.body as {
      questions: QuestionRow[]
      artifacts: Record<string, unknown>
    }
    expect(body.questions.length).toBeGreaterThanOrEqual(6)
    expect(body.questions.length).toBeLessThanOrEqual(9)
    expect(body.artifacts).toMatchObject({
      brief: { recommendation: BRIEF.recommendation },
      turnResponse: { response: 'revise', implicit: false },
    })
  })

  it('refuses a run that is not in the defense, naming the state', async () => {
    const runId = await runInWorking(fx)
    const called = await call(defenseRoute.GET, {
      path: `/runs/${runId}/defense`,
      session: await sessionFor('student'),
      params: { runId },
    })
    expect(called.status).toBe(409)
    expect(errorOf(called).code).toBe('DEFENSE_NOT_OPEN')
    expect(errorOf(called).details).toEqual({ state: 'working' })
  })

  it('refuses everyone but the run’s own student with 404', async () => {
    const runId = await runInDefense()
    for (const seat of DENIED) {
      const called = await call(defenseRoute.GET, {
        path: `/runs/${runId}/defense`,
        session: await sessionFor(seat),
        params: { runId },
      })
      expect([seat, called.status]).toEqual([seat, 404])
    }
  })

  it('refuses an anonymous request with 401', async () => {
    const runId = await runInDefense()
    const called = await call(defenseRoute.GET, {
      path: `/runs/${runId}/defense`,
      session: null,
      params: { runId },
    })
    expect(called.status).toBe(401)
  })
})

describe('POST /runs/{runId}/defense/questions/{runQuestionId}/answer', () => {
  it('answers the next question and the follow-up the answer earned', async () => {
    const runId = await runInDefense()
    const questions = await openAsStudent(runId)
    const [first, second] = questions
    if (!first || !second) throw new Error('expected two questions')

    const called = await call(answerRoute.POST, {
      method: 'POST',
      path: `/runs/${runId}/defense/questions/${first.runQuestionId}/answer`,
      session: await sessionFor('student'),
      params: { runId, runQuestionId: first.runQuestionId },
      body: { text: 'The assistant said so.', durationMs: 8_000 },
    })

    expect(called.status).toBe(200)
    expect(called.body).toMatchObject({
      next: { runQuestionId: second.runQuestionId },
      followUpQuestion: { followUpOf: first.runQuestionId, answered: false },
    })
  })

  it('refuses a second answer with 409', async () => {
    const runId = await runInDefense()
    const [first] = await openAsStudent(runId)
    if (!first) throw new Error('expected a question')

    const session = await sessionFor('student')
    const send = () =>
      call(answerRoute.POST, {
        method: 'POST',
        path: `/runs/${runId}/defense/questions/${first.runQuestionId}/answer`,
        session,
        params: { runId, runQuestionId: first.runQuestionId },
        body: SOURCED,
      })
    expect((await send()).status).toBe(200)
    const again = await send()
    expect(again.status).toBe(409)
    expect(errorOf(again).code).toBe('QUESTION_ALREADY_ANSWERED')
  })

  it('refuses a body that is not an answer at the wire', async () => {
    const runId = await runInDefense()
    const [first] = await openAsStudent(runId)
    if (!first) throw new Error('expected a question')

    const called = await call(answerRoute.POST, {
      method: 'POST',
      path: `/runs/${runId}/defense/questions/${first.runQuestionId}/answer`,
      session: await sessionFor('student'),
      params: { runId, runQuestionId: first.runQuestionId },
      body: { text: 'ok' },
    })
    expect(called.status).toBe(400)
    expect(errorOf(called).code).toBe('VALIDATION_ERROR')
  })

  it('refuses everyone but the run’s own student with 404', async () => {
    const runId = await runInDefense()
    const [first] = await openAsStudent(runId)
    if (!first) throw new Error('expected a question')

    for (const seat of DENIED) {
      const called = await call(answerRoute.POST, {
        method: 'POST',
        path: `/runs/${runId}/defense/questions/${first.runQuestionId}/answer`,
        session: await sessionFor(seat),
        params: { runId, runQuestionId: first.runQuestionId },
        body: SOURCED,
      })
      expect([seat, called.status]).toEqual([seat, 404])
    }
  })

  it('refuses a cookie request with no `X-Requested-With` header (08 §2.7)', async () => {
    const runId = await runInDefense()
    const [first] = await openAsStudent(runId)
    if (!first) throw new Error('expected a question')

    const headers = await sessionFor('student')
    headers.set('content-type', 'application/json')
    const response = await answerRoute.POST(
      new Request(
        `http://localhost:3000/api/v1/runs/${runId}/defense/questions/${first.runQuestionId}/answer`,
        { method: 'POST', headers, body: JSON.stringify(SOURCED) },
      ),
      { params: Promise.resolve({ runId, runQuestionId: first.runQuestionId }) },
    )
    expect(response.status).toBe(403)
  })
})

describe('POST /runs/{runId}/defense/complete', () => {
  const complete = async (runId: string, seat: 'student' | 'instructor' | 'ta' | 'classmate') =>
    call(completeRoute.POST, {
      method: 'POST',
      path: `/runs/${runId}/defense/complete`,
      session: await sessionFor(seat),
      params: { runId },
    })

  it('answers the run, queued for scoring', async () => {
    const runId = await runInDefense()
    await openAsStudent(runId)
    await answerEverything(runId)

    const called = await complete(runId, 'student')
    expect(called.status).toBe(200)
    expect(called.body).toMatchObject({
      state: 'defense_complete',
      scoringStatus: 'queued',
      links: { next: `/runs/${runId}` },
    })
  })

  it('carries the unanswered count in `details.unanswered`', async () => {
    const runId = await runInDefense()
    const questions = await openAsStudent(runId)

    const called = await complete(runId, 'student')
    expect(called.status).toBe(409)
    expect(errorOf(called).code).toBe('DEFENSE_INCOMPLETE')
    expect(errorOf(called).details).toEqual({ unanswered: questions.length })
  })

  it('refuses everyone but the run’s own student with 404', async () => {
    const runId = await runInDefense()
    await openAsStudent(runId)
    for (const seat of DENIED) {
      const called = await complete(runId, seat)
      expect([seat, called.status]).toEqual([seat, 404])
    }
  })

  it('refuses an anonymous request with 401', async () => {
    const runId = await runInDefense()
    const called = await call(completeRoute.POST, {
      method: 'POST',
      path: `/runs/${runId}/defense/complete`,
      session: null,
      params: { runId },
    })
    expect(called.status).toBe(401)
  })
})
