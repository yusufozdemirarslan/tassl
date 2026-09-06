// Step 7.3 — the five endpoints of docs/tech/07-api-spec.md §7 this step owns, driven as Next
// drives them: a real `Request` through the handler `src/app/api/v1/**/route.ts` exports, with the
// session cookie `asUser()` mints and the `X-Requested-With: tassl` header every cookie-
// authenticated mutation carries (08 §2.7).
//
//   GET   /runs/{runId}/delegations            the Delegation Log, for the owner and the reviewers
//   POST  /runs/{runId}/delegations            the stream (its shape is asserted in assistant/delegate)
//   PATCH /runs/{runId}/delegations/{id}       the why line and the used marks
//   POST  /runs/{runId}/outside-tool-declaration   204, and nothing else happens
//   GET   /runs/{runId}/claims                 the student's claim list
//   POST  /runs/{runId}/resume                 off Paused, with the clock credited
//
// Each row gets an allow case and a deny case, plus the two things only the wire can show: the 204
// with no body, and the error envelope a refusal carries.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, truncateAll } from '@tests/setup/integration'
import {
  armForcedFailure,
  codeOf,
  runInWorking,
  setupAssistantFixture,
  type AssistantFixture,
} from '../assistant/fixture'

type DelegationsRoute = typeof import('@/app/api/v1/runs/[runId]/delegations/route')
type DelegationRoute = typeof import('@/app/api/v1/runs/[runId]/delegations/[delegationId]/route')
type DeclarationRoute = typeof import('@/app/api/v1/runs/[runId]/outside-tool-declaration/route')
type ClaimsRoute = typeof import('@/app/api/v1/runs/[runId]/claims/route')
type ResumeRoute = typeof import('@/app/api/v1/runs/[runId]/resume/route')
type Assistant = typeof import('@/server/modules/assistant')

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

let delegations: DelegationsRoute
let delegation: DelegationRoute
let declaration: DeclarationRoute
let claims: ClaimsRoute
let resume: ResumeRoute
let assistant: Assistant
let fx: AssistantFixture

type Called = { status: number; body: unknown; headers: Headers }

