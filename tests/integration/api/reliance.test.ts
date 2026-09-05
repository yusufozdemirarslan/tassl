// Step 8.1 — the three claim endpoints of docs/tech/07-api-spec.md §7 this step owns, driven as
// Next drives them: a real `Request` through the handler `src/app/api/v1/**/route.ts` exports, with
// the session cookie `asUser()` mints and the `X-Requested-With: tassl` header every cookie-
// authenticated mutation carries (08 §2.7).
//
//   PUT  /runs/{runId}/claims/{claimId}/stance       the student's position on a claim
//   POST /runs/{runId}/claims/{claimId}/actions      one interrogation action, charged to the clock
//   POST /runs/{runId}/claims/{claimId}/escalation   the colleague's authored reply
//
// Each row gets an allow case and a deny case (08 §4: "✓* own run" for the student, "—" for
// everybody else, including the instructor and TA who may replay the run once it is scored), plus
// the two things only the wire can show: the error envelope a refusal carries, and the exact shape
// of a body — which is where D-116's two withheld fields would leak if they were going to.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, truncateAll } from '@tests/setup/integration'
import {
  openDocument,
  runInWorking,
  setupAssistantFixture,
  type AssistantFixture,
} from '../reliance/fixture'

type StanceRoute = typeof import('@/app/api/v1/runs/[runId]/claims/[claimId]/stance/route')
type ActionsRoute = typeof import('@/app/api/v1/runs/[runId]/claims/[claimId]/actions/route')
type EscalationRoute = typeof import('@/app/api/v1/runs/[runId]/claims/[claimId]/escalation/route')
type ClaimsRoute = typeof import('@/app/api/v1/runs/[runId]/claims/route')

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

let stance: StanceRoute
let actions: ActionsRoute
let escalation: EscalationRoute
let claims: ClaimsRoute
let fx: AssistantFixture
let runId: string

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

const errorCode = (called: Called): unknown =>
  ((called.body as { error?: { code?: unknown } } | null)?.error ?? {}).code

const sessionFor = (who: 'student' | 'instructor' | 'ta' | 'classmate'): Promise<Headers> =>
  asUser(fx[who].id, { activeOrganizationId: fx.orgId })

/** The four seats 08 §4 refuses this run's claim endpoints to, and the status each is owed. */
const DENIED = ['instructor', 'ta', 'classmate'] as const

beforeEach(async () => {
  await truncateAll()
  stance = await import('@/app/api/v1/runs/[runId]/claims/[claimId]/stance/route')
  actions = await import('@/app/api/v1/runs/[runId]/claims/[claimId]/actions/route')
  escalation = await import('@/app/api/v1/runs/[runId]/claims/[claimId]/escalation/route')
  claims = await import('@/app/api/v1/runs/[runId]/claims/route')
  fx = await setupAssistantFixture('api-reliance')
  runId = await runInWorking(fx)
  await openDocument(fx, runId, 'D5') // C1: a Source Trace and a Decomposition Check
  await openDocument(fx, runId, 'D8') // C7: the claim with an authored escalation reply
})

afterAll(async () => {
  await truncateAll()
})

describe('PUT /runs/{runId}/claims/{claimId}/stance', () => {
  it('answers the owner with the claim as it now stands', async () => {
    const claimId = fx.claimId('C1')
    const called = await call(stance.PUT, {
      method: 'PUT',
      path: `/runs/${runId}/claims/${claimId}/stance`,
      session: await sessionFor('student'),
      params: { runId, claimId },
      body: { stance: 'challenge' },
    })

    expect(called.status).toBe(200)
    expect(called.body).toMatchObject({ id: claimId, stance: 'challenge', previousStance: null })
  })

  it('refuses everyone but the run’s own student with 404', async () => {
    const claimId = fx.claimId('C1')
    for (const seat of DENIED) {
      const called = await call(stance.PUT, {
        method: 'PUT',
        path: `/runs/${runId}/claims/${claimId}/stance`,
        session: await sessionFor(seat),
        params: { runId, claimId },
        body: { stance: 'accept' },
      })
      expect([seat, called.status]).toEqual([seat, 404])
    }
  })

  it('refuses an anonymous request with 401', async () => {
    const claimId = fx.claimId('C1')
    const called = await call(stance.PUT, {
      method: 'PUT',
      path: `/runs/${runId}/claims/${claimId}/stance`,
      session: null,
      params: { runId, claimId },
      body: { stance: 'accept' },
    })
    expect(called.status).toBe(401)
  })

  it('answers a stance that is not one of the five with a validation envelope', async () => {
    const claimId = fx.claimId('C1')
    const called = await call(stance.PUT, {
      method: 'PUT',
      path: `/runs/${runId}/claims/${claimId}/stance`,
      session: await sessionFor('student'),
      params: { runId, claimId },
      body: { stance: 'agree' },
    })
    expect(called.status).toBe(400)
    expect(errorCode(called)).toBe('VALIDATION_ERROR')
  })

  it('carries the refusal in the envelope 10 §1 defines', async () => {
    // C6 is a real claim of this package that this run has never surfaced.
    const claimId = fx.claimId('C6')
    const called = await call(stance.PUT, {
      method: 'PUT',
      path: `/runs/${runId}/claims/${claimId}/stance`,
      session: await sessionFor('student'),
      params: { runId, claimId },
      body: { stance: 'accept' },
    })
    expect(called.status).toBe(409)
    expect(errorCode(called)).toBe('CLAIM_NOT_SURFACED')
    expect((called.body as { error: { requestId: string } }).error.requestId).toBeTruthy()
  })
})

