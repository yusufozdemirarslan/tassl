// Step 9.1 — the two endpoints of docs/tech/07-api-spec.md §7 this step owns, driven as Next drives
// them: a real `Request` through the handler `src/app/api/v1/**/route.ts` exports, with the session
// cookie `asUser()` mints and the `X-Requested-With: tassl` header every cookie-authenticated
// mutation carries (08 §2.7).
//
//   GET  /runs/{runId}/turn            the Turn, its window, and the frozen pre-Turn record
//   POST /runs/{runId}/turn/response   hold, revise, or reverse (FR-112)
//
// Both are the student's own run and nobody else's (08 §4: "✓* own run" for the student, "—" for
// every other seat, the instructor and the TA included). What only the wire can show is asserted
// here rather than in the service suite: the status codes, and the envelope a refusal carries —
// `details.state` on `TURN_NOT_OPEN`, so a stale screen can follow `links.next`, and
// `details.claimIds` on `TURN_CLAIMS_UNSTANCED`, so UI-025 can mark the cards still waiting.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, truncateAll } from '@tests/setup/integration'
import {
  FIXTURE,
  runInWorking,
  setupAssistantFixture,
  type AssistantFixture,
} from '../reliance/fixture'

type TurnRoute = typeof import('@/app/api/v1/runs/[runId]/turn/route')
type TurnResponseRoute = typeof import('@/app/api/v1/runs/[runId]/turn/response/route')
type AdvanceClockRoute = typeof import('@/app/api/v1/test/runs/[runId]/advance-clock/route')

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

let turn: TurnRoute
let turnResponse: TurnResponseRoute
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
  namedValues: {} as Record<string, number>,
}

const RESPONSE = {
  response: 'revise',
  justification:
    'The retention we priced on was one cohort under the old pricing, so the share sized on that payback comes down.',
  confidence: 55,
}

/** A run in the Turn window: decision filed, and the clock moved past `turn_due_at` (D-109). */
async function runInTurnWindow(): Promise<string> {
  const runs = await import('@/server/modules/runs')
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
  return runId
}

/** Takes a position on the two claims the Turn raises, which is what FR-111 asks for. */
async function stanceTheWindow(runId: string): Promise<void> {
  const reliance = await import('@/server/modules/reliance')
  for (const key of ['C2', 'C3'] as const) {
    await reliance.setStance(fx.student, runId, fx.claimId(key), 'verify')
  }
}

beforeEach(async () => {
  await truncateAll()
  turn = await import('@/app/api/v1/runs/[runId]/turn/route')
  turnResponse = await import('@/app/api/v1/runs/[runId]/turn/response/route')
  advanceClock = await import('@/app/api/v1/test/runs/[runId]/advance-clock/route')
  fx = await setupAssistantFixture('api-turn')
})

afterAll(async () => {
  await truncateAll()
})

describe('GET /runs/{runId}/turn', () => {
  it('answers the owner the Turn, its window and the frozen record', async () => {
    const runId = await runInTurnWindow()
    const called = await call(turn.GET, {
      path: `/runs/${runId}/turn`,
      session: await sessionFor('student'),
      params: { runId },
    })

    expect(called.status).toBe(200)
    expect(called.body).toMatchObject({
      text: FIXTURE.turn.text,
      voice: 'stakeholder_message',
      frozen: {
        brief: { recommendation: BRIEF.recommendation },
      },
      run: { state: 'turn_open' },
    })
  })

  it('refuses a run whose Turn has not fallen due, naming the state', async () => {
    const runs = await import('@/server/modules/runs')
    const runId = await runInWorking(fx)
    await runs.lockDecision(fx.student, runId, BRIEF)

    const called = await call(turn.GET, {
      path: `/runs/${runId}/turn`,
      session: await sessionFor('student'),
      params: { runId },
    })
    expect(called.status).toBe(409)
    expect(errorOf(called).code).toBe('TURN_NOT_OPEN')
    expect(errorOf(called).details).toEqual({ state: 'decision_locked' })
  })

  it('refuses everyone but the run’s own student with 404', async () => {
    const runId = await runInTurnWindow()
    for (const seat of DENIED) {
      const called = await call(turn.GET, {
        path: `/runs/${runId}/turn`,
        session: await sessionFor(seat),
        params: { runId },
      })
      expect([seat, called.status]).toEqual([seat, 404])
    }
  })

  it('refuses an anonymous request with 401', async () => {
    const runId = await runInTurnWindow()
    const called = await call(turn.GET, {
      path: `/runs/${runId}/turn`,
      session: null,
      params: { runId },
    })
    expect(called.status).toBe(401)
  })
})

describe('POST /runs/{runId}/turn/response', () => {
  it('answers the owner the run, now on its way to the defense', async () => {
    const runId = await runInTurnWindow()
    await stanceTheWindow(runId)

    const called = await call(turnResponse.POST, {
      method: 'POST',
      path: `/runs/${runId}/turn/response`,
      session: await sessionFor('student'),
      params: { runId },
      body: RESPONSE,
    })
    expect(called.status).toBe(200)
    expect(called.body).toMatchObject({
      state: 'defense_pending',
      links: { next: `/runs/${runId}/defense` },
    })
  })

  it('carries the unstanced claims in `details.claimIds` (FR-111)', async () => {
    const runId = await runInTurnWindow()
    const called = await call(turnResponse.POST, {
      method: 'POST',
      path: `/runs/${runId}/turn/response`,
      session: await sessionFor('student'),
      params: { runId },
      body: RESPONSE,
    })

    expect(called.status).toBe(409)
    expect(errorOf(called).code).toBe('TURN_CLAIMS_UNSTANCED')
    expect(errorOf(called).details).toEqual({
      claimIds: [fx.claimId('C2'), fx.claimId('C3')],
    })
  })

  it('refuses a justification over 150 words, naming the field', async () => {
    const runId = await runInTurnWindow()
    const called = await call(turnResponse.POST, {
      method: 'POST',
      path: `/runs/${runId}/turn/response`,
      session: await sessionFor('student'),
      params: { runId },
      body: {
        ...RESPONSE,
        justification: Array.from({ length: 151 }, (_, i) => `word${i}`).join(' '),
      },
    })
    expect(called.status).toBe(400)
    expect(errorOf(called).code).toBe('VALIDATION_ERROR')
    expect(errorOf(called).details).toEqual({ field: 'justification', reason: 'word_limit' })
  })

  it('refuses a category that is not one of the three at the wire', async () => {
    const runId = await runInTurnWindow()
    const called = await call(turnResponse.POST, {
      method: 'POST',
      path: `/runs/${runId}/turn/response`,
      session: await sessionFor('student'),
      params: { runId },
      body: { ...RESPONSE, response: 'ignore' },
    })
    expect(called.status).toBe(400)
    expect(errorOf(called).code).toBe('VALIDATION_ERROR')
  })

  it('refuses everyone but the run’s own student with 404', async () => {
    const runId = await runInTurnWindow()
    await stanceTheWindow(runId)
    for (const seat of DENIED) {
      const called = await call(turnResponse.POST, {
        method: 'POST',
        path: `/runs/${runId}/turn/response`,
        session: await sessionFor(seat),
        params: { runId },
        body: RESPONSE,
      })
      expect([seat, called.status]).toEqual([seat, 404])
    }
  })

  it('refuses an anonymous request with 401', async () => {
    const runId = await runInTurnWindow()
    const called = await call(turnResponse.POST, {
      method: 'POST',
      path: `/runs/${runId}/turn/response`,
      session: null,
      params: { runId },
      body: RESPONSE,
    })
    expect(called.status).toBe(401)
  })
})
