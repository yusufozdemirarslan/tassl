// Step 6.2 — the four endpoints of docs/tech/07-api-spec.md §7 this step owns, driven as Next
// drives them: a real `Request` through the handler `src/app/api/v1/**/route.ts` exports, with the
// session cookie `asUser()` mints and the `X-Requested-With: tassl` header `defineRoute` requires of
// every cookie-authenticated mutation (08 §2.7).
//
// Each row gets one allow case and one deny case, plus the two things only the wire can show: the
// 201 a start answers with, and the ETag / `X-Run-Version` / 304 of the five-second poll (D-123).
// @db:truncate
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'

type AssignmentRunsRoute = typeof import('@/app/api/v1/assignments/[assignmentId]/runs/route')
type RunRoute = typeof import('@/app/api/v1/runs/[runId]/route')
type PolicyAckRoute = typeof import('@/app/api/v1/runs/[runId]/policy-ack/route')
type MyRunsRoute = typeof import('@/app/api/v1/me/runs/route')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

let assignmentRuns: AssignmentRunsRoute
let runRoute: RunRoute
let policyAck: PolicyAckRoute
let myRuns: MyRunsRoute
let f: Factories

type Called = {
  status: number
  body: Record<string, unknown> | null
  headers: Headers
}

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
  const request = new Request(`http://localhost:3000/api/v1${options.path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) })
  const text = await response.text()
  return {
    status: response.status,
    body: text === '' ? null : (JSON.parse(text) as never),
    headers: response.headers,
  }
}

const errorCode = (called: Called): unknown =>
  (called.body?.error as { code?: unknown } | undefined)?.code

type Fixture = Awaited<ReturnType<typeof seed>>

/** The walkthrough institution with a confirmed package, plus a second institution's instructor. */
async function seed() {
  const w = await f.buildWalkthroughFixture()
  const orgId = w.organization.id
  await testSql`
    update scenario_package_versions set status = 'confirmed', confirmed_at = now(),
      confirmed_by = ${w.instructor.id}, teaching_note_checked = true
    where id = ${w.pkg.version.id}`

  const outsiderOrg = (await f.createInstitution('api-runs-b')).organization.id
  const outsider = await f.createUser('api-runs-outsider')
  await f.addMember(outsiderOrg, outsider.id, 'instructor')

  const ta = await f.createUser('api-runs-ta')
  await f.addMember(orgId, ta.id, 'teaching_assistant')
  await f.addSectionMember(orgId, w.section.id, ta.id, 'ta')

  const session = (user: UserRow, org = orgId): Promise<Headers> =>
    asUser(user.id, { activeOrganizationId: org })

  return {
    orgId,
    assignmentId: w.assignment.id,
    student: await session(w.student1),
    student2: await session(w.student2),
    instructor: await session(w.instructor),
    ta: await session(ta),
    outsider: await session(outsider, outsiderOrg),
  }
}

let fx: Fixture

beforeAll(async () => {
  assignmentRuns = await import('@/app/api/v1/assignments/[assignmentId]/runs/route')
  runRoute = await import('@/app/api/v1/runs/[runId]/route')
  policyAck = await import('@/app/api/v1/runs/[runId]/policy-ack/route')
  myRuns = await import('@/app/api/v1/me/runs/route')
  f = await import('@tests/factories')
})

beforeEach(async () => {
  await truncateAll()
  fx = await seed()
})

afterAll(async () => {
  await truncateAll()
})

const start = (session: Headers, headers?: Record<string, string>): Promise<Called> =>
  call(assignmentRuns.POST, {
    method: 'POST',
    path: `/assignments/${fx.assignmentId}/runs`,
    session,
    params: { assignmentId: fx.assignmentId },
    ...(headers ? { headers } : {}),
  })

const runRows = (): Promise<{ id: string }[]> =>
  testSql<{ id: string }[]>`select id from runs order by created_at`

describe('POST /assignments/{assignmentId}/runs', () => {
  it('answers 201 with the run summary to a student on the section', async () => {
    const called = await start(fx.student)
    expect(called.status).toBe(201)
    expect(called.body).toMatchObject({
      state: 'assigned',
      attemptNo: 1,
      isWalkthrough: true,
      clock: null,
      turn: null,
      version: 0,
    })
    expect(called.headers.get('cache-control')).toBe('no-store')
    // The variant is the one thing about the scenario the student may not know before scoring
    // (12 §8, D-228): "sound" would say no defect was planted.
    expect(called.body).not.toHaveProperty('variantKey')
    expect(JSON.stringify(called.body)).not.toContain('defective')
  })

  it('answers 409 RUN_ACTIVE_EXISTS to a second start', async () => {
    await start(fx.student)
    const again = await start(fx.student)
    expect(again.status).toBe(409)
    expect(errorCode(again)).toBe('RUN_ACTIVE_EXISTS')
  })

  it('refuses the instructor, the TA and another institution', async () => {
    expect((await start(fx.instructor)).status).toBe(403)
    expect((await start(fx.ta)).status).toBe(403)
    expect((await start(fx.outsider)).status).toBe(404)
  })

  // 07 §1: "`Idempotency-Key` header accepted on the routes marked *idempotent*; a repeat within
  // 24 h returns the original result". 07 §7 marks this row idempotent (10 §11 names the store).
  describe('Idempotency-Key', () => {
    const KEY = '01J8Z4S8Q5B3F1V6E9K2N7M0TA'

    it('hands a retry the run the first call created instead of RUN_ACTIVE_EXISTS', async () => {
      const first = await start(fx.student, { 'idempotency-key': KEY })
      expect(first.status).toBe(201)

      const retry = await start(fx.student, { 'idempotency-key': KEY })
      expect(retry.status).toBe(201)
      expect(retry.body).toMatchObject({ id: (first.body as { id: string }).id })
      // And it really was a replay, not a second run.
      expect(await runRows()).toHaveLength(1)
    })

    it('leaves the rule of D-041 alone when no key is sent, and under a different key', async () => {
      await start(fx.student, { 'idempotency-key': KEY })
      expect(errorCode(await start(fx.student))).toBe('RUN_ACTIVE_EXISTS')
      expect(errorCode(await start(fx.student, { 'idempotency-key': `${KEY}-other` }))).toBe(
        'RUN_ACTIVE_EXISTS',
      )
      expect(await runRows()).toHaveLength(1)
    })

    it('is scoped to the actor: another student’s key starts their own run', async () => {
      const mine = await start(fx.student, { 'idempotency-key': KEY })
      const theirs = await start(fx.student2, { 'idempotency-key': KEY })
      expect(theirs.status).toBe(201)
      expect((theirs.body as { id: string }).id).not.toBe((mine.body as { id: string }).id)
      expect(await runRows()).toHaveLength(2)
    })

    it('writes no receipt for a refused call, so the retry meets the same refusal', async () => {
      // The first Start is refused because the assignment has not opened; the key must not turn the
      // retry into a replay of a run that was never created.
      const opensAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      await testSql`update assignments set opens_at = ${opensAt} where id = ${fx.assignmentId}`
      expect((await start(fx.student, { 'idempotency-key': KEY })).status).toBe(403)
      expect((await start(fx.student, { 'idempotency-key': KEY })).status).toBe(403)
      expect(await runRows()).toHaveLength(0)
    })

    it('rejects a malformed key rather than silently ignoring it', async () => {
      const called = await start(fx.student, { 'idempotency-key': 'has a space' })
      expect(called.status).toBe(400)
      expect(errorCode(called)).toBe('VALIDATION_ERROR')
      expect(await runRows()).toHaveLength(0)
    })

    it('stops replaying once the receipt is older than 24 h', async () => {
      expect((await start(fx.student, { 'idempotency-key': KEY })).status).toBe(201)
      // The row's `window_start` is the instant the receipt expires; move it into the past.
      const aged = await testSql`
        update rate_limit_buckets set window_start = now() - interval '1 minute'
        where key like 'idem:%' returning key`
      expect(aged).toHaveLength(1)

      const later = await start(fx.student, { 'idempotency-key': KEY })
      expect(later.status).toBe(409)
      expect(errorCode(later)).toBe('RUN_ACTIVE_EXISTS')
      expect(await runRows()).toHaveLength(1)
    })
  })

  it('refuses a mutation without the CSRF header (08 §2.7)', async () => {
    const request = new Request(
      `http://localhost:3000/api/v1/assignments/${fx.assignmentId}/runs`,
      { method: 'POST', headers: new Headers(fx.student) },
    )
    const response = await assignmentRuns.POST(request, {
      params: Promise.resolve({ assignmentId: fx.assignmentId }),
    })
    expect(response.status).toBe(403)
  })
})