describe('POST /runs/{runId}/claims/{claimId}/actions', () => {
  it('answers the owner with the action, its cost and the authored result', async () => {
    const claimId = fx.claimId('C1')
    const called = await call(actions.POST, {
      method: 'POST',
      path: `/runs/${runId}/claims/${claimId}/actions`,
      session: await sessionFor('student'),
      params: { runId, claimId },
      body: { type: 'source_trace' },
    })

    expect(called.status).toBe(200)
    expect(Object.keys(called.body as object).sort()).toEqual([
      'actionId',
      'clockCostMs',
      'inTurnWindow',
      'result',
      'type',
    ])
    expect(called.body).toMatchObject({ type: 'source_trace', clockCostMs: 60_000 })
  })

  it('refuses an action the claim does not offer with 409', async () => {
    const claimId = fx.claimId('C1')
    const called = await call(actions.POST, {
      method: 'POST',
      path: `/runs/${runId}/claims/${claimId}/actions`,
      session: await sessionFor('student'),
      params: { runId, claimId },
      body: { type: 'replication_check' },
    })
    expect(called.status).toBe(409)
    expect(errorCode(called)).toBe('ACTION_NOT_AVAILABLE')
  })

  it('refuses everyone but the run’s own student with 404', async () => {
    const claimId = fx.claimId('C1')
    for (const seat of DENIED) {
      const called = await call(actions.POST, {
        method: 'POST',
        path: `/runs/${runId}/claims/${claimId}/actions`,
        session: await sessionFor(seat),
        params: { runId, claimId },
        body: { type: 'source_trace' },
      })
      expect([seat, called.status]).toEqual([seat, 404])
    }
  })
})

describe('POST /runs/{runId}/claims/{claimId}/escalation', () => {
  it('answers the owner with the reply, the cost and the escalations left — and nothing else', async () => {
    const claimId = fx.claimId('C7')
    const called = await call(escalation.POST, {
      method: 'POST',
      path: `/runs/${runId}/claims/${claimId}/escalation`,
      session: await sessionFor('student'),
      params: { runId, claimId },
      body: { statement: 'I cannot tell whether this survey covers the tier subgroups.' },
    })

    expect(called.status).toBe(200)
    // D-116 on the wire: three keys, and neither `responseId` nor `countsAgainstLimit`.
    expect(Object.keys(called.body as object).sort()).toEqual([
      'clockCostMs',
      'remainingEscalations',
      'responseText',
    ])
    expect(called.body).toMatchObject({ clockCostMs: 300_000, remainingEscalations: 1 })
  })

  it('refuses a statement that is not one sentence, with this module’s own code', async () => {
    const claimId = fx.claimId('C7')
    const called = await call(escalation.POST, {
      method: 'POST',
      path: `/runs/${runId}/claims/${claimId}/escalation`,
      session: await sessionFor('student'),
      params: { runId, claimId },
      body: { statement: 'Not sure' },
    })
    expect(called.status).toBe(400)
    expect(errorCode(called)).toBe('ESCALATION_STATEMENT_INVALID')
  })

  it('refuses everyone but the run’s own student with 404', async () => {
    const claimId = fx.claimId('C7')
    for (const seat of DENIED) {
      const called = await call(escalation.POST, {
        method: 'POST',
        path: `/runs/${runId}/claims/${claimId}/escalation`,
        session: await sessionFor(seat),
        params: { runId, claimId },
        body: { statement: 'I cannot evaluate this from here.' },
      })
      expect([seat, called.status]).toEqual([seat, 404])
    }
  })
})

describe('GET /runs/{runId}/claims after the three acts', () => {
  it('shows the stance, the action and the escalation the endpoints wrote', async () => {
    const traced = fx.claimId('C1')
    const escalated = fx.claimId('C7')
    const session = await sessionFor('student')

    await call(actions.POST, {
      method: 'POST',
      path: `/runs/${runId}/claims/${traced}/actions`,
      session,
      params: { runId, claimId: traced },
      body: { type: 'source_trace' },
    })
    await call(stance.PUT, {
      method: 'PUT',
      path: `/runs/${runId}/claims/${traced}/stance`,
      session,
      params: { runId, claimId: traced },
      body: { stance: 'accept' },
    })
    await call(escalation.POST, {
      method: 'POST',
      path: `/runs/${runId}/claims/${escalated}/escalation`,
      session,
      params: { runId, claimId: escalated },
      body: { statement: 'I cannot tell whether this survey covers the tier subgroups.' },
    })

    const called = await call(claims.GET, {
      path: `/runs/${runId}/claims`,
      session,
      params: { runId },
    })
    expect(called.status).toBe(200)

    const list = called.body as {
      key: string
      stance: string | null
      actions: unknown[]
      availableActions: string[]
      escalation: { responseText: string } | null
      canEscalate: boolean
      remainingEscalations: number
    }[]
    const byKey = new Map(list.map((claim) => [claim.key, claim]))
    expect(byKey.get('C1')).toMatchObject({ stance: 'accept', canEscalate: true })
    expect(byKey.get('C1')?.actions).toHaveLength(1)
    expect(byKey.get('C1')?.availableActions).toEqual(['source_trace', 'decomposition_check'])
    expect(byKey.get('C7')?.stance).toBe('escalate')
    expect(byKey.get('C7')?.escalation?.responseText.length).toBeGreaterThan(0)
    expect(byKey.get('C7')?.remainingEscalations).toBe(1)
  })
})
