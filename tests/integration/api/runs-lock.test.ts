// Step 8.2 — the five endpoints of docs/tech/07-api-spec.md §7 this step owns, driven as Next drives
// them: a real `Request` through the handler `src/app/api/v1/**/route.ts` exports, with the session
// cookie `asUser()` mints and the `X-Requested-With: tassl` header every cookie-authenticated
// mutation carries (08 §2.7).
//
//   PUT  /runs/{runId}/brief                                          save the draft
//   POST /runs/{runId}/brief/signals                                  the editor opened or closed
//   POST /runs/{runId}/lock                                           the Decision Lock
//   POST /runs/{runId}/addendum                                       the fifty words after it
//   POST /review/runs/{runId}/test-controls/force-assistant-failure   FR-118, the faculty seat
//
// The first four are the student's own run and nobody else's (08 §4: "✓* own run" for the student,
// "—" for every other seat, the instructor and TA included). The fifth is the mirror image, and it
// is the row worth having a test for: the *student cannot arm it*, and the refusal is the one 08 §4
// gives a section member holding the wrong role.
//
// What only the wire can show is asserted here rather than in the service suite: the status codes,
// the envelope a refusal carries with `details.claimId` and `details.claimText`, and the 204s.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, truncateAll } from '@tests/setup/integration'
import {
  claimByKey,
  openDocument,
  runInWorking,
  setupAssistantFixture,
  type AssistantFixture,
} from '../reliance/fixture'

type BriefRoute = typeof import('@/app/api/v1/runs/[runId]/brief/route')
type SignalsRoute = typeof import('@/app/api/v1/runs/[runId]/brief/signals/route')
type LockRoute = typeof import('@/app/api/v1/runs/[runId]/lock/route')
type AddendumRoute = typeof import('@/app/api/v1/runs/[runId]/addendum/route')
type ForceFailureRoute =
  typeof import('@/app/api/v1/review/runs/[runId]/test-controls/force-assistant-failure/route')

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

let brief: BriefRoute
let signals: SignalsRoute
let lock: LockRoute
let addendum: AddendumRoute
let forceFailure: ForceFailureRoute
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

const errorOf = (called: Called) =>
  ((called.body as { error?: { code?: unknown; details?: unknown } } | null)?.error ?? {}) as {
    code?: unknown
    details?: unknown
  }

const sessionFor = (who: 'student' | 'instructor' | 'ta' | 'classmate'): Promise<Headers> =>
  asUser(fx[who].id, { activeOrganizationId: fx.orgId })

/** A brief that meets FR-100 and names no figure. */
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

/** The three seats 08 §4 refuses this run's own endpoints to. */
const DENIED = ['instructor', 'ta', 'classmate'] as const

beforeEach(async () => {
  await truncateAll()
  brief = await import('@/app/api/v1/runs/[runId]/brief/route')
  signals = await import('@/app/api/v1/runs/[runId]/brief/signals/route')
  lock = await import('@/app/api/v1/runs/[runId]/lock/route')
  addendum = await import('@/app/api/v1/runs/[runId]/addendum/route')
  forceFailure =
    await import('@/app/api/v1/review/runs/[runId]/test-controls/force-assistant-failure/route')
  fx = await setupAssistantFixture('api-lock')
  runId = await runInWorking(fx)
})

afterAll(async () => {
  await truncateAll()
})