async function call(
  handler: RouteHandler,
  options: {
    method?: string
    path: string
    session?: Headers | null
    params?: Record<string, string>
    body?: unknown
    headers?: Record<string, string>
  },
): Promise<Called> {
  const method = options.method ?? 'GET'
  const headers = new Headers(options.session ?? undefined)
  if (method !== 'GET') {
    headers.set('x-requested-with', 'tassl')
    headers.set('content-type', 'application/json')
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value)
  const response = await handler(
    new Request(`http://localhost:3000/api/v1${options.path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    { params: Promise.resolve(options.params ?? {}) },
  )
  const text = await response.text()
  // Only the delegation stream answers something other than JSON, and it is asserted in
  // `tests/integration/assistant/delegate.test.ts`; here a non-JSON body is kept as its text.
  let body: unknown = null
  if (text !== '') {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: response.status, body, headers: response.headers }
}

const errorCode = (called: Called): unknown =>
  ((called.body as { error?: { code?: unknown } } | null)?.error ?? {}).code

const sessionFor = (who: 'student' | 'instructor' | 'ta' | 'classmate'): Promise<Headers> =>
  asUser(fx[who].id, { activeOrganizationId: fx.orgId })

/** Makes one delegation through the service and answers its id. */
async function seedDelegation(runId: string): Promise<string> {
  const stream = await assistant.delegate(fx.student, runId, {
    request: 'What is the premium payback?',
  })
  let id = ''
  for await (const chunk of stream) if (chunk.event === 'done') id = chunk.data.delegationId
  return id
}

beforeEach(async () => {
  await truncateAll()
  delegations = await import('@/app/api/v1/runs/[runId]/delegations/route')
  delegation = await import('@/app/api/v1/runs/[runId]/delegations/[delegationId]/route')
  declaration = await import('@/app/api/v1/runs/[runId]/outside-tool-declaration/route')
  claims = await import('@/app/api/v1/runs/[runId]/claims/route')
  resume = await import('@/app/api/v1/runs/[runId]/resume/route')
  assistant = await import('@/server/modules/assistant')
  fx = await setupAssistantFixture('api-assistant')
})

afterAll(async () => {
  await truncateAll()
})

describe('GET /runs/{runId}/delegations', () => {
  it('answers the owner and both reviewers, and 404s a classmate', async () => {
    const runId = await runInWorking(fx)
    await seedDelegation(runId)

    for (const who of ['student', 'instructor', 'ta'] as const) {
      const called = await call(delegations.GET, {
        path: `/runs/${runId}/delegations`,
        session: await sessionFor(who),
        params: { runId },
      })
      expect(called.status, who).toBe(200)
      expect((called.body as unknown[]).length).toBe(1)
    }

    const refused = await call(delegations.GET, {
      path: `/runs/${runId}/delegations`,
      session: await sessionFor('classmate'),
      params: { runId },
    })
    expect(refused.status).toBe(404)
    expect(errorCode(refused)).toBe('NOT_FOUND')
  })

  it('is Cache-Control: no-store like every /api/v1 response (07 §1)', async () => {
    const runId = await runInWorking(fx)
    const called = await call(delegations.GET, {
      path: `/runs/${runId}/delegations`,
      session: await sessionFor('student'),
      params: { runId },
    })
    expect(called.headers.get('cache-control')).toBe('no-store')
    expect(called.headers.get('x-request-id')).toBeTruthy()
  })
})

describe('POST /runs/{runId}/delegations', () => {
  it('refuses an unauthenticated request', async () => {
    const runId = await runInWorking(fx)
    const called = await call(delegations.POST, {
      method: 'POST',
      path: `/runs/${runId}/delegations`,
      session: null,
      params: { runId },
      body: { request: 'What is the premium payback?' },
    })
    expect(called.status).toBe(401)
    expect(errorCode(called)).toBe('UNAUTHENTICATED')
  })

  it('answers the module’s own error envelope when the assistant is locked', async () => {
    const runs = await import('@/server/modules/runs')
    const started = await runs.startRun(fx.student, fx.assignment.id)
    await runs.acknowledgePolicy(fx.student, started.id)
    await runs.submitReadiness(fx.student, started.id)

    const called = await call(delegations.POST, {
      method: 'POST',
      path: `/runs/${started.id}/delegations`,
      session: await sessionFor('student'),
      params: { runId: started.id },
      body: { request: 'What is the premium payback?' },
    })
    expect(called.status).toBe(409)
    expect(errorCode(called)).toBe('ASSISTANT_LOCKED')
    expect(called.headers.get('cache-control')).toBe('no-store')
  })

  it('answers 400 for a request over the limit', async () => {
    const runId = await runInWorking(fx)
    const called = await call(delegations.POST, {
      method: 'POST',
      path: `/runs/${runId}/delegations`,
      session: await sessionFor('student'),
      params: { runId },
      body: { request: 'x'.repeat(2500) },
    })
    expect(called.status).toBe(400)
    expect(errorCode(called)).toBe('ASSISTANT_REQUEST_TOO_LONG')
  })
})

describe('PATCH /runs/{runId}/delegations/{delegationId}', () => {
  it('saves the why line and answers the entry', async () => {
    const runId = await runInWorking(fx)
    const delegationId = await seedDelegation(runId)

    const called = await call(delegation.PATCH, {
      method: 'PATCH',
      path: `/runs/${runId}/delegations/${delegationId}`,
      session: await sessionFor('student'),
      params: { runId, delegationId },
      body: { why: 'I needed the payback figure.', usedClaimIds: [fx.claimId('C3')] },
    })

    expect(called.status).toBe(200)
    expect(called.body).toMatchObject({
      id: delegationId,
      why: 'I needed the payback figure.',
      claims: [{ key: 'C3', usedMarked: true }],
    })
    // 12 §8.1: the reviewer's fields are not in the owner's answer.
    expect(Object.keys(called.body as object)).not.toContain('flags')
  })

  it('is the owner’s alone, and refuses a reviewer', async () => {
    const runId = await runInWorking(fx)
    const delegationId = await seedDelegation(runId)

    const called = await call(delegation.PATCH, {
      method: 'PATCH',
      path: `/runs/${runId}/delegations/${delegationId}`,
      session: await sessionFor('instructor'),
      params: { runId, delegationId },
      body: { why: 'Not mine to write.' },
    })
    expect(called.status).toBe(404)
  })
})

describe('POST /runs/{runId}/outside-tool-declaration', () => {
  it('answers 204 with no body (FR-061)', async () => {
    const runId = await runInWorking(fx)
    const called = await call(declaration.POST, {
      method: 'POST',
      path: `/runs/${runId}/outside-tool-declaration`,
      session: await sessionFor('student'),
      params: { runId },
      body: { purpose: 'Used a spreadsheet to recompute payback.' },
    })
    expect(called.status).toBe(204)
    expect(called.body).toBeNull()
  })

  it('rejects an empty purpose and a missing CSRF header', async () => {
    const runId = await runInWorking(fx)
    const empty = await call(declaration.POST, {
      method: 'POST',
      path: `/runs/${runId}/outside-tool-declaration`,
      session: await sessionFor('student'),
      params: { runId },
      body: { purpose: '   ' },
    })
    expect(empty.status).toBe(400)
    expect(errorCode(empty)).toBe('VALIDATION_ERROR')

    const noHeader = await call(declaration.POST, {
      method: 'POST',
      path: `/runs/${runId}/outside-tool-declaration`,
      session: await sessionFor('student'),
      params: { runId },
      body: { purpose: 'A spreadsheet.' },
      headers: { 'x-requested-with': '' },
    })
    expect(noHeader.status).toBe(403)
  })
})

describe('GET /runs/{runId}/claims', () => {
  it('answers the surfaced claims, and nothing authored about them', async () => {
    const runId = await runInWorking(fx)
    await seedDelegation(runId)

    const called = await call(claims.GET, {
      path: `/runs/${runId}/claims`,
      session: await sessionFor('student'),
      params: { runId },
    })
    expect(called.status).toBe(200)
    const body = called.body as Record<string, unknown>[]
    expect(body).toHaveLength(1)
    // Step 8.1 added the five fields the claim card's controls need — the actions run, the actions
    // offered, the reply to an escalation the student raised, and the run's escalation budget — and
    // nothing authored *about* the claim: no warranted stance, evidence status, failure family or
    // `escalatable` (D-244).
    expect(Object.keys(body[0] ?? {}).sort()).toEqual([
      'actions',
      'availableActions',
      'canEscalate',
      'escalation',
      'id',
      'inTurnWindow',
      'key',
      'previousStance',
      'reliedOn',
      'remainingEscalations',
      'stance',
      'stanceSetAt',
      'surfacedAt',
      'surfacedBy',
      'text',
      'usedMarked',
    ])
  })

  it('is the owner’s alone: a reviewer replays a scored run, not a running one', async () => {
    const runId = await runInWorking(fx)
    for (const who of ['instructor', 'ta', 'classmate'] as const) {
      const called = await call(claims.GET, {
        path: `/runs/${runId}/claims`,
        session: await sessionFor(who),
        params: { runId },
      })
      expect(called.status, who).toBe(404)
    }
  })
})

describe('POST /runs/{runId}/resume', () => {
  it('takes the run off Paused and answers the run with its clock', async () => {
    const runId = await runInWorking(fx)
    await armForcedFailure(runId)
    expect(
      await codeOf(assistant.delegate(fx.student, runId, { request: 'Premium payback?' })),
    ).toBe('ASSISTANT_UNAVAILABLE')

    const called = await call(resume.POST, {
      method: 'POST',
      path: `/runs/${runId}/resume`,
      session: await sessionFor('student'),
      params: { runId },
    })
    expect(called.status).toBe(200)
    expect(called.body).toMatchObject({
      state: 'working',
      clock: { paused: false, creditedMs: 0 },
    })
  })

  it('refuses a run that is not paused, and a reader who does not own it', async () => {
    const runId = await runInWorking(fx)

    const notPaused = await call(resume.POST, {
      method: 'POST',
      path: `/runs/${runId}/resume`,
      session: await sessionFor('student'),
      params: { runId },
    })
    expect(notPaused.status).toBe(409)
    expect(errorCode(notPaused)).toBe('ILLEGAL_TRANSITION')

    const foreign = await call(resume.POST, {
      method: 'POST',
      path: `/runs/${runId}/resume`,
      session: await sessionFor('classmate'),
      params: { runId },
    })
    expect(foreign.status).toBe(404)
  })
})