describe('GET /assignments/{assignmentId}/runs', () => {
  const list = (session: Headers, query = ''): Promise<Called> =>
    call(assignmentRuns.GET, {
      path: `/assignments/${fx.assignmentId}/runs${query}`,
      session,
      params: { assignmentId: fx.assignmentId },
    })

  it('gives the section instructor and the TA every run with its student', async () => {
    const started = (await start(fx.student)).body as { id: string }
    for (const reviewer of [fx.instructor, fx.ta]) {
      const called = await list(reviewer)
      expect(called.status).toBe(200)
      const items = (called.body as { items: Record<string, unknown>[] }).items
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        id: started.id,
        state: 'assigned',
        decisionsMade: 0,
        latestExportVersion: null,
      })
      expect(items[0]?.studentId).toEqual(expect.any(String))
    }
  })

  it('refuses a student and another institution', async () => {
    await start(fx.student)
    expect((await list(fx.student)).status).toBe(403)
    expect((await list(fx.outsider)).status).toBe(404)
  })

  it('rejects an unknown query parameter', async () => {
    const called = await list(fx.instructor, '?sneaky=1')
    expect(called.status).toBe(400)
    expect(errorCode(called)).toBe('VALIDATION_ERROR')
  })
})

describe('GET /runs/{runId}', () => {
  const get = (
    session: Headers,
    runId: string,
    headers?: Record<string, string>,
  ): Promise<Called> =>
    call(runRoute.GET, {
      path: `/runs/${runId}`,
      session,
      params: { runId },
      ...(headers ? { headers } : {}),
    })

  it('answers the owner with the summary and the poll headers (D-123)', async () => {
    const started = (await start(fx.student)).body as { id: string; version: number }
    const called = await get(fx.student, started.id)

    expect(called.status).toBe(200)
    expect(called.body).toMatchObject({ id: started.id, state: 'assigned' })
    expect(called.headers.get('x-run-version')).toBe('0')
    expect(called.headers.get('etag')).toBe('"v0"')
    expect(called.headers.get('cache-control')).toBe('no-store')
  })

  it('answers 304 with no body when If-None-Match names the version it holds', async () => {
    const started = (await start(fx.student)).body as { id: string }
    const first = await get(fx.student, started.id)
    const etag = first.headers.get('etag') ?? ''

    const again = await get(fx.student, started.id, { 'if-none-match': etag })
    expect(again.status).toBe(304)
    expect(again.body).toBeNull()
    expect(again.headers.get('etag')).toBe(etag)
    expect(again.headers.get('x-run-version')).toBe('0')
  })

  it('answers 200 again once an event has moved the version', async () => {
    const started = (await start(fx.student)).body as { id: string }
    const etag = (await get(fx.student, started.id)).headers.get('etag') ?? ''

    await call(policyAck.POST, {
      method: 'POST',
      path: `/runs/${started.id}/policy-ack`,
      session: fx.student,
      params: { runId: started.id },
    })

    const after = await get(fx.student, started.id, { 'if-none-match': etag })
    expect(after.status).toBe(200)
    expect(after.body).toMatchObject({ state: 'readiness', version: 2 })
    expect(after.headers.get('etag')).toBe('"v2"')
  })

  it('answers a reviewer and refuses a classmate, another institution, and a bad id', async () => {
    const started = (await start(fx.student)).body as { id: string }
    expect((await get(fx.instructor, started.id)).status).toBe(200)
    expect((await get(fx.ta, started.id)).status).toBe(200)
    expect((await get(fx.student2, started.id)).status).toBe(404)
    expect((await get(fx.outsider, started.id)).status).toBe(404)
    expect((await get(fx.student, '00000000-0000-4000-8000-000000000000')).status).toBe(404)
  })
})