describe('PUT /runs/{runId}/brief', () => {
  it('answers the owner 204 with no body', async () => {
    const called = await call(brief.PUT, {
      method: 'PUT',
      path: `/runs/${runId}/brief`,
      session: await sessionFor('student'),
      params: { runId },
      body: { recommendation: 'Hold the spend' },
    })
    expect(called.status).toBe(204)
    expect(called.body).toBeNull()
  })

  it('refuses everyone but the run’s own student with 404', async () => {
    for (const seat of DENIED) {
      const called = await call(brief.PUT, {
        method: 'PUT',
        path: `/runs/${runId}/brief`,
        session: await sessionFor(seat),
        params: { runId },
        body: { recommendation: 'Hold the spend' },
      })
      expect([seat, called.status]).toEqual([seat, 404])
    }
  })

  it('refuses an anonymous request with 401', async () => {
    const called = await call(brief.PUT, {
      method: 'PUT',
      path: `/runs/${runId}/brief`,
      session: null,
      params: { runId },
      body: { recommendation: 'Hold the spend' },
    })
    expect(called.status).toBe(401)
  })

  it('answers a field over its limit with BRIEF_INVALID naming it', async () => {
    const called = await call(brief.PUT, {
      method: 'PUT',
      path: `/runs/${runId}/brief`,
      session: await sessionFor('student'),
      params: { runId },
      body: { recommendation: Array.from({ length: 121 }, (_, i) => `word${i}`).join(' ') },
    })
    expect(called.status).toBe(400)
    expect(errorOf(called).code).toBe('BRIEF_INVALID')
    expect(errorOf(called).details).toEqual({ field: 'recommendation', reason: 'word_limit' })
  })
})

describe('POST /runs/{runId}/brief/signals', () => {
  it('accepts both shapes and answers 204', async () => {
    const session = await sessionFor('student')
    for (const body of [{ opened: true }, { closed: true, durationMs: 12_000 }]) {
      const called = await call(signals.POST, {
        method: 'POST',
        path: `/runs/${runId}/brief/signals`,
        session,
        params: { runId },
        body,
      })
      expect(called.status).toBe(204)
    }
  })

  it('refuses a shape that is neither', async () => {
    const called = await call(signals.POST, {
      method: 'POST',
      path: `/runs/${runId}/brief/signals`,
      session: await sessionFor('student'),
      params: { runId },
      body: { opened: false },
    })
    expect(called.status).toBe(400)
    expect(errorOf(called).code).toBe('VALIDATION_ERROR')
  })

  it('refuses everyone but the run’s own student with 404', async () => {
    for (const seat of DENIED) {
      const called = await call(signals.POST, {
        method: 'POST',
        path: `/runs/${runId}/brief/signals`,
        session: await sessionFor(seat),
        params: { runId },
        body: { opened: true },
      })
      expect([seat, called.status]).toEqual([seat, 404])
    }
  })
})

describe('POST /runs/{runId}/lock', () => {
  it('answers the owner with the run, now locked and waiting on the Turn', async () => {
    const called = await call(lock.POST, {
      method: 'POST',
      path: `/runs/${runId}/lock`,
      session: await sessionFor('student'),
      params: { runId },
      body: BRIEF,
    })

    expect(called.status).toBe(200)
    expect(called.body).toMatchObject({ id: runId, state: 'decision_locked', clock: null })
    expect((called.body as { turn: { dueAt: string } }).turn.dueAt).toBeTruthy()
  })

  it('carries the lock gate’s refusal in the envelope 07 §7 publishes', async () => {
    // D5 carries C1, which carries the 4.2-month figure the brief below names (FR-101, D-076).
    await openDocument(fx, runId, 'D5')

    const called = await call(lock.POST, {
      method: 'POST',
      path: `/runs/${runId}/lock`,
      session: await sessionFor('student'),
      params: { runId },
      body: { ...BRIEF, namedValues: { premium_payback_months: 4.2 } },
    })

    expect(called.status).toBe(409)
    expect(errorOf(called).code).toBe('LOCK_REFUSED_UNSTANCED_CLAIM')
    expect(errorOf(called).details).toEqual({
      claimId: fx.claimId('C1'),
      claimText: claimByKey('C1').text,
    })
    expect((called.body as { error: { requestId: string } }).error.requestId).toBeTruthy()
  })

  it('answers a brief that breaks FR-100 with 400 and the field', async () => {
    const called = await call(lock.POST, {
      method: 'POST',
      path: `/runs/${runId}/lock`,
      session: await sessionFor('student'),
      params: { runId },
      body: { ...BRIEF, changeMyMind: '' },
    })
    expect(called.status).toBe(400)
    expect(errorOf(called).code).toBe('BRIEF_INVALID')
    expect(errorOf(called).details).toEqual({ field: 'changeMyMind', reason: 'required' })
  })

  it('refuses everyone but the run’s own student with 404', async () => {
    for (const seat of DENIED) {
      const called = await call(lock.POST, {
        method: 'POST',
        path: `/runs/${runId}/lock`,
        session: await sessionFor(seat),
        params: { runId },
        body: BRIEF,
      })
      expect([seat, called.status]).toEqual([seat, 404])
    }
  })
})