describe('POST /runs/{runId}/policy-ack', () => {
  const ack = (session: Headers, runId: string): Promise<Called> =>
    call(policyAck.POST, {
      method: 'POST',
      path: `/runs/${runId}/policy-ack`,
      session,
      params: { runId },
    })

  it('moves the run to readiness and answers with the new summary', async () => {
    const started = (await start(fx.student)).body as { id: string }
    const called = await ack(fx.student, started.id)
    expect(called.status).toBe(200)
    expect(called.body).toMatchObject({
      state: 'readiness',
      version: 2,
      links: { next: `/runs/${started.id}/readiness` },
    })
  })

  it('answers 409 ILLEGAL_TRANSITION to a second acknowledgement', async () => {
    const started = (await start(fx.student)).body as { id: string }
    await ack(fx.student, started.id)
    const again = await ack(fx.student, started.id)
    expect(again.status).toBe(409)
    expect(errorCode(again)).toBe('ILLEGAL_TRANSITION')
  })

  it('refuses everyone but the owner, reviewers included', async () => {
    const started = (await start(fx.student)).body as { id: string }
    expect((await ack(fx.instructor, started.id)).status).toBe(404)
    expect((await ack(fx.ta, started.id)).status).toBe(404)
    expect((await ack(fx.student2, started.id)).status).toBe(404)
    expect((await ack(fx.outsider, started.id)).status).toBe(404)
  })
})

describe('GET /me/runs', () => {
  const list = (session: Headers, query = ''): Promise<Called> =>
    call(myRuns.GET, { path: `/me/runs${query}`, session })

  it('answers with the actor’s own runs and nobody else’s', async () => {
    const mine = (await start(fx.student)).body as { id: string }
    await start(fx.student2)

    const called = await list(fx.student)
    expect(called.status).toBe(200)
    const items = (called.body as { items: { id: string }[] }).items
    expect(items.map((item) => item.id)).toEqual([mine.id])
    expect((called.body as { nextCursor: unknown }).nextCursor).toBeNull()
  })

  it('answers an empty page to someone with no runs', async () => {
    expect((await list(fx.instructor)).body).toEqual({ items: [], nextCursor: null })
  })

  it('filters by state and rejects an unknown query parameter', async () => {
    await start(fx.student)
    expect(((await list(fx.student, '?state=assigned')).body as { items: [] }).items).toHaveLength(
      1,
    )
    expect(((await list(fx.student, '?state=working')).body as { items: [] }).items).toHaveLength(0)

    const bad = await list(fx.student, '?state=assigned&sneaky=1')
    expect(bad.status).toBe(400)
    expect(errorCode(bad)).toBe('VALIDATION_ERROR')
  })

  it('refuses an anonymous request', async () => {
    const called = await call(myRuns.GET, { path: '/me/runs', session: null })
    expect(called.status).toBe(401)
  })
})