describe('POST /runs/{runId}/addendum', () => {
  const TEXT = 'On reflection the payback figure should have been traced before the spend moved.'

  async function lockIt(): Promise<void> {
    await call(lock.POST, {
      method: 'POST',
      path: `/runs/${runId}/lock`,
      session: await sessionFor('student'),
      params: { runId },
      body: BRIEF,
    })
  }

  it('answers 204 the first time and ADDENDUM_EXISTS the second', async () => {
    await lockIt()
    const session = await sessionFor('student')

    const first = await call(addendum.POST, {
      method: 'POST',
      path: `/runs/${runId}/addendum`,
      session,
      params: { runId },
      body: { text: TEXT },
    })
    expect(first.status).toBe(204)

    const second = await call(addendum.POST, {
      method: 'POST',
      path: `/runs/${runId}/addendum`,
      session,
      params: { runId },
      body: { text: 'A second thought.' },
    })
    expect(second.status).toBe(409)
    expect(errorOf(second).code).toBe('ADDENDUM_EXISTS')
  })

  it('refuses everyone but the run’s own student with 404', async () => {
    await lockIt()
    for (const seat of DENIED) {
      const called = await call(addendum.POST, {
        method: 'POST',
        path: `/runs/${runId}/addendum`,
        session: await sessionFor(seat),
        params: { runId },
        body: { text: TEXT },
      })
      expect([seat, called.status]).toEqual([seat, 404])
    }
  })
})

describe('POST /review/runs/{runId}/test-controls/force-assistant-failure', () => {
  const path = () => `/review/runs/${runId}/test-controls/force-assistant-failure`

  it('answers the section’s instructor { armed: true }', async () => {
    const called = await call(forceFailure.POST, {
      method: 'POST',
      path: path(),
      session: await sessionFor('instructor'),
      params: { runId },
    })
    expect(called.status).toBe(200)
    expect(called.body).toEqual({ armed: true })
  })

  it('refuses the student whose run it is — 08 §4’s "—" on the test-control row', async () => {
    const called = await call(forceFailure.POST, {
      method: 'POST',
      path: path(),
      session: await sessionFor('student'),
      params: { runId },
    })
    // FORBIDDEN, not NOT_FOUND: the run is theirs, so its existence is not the secret — the control
    // is simply not theirs to press. And the answer says nothing about whether the installation has
    // test controls on at all, because the seat is checked first.
    expect(called.status).toBe(403)
    expect(errorOf(called).code).toBe('FORBIDDEN')
  })

  it('refuses the TA and a classmate', async () => {
    for (const seat of ['ta', 'classmate'] as const) {
      const called = await call(forceFailure.POST, {
        method: 'POST',
        path: path(),
        session: await sessionFor(seat),
        params: { runId },
      })
      expect([seat, called.status]).toEqual([seat, 403])
    }
  })

  it('refuses an anonymous request with 401', async () => {
    const called = await call(forceFailure.POST, {
      method: 'POST',
      path: path(),
      session: null,
      params: { runId },
    })
    expect(called.status).toBe(401)
  })
})
