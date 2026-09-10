// The C4 suite of docs/prompts/02-qa-and-guides.md: authentication and authorization, proven at
// the three places the product enforces them.
//
//   role × route      `src/proxy.ts` and the `(app)` layouts — the optimistic hop to /sign-in for
//                     a visitor with no cookie, the layout's redirect for a cookie that is dead,
//                     `/admin`'s not-found for every seat but the platform admin, and the run
//                     layout's not-found for a classmate (08 §2.6, §4).
//   IDOR              a student asking for a classmate's run by id, and an instructor asking for
//                     another institution's run, assignment, roster and course, through the real
//                     route handlers: NOT_FOUND every time, never FORBIDDEN, never data (08 §4
//                     "Read another student's run", §5 "Cross-tenant", D-703).
//   immutability      the locked frame, brief and decision, the filed Turn response, the finished
//                     defense and the confirmed package version: every write after the lock is a
//                     documented 4xx and the rows are byte-identical before and after (08 §4 "Edit
//                     a locked frame, brief, or Turn response", 10 §9, D-085).
//
// `tests/integration/auth/matrix.test.ts` is the seat × operation table over a fixture that never
// leaves `assigned`; this file is the other half — real runs, driven to `scored` through the
// services the way `tests/integration/review/fixture.ts` drives them, and the pages' own guards.
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'
import {
  BRIEF,
  FIXTURE,
  TURN_RESPONSE,
  advanceClock,
  claimByKey,
  delegate,
  runInWorking,
  scoredRun,
  setupAssistantFixture,
  type AssistantFixture,
} from './review/fixture'

// ---------------------------------------------------------------------------------------------
// The pages' request context
// ---------------------------------------------------------------------------------------------
//
// A layout reads the request through `next/headers` and turns a visitor away through
// `next/navigation`, and neither exists outside a Next request. The headers are what this file
// hands the layout; the two exits become errors the assertions can name, the way
// `tests/unit/app/generation-page-gate.test.ts` names `NEXT_NOT_FOUND`.

const current = vi.hoisted(() => ({ headers: new Headers() }))

vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  headers: async () => current.headers,
}))

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  },
}))

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

type Called = { status: number; body: unknown; text: string }

/** One route handler, called the way the browser calls it (the shape of every api suite). */
async function call(
  handler: RouteHandler,
  options: {
    method?: string
    path: string
    session: Headers
    params?: Record<string, string>
    body?: unknown
  },
): Promise<Called> {
  const method = options.method ?? 'GET'
  const headers = new Headers(options.session)
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
  return { status: response.status, body: text === '' ? null : JSON.parse(text), text }
}

const errorOf = (called: Called) =>
  ((called.body as { error?: { code?: unknown; details?: unknown } } | null)?.error ?? {}) as {
    code?: unknown
    details?: unknown
  }

const ANONYMOUS = new Headers()

/** The session cookie name `getSessionCookie` looks for, as `tests/unit/app/proxy.test.ts` spells it. */
const SESSION_COOKIE = 'better-auth.session_token'

function pageRequest(path: string, init: { cookie?: boolean } = {}): NextRequest {
  const request = new NextRequest(new URL(path, 'http://localhost:3000'))
  if (init.cookie) request.cookies.set(SESSION_COOKIE, 'a.session')
  return request
}

/** The run's state as the table holds it, which is what a refusal's `details.state` must name. */
async function stateOf(runId: string): Promise<string> {
  const [row] = await testSql<{ state: string }[]>`select state from runs where id = ${runId}`
  if (!row) throw new Error(`no run ${runId}`)
  return row.state
}

/** The rows of one table for one id, each as its JSON text: the record as written, byte for byte. */
async function rowsOf(table: string, column: string, id: string): Promise<string[]> {
  const rows = await testSql.unsafe<{ row: string }[]>(
    `select to_jsonb(t)::text as row from "${table}" t where "${column}" = $1 order by 1`,
    [id],
  )
  return rows.map((entry) => entry.row)
}

// ---------------------------------------------------------------------------------------------
// The fixture: two institutions, and the seats the three describes share
// ---------------------------------------------------------------------------------------------

type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

/** Institution X, with the two students whose runs the IDOR rows are about. */
let fx: AssistantFixture
/** Institution Y: the instructor of another course, in another institution. */
let fy: AssistantFixture
let admin: UserRow
/** Student A's and student B's runs, both at `scored`. */
let runA: string
let runB: string
let courseX: string
let courseY: string

const session = (userId: string, orgId: string): Promise<Headers> =>
  asUser(userId, { activeOrganizationId: orgId })

async function courseOf(sectionId: string): Promise<string> {
  const [row] = await testSql<{ course_id: string }[]>`
    select course_id from sections where id = ${sectionId}`
  if (!row) throw new Error(`no section ${sectionId}`)
  return row.course_id
}

beforeAll(async () => {
  await truncateAll()
  const f = (await import('@tests/factories')) as Factories
  fx = await setupAssistantFixture('authz-x')
  fy = await setupAssistantFixture('authz-y')
  admin = await f.createUser('authz-admin', { platformRole: 'admin' })
  courseX = await courseOf(fx.assignment.sectionId)
  courseY = await courseOf(fy.assignment.sectionId)

  // Two classmates, each with a run taken all the way through — the classmate's through the same
  // fixture with the seats swapped, so B's run is built by exactly the acts A's was.
  runA = await scoredRun(fx)
  runB = await scoredRun({ ...fx, student: fx.classmate })
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// (a) role × route
// ---------------------------------------------------------------------------------------------

describe('role × route (08 §2.6, §4: proxy.ts and the (app) layouts)', () => {
  const APP_PATHS = [
    '/home',
    '/runs',
    '/courses',
    '/review',
    '/packages',
    '/admin',
    '/settings',
    '/notifications',
    '/invitations',
  ] as const

  const PUBLIC_PATHS = [
    '/',
    '/sign-in',
    '/sign-up',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/privacy',
    '/terms',
  ] as const

  type Layout = (props: { children: null }) => Promise<unknown>
  type RunLayout = (props: {
    children: null
    params: Promise<{ runId: string }>
  }) => Promise<unknown>

  let proxy: typeof import('@/proxy').proxy
  let AppLayout: Layout
  let AdminLayout: Layout
  let RunLayout: RunLayout

  beforeAll(async () => {
    proxy = (await import('@/proxy')).proxy
    AppLayout = (await import('@/app/(app)/layout')).default as Layout
    AdminLayout = (await import('@/app/(app)/admin/layout')).default as Layout
    RunLayout = (await import('@/app/(app)/runs/[runId]/layout')).default as unknown as RunLayout
  })

  /** Renders a layout as one person, on one address, the way the proxy hands it over. */
  async function render<T>(layout: () => Promise<T>, who: Headers, pathname: string): Promise<T> {
    const headers = new Headers(who)
    headers.set('x-pathname', pathname)
    current.headers = headers
    return layout()
  }

  for (const path of APP_PATHS) {
    it(`sends an anonymous visitor on ${path} to sign in, with the address`, () => {
      const response = proxy(pageRequest(`${path}?tab=1`))
      expect(response.status).toBe(307)
      const location = new URL(response.headers.get('location') ?? '', 'http://localhost:3000')
      expect(location.pathname).toBe('/sign-in')
      expect(location.searchParams.get('next')).toBe(`${path}?tab=1`)
    })
  }

  it('lets an anonymous visitor through to every public path', () => {
    for (const path of PUBLIC_PATHS) {
      expect([path, proxy(pageRequest(path)).headers.get('location')]).toEqual([path, null])
    }
  })

  it('passes a cookie through on every app path: the layout, not the proxy, is the guard', () => {
    for (const path of APP_PATHS) {
      const response = proxy(pageRequest(path, { cookie: true }))
      expect([path, response.headers.get('location')]).toEqual([path, null])
      expect(response.headers.get('x-middleware-request-x-pathname')).toBe(path)
    }
  })

  it('the (app) layout turns a dead cookie away to /sign-in with the address the proxy stamped', async () => {
    // A cookie that is present but names no session reaches the layout; that is the whole reason
    // the hop is optimistic (D-198). `/records` and `/assignments` are not in the proxy's list at
    // all, so for them this redirect is the only one there is.
    for (const path of [
      '/home',
      '/admin/users',
      `/records/${runA}`,
      `/assignments/${fx.assignment.id}`,
    ]) {
      const dead = new Headers({ cookie: `${SESSION_COOKIE}=dead.cookie` })
      await expect(render(() => AppLayout({ children: null }), dead, path)).rejects.toThrow(
        `NEXT_REDIRECT /sign-in?next=${encodeURIComponent(path)}`,
      )
    }
  })

  it('the (app) layout renders for every signed-in seat', async () => {
    for (const who of [
      await session(fx.studentUser.id, fx.orgId),
      await session(fx.instructor.id, fx.orgId),
      await session(admin.id, fx.orgId),
    ]) {
      await expect(render(() => AppLayout({ children: null }), who, '/home')).resolves.toBeTruthy()
    }
  })

  it('/admin is not found for a student and an instructor, and renders for the platform admin', async () => {
    const student = await session(fx.studentUser.id, fx.orgId)
    const instructor = await session(fx.instructor.id, fx.orgId)
    const platformAdmin = await session(admin.id, fx.orgId)
    await expect(
      render(() => AdminLayout({ children: null }), student, '/admin/users'),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(
      render(() => AdminLayout({ children: null }), instructor, '/admin/users'),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(
      render(() => AdminLayout({ children: null }), platformAdmin, '/admin/users'),
    ).resolves.toBeTruthy()
  })

  it('/runs/[runId] renders for the owner and a section reviewer, and is not found for everyone else', async () => {
    const page = (who: Headers) =>
      render(
        () => RunLayout({ children: null, params: Promise.resolve({ runId: runB }) }),
        who,
        `/runs/${runB}`,
      )
    await expect(page(await session(fx.classmate.id, fx.orgId))).resolves.toBeTruthy()
    await expect(page(await session(fx.instructor.id, fx.orgId))).resolves.toBeTruthy()
    await expect(page(await session(fx.ta.id, fx.orgId))).resolves.toBeTruthy()
    // The classmate of the run's owner, the instructor of another institution, the platform admin.
    await expect(page(await session(fx.studentUser.id, fx.orgId))).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(page(await session(fy.instructor.id, fy.orgId))).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(page(await session(admin.id, fx.orgId))).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(page(ANONYMOUS)).rejects.toThrow(
      `NEXT_REDIRECT /sign-in?next=${encodeURIComponent(`/runs/${runB}`)}`,
    )
  })
})

// ---------------------------------------------------------------------------------------------
// (b) IDOR
// ---------------------------------------------------------------------------------------------

describe('IDOR (08 §4 "Read another student’s run", §5 "Cross-tenant", D-703)', () => {
  type Read = { name: string; handler: RouteHandler; path: string; params: Record<string, string> }

  /** Every read of one student's run a classmate could try by id. */
  let runReads: (runId: string) => Read[]
  /** The reads of one course's things an instructor of another could try by id. */
  let courseReads: (fixture: AssistantFixture, course: string, runId: string) => Read[]
  let assignmentRuns: RouteHandler

  beforeAll(async () => {
    const runDetail = await import('@/app/api/v1/runs/[runId]/route')
    const trace = await import('@/app/api/v1/runs/[runId]/trace/route')
    const workspace = await import('@/app/api/v1/runs/[runId]/workspace/route')
    const claims = await import('@/app/api/v1/runs/[runId]/claims/route')
    const delegations = await import('@/app/api/v1/runs/[runId]/delegations/route')
    const debrief = await import('@/app/api/v1/runs/[runId]/debrief/route')
    const record = await import('@/app/api/v1/runs/[runId]/record/route')
    const recordExport = await import('@/app/api/v1/runs/[runId]/record/export/route')
    const readiness = await import('@/app/api/v1/runs/[runId]/readiness/route')
    const turn = await import('@/app/api/v1/runs/[runId]/turn/route')
    const defense = await import('@/app/api/v1/runs/[runId]/defense/route')
    const exportsList = await import('@/app/api/v1/runs/[runId]/exports/route')
    const replay = await import('@/app/api/v1/review/runs/[runId]/route')
    const assignment = await import('@/app/api/v1/assignments/[assignmentId]/route')
    const assignmentRunsRoute = await import('@/app/api/v1/assignments/[assignmentId]/runs/route')
    const assignmentExports = await import('@/app/api/v1/assignments/[assignmentId]/exports/route')
    const sectionMembers = await import('@/app/api/v1/sections/[sectionId]/members/route')
    const sectionRuns = await import('@/app/api/v1/review/sections/[sectionId]/runs/route')
    const courseDetail = await import('@/app/api/v1/courses/[courseId]/route')
    assignmentRuns = assignmentRunsRoute.GET

    runReads = (runId) => {
      const params = { runId }
      return [
        { name: 'run', handler: runDetail.GET, path: `/runs/${runId}`, params },
        { name: 'trace', handler: trace.GET, path: `/runs/${runId}/trace`, params },
        { name: 'workspace', handler: workspace.GET, path: `/runs/${runId}/workspace`, params },
        { name: 'claims', handler: claims.GET, path: `/runs/${runId}/claims`, params },
        {
          name: 'delegations',
          handler: delegations.GET,
          path: `/runs/${runId}/delegations`,
          params,
        },
        { name: 'debrief', handler: debrief.GET, path: `/runs/${runId}/debrief`, params },
        { name: 'record', handler: record.GET, path: `/runs/${runId}/record`, params },
        {
          name: 'record export',
          handler: recordExport.GET,
          path: `/runs/${runId}/record/export`,
          params,
        },
        { name: 'readiness', handler: readiness.GET, path: `/runs/${runId}/readiness`, params },
        { name: 'turn', handler: turn.GET, path: `/runs/${runId}/turn`, params },
        { name: 'defense', handler: defense.GET, path: `/runs/${runId}/defense`, params },
        { name: 'exports', handler: exportsList.GET, path: `/runs/${runId}/exports`, params },
        { name: 'replay', handler: replay.GET, path: `/review/runs/${runId}`, params },
      ]
    }

    courseReads = (fixture, course, runId) => [
      { name: 'run', handler: runDetail.GET, path: `/runs/${runId}`, params: { runId } },
      { name: 'replay', handler: replay.GET, path: `/review/runs/${runId}`, params: { runId } },
      {
        name: 'assignment',
        handler: assignment.GET,
        path: `/assignments/${fixture.assignment.id}`,
        params: { assignmentId: fixture.assignment.id },
      },
      {
        name: 'assignment runs',
        handler: assignmentRunsRoute.GET,
        path: `/assignments/${fixture.assignment.id}/runs`,
        params: { assignmentId: fixture.assignment.id },
      },
      {
        name: 'assignment exports',
        handler: assignmentExports.GET,
        path: `/assignments/${fixture.assignment.id}/exports`,
        params: { assignmentId: fixture.assignment.id },
      },
      {
        name: 'section roster',
        handler: sectionMembers.GET,
        path: `/sections/${fixture.assignment.sectionId}/members`,
        params: { sectionId: fixture.assignment.sectionId },
      },
      {
        // D-710: the one section read that used to answer 403 across tenants, confirming the id.
        name: 'section runs for review',
        handler: sectionRuns.GET,
        path: `/review/sections/${fixture.assignment.sectionId}/runs`,
        params: { sectionId: fixture.assignment.sectionId },
      },
      {
        name: 'course',
        handler: courseDetail.GET,
        path: `/courses/${course}`,
        params: { courseId: course },
      },
    ]
  })

  /** What a refusal must not carry: the other person, their run, and the shape of anything else. */
  function expectNotFoundAndNothingElse(read: Read, called: Called, secrets: string[]): void {
    expect([read.name, called.status], `${read.name} status`).toEqual([read.name, 404])
    expect([read.name, errorOf(called).code]).toEqual([read.name, 'NOT_FOUND'])
    // The envelope, and only the envelope (07 §1): no `items`, no `run`, nothing beside `error`.
    expect(Object.keys(called.body as object)).toEqual(['error'])
    for (const secret of secrets) {
      expect(called.text, `${read.name} leaks ${secret}`).not.toContain(secret)
    }
  }

  it('student A gets 404 for every read of student B’s run, with none of B in the answer', async () => {
    const a = await session(fx.studentUser.id, fx.orgId)
    const secrets = [runB, fx.classmate.name, fx.classmate.email]
    for (const read of runReads(runB)) {
      const called = await call(read.handler, { path: read.path, session: a, params: read.params })
      expectNotFoundAndNothingElse(read, called, secrets)
    }
  })

  it('and student A reads their own run at the same addresses (the control)', async () => {
    const a = await session(fx.studentUser.id, fx.orgId)
    for (const read of runReads(runA)) {
      const called = await call(read.handler, { path: read.path, session: a, params: read.params })
      // The replay and the course-export history are the faculty's, and the run's own student is
      // refused them and told so (08 §4; `requireRunReviewer` answers the owner FORBIDDEN because
      // they know the run exists — the classmate above got NOT_FOUND for the same two).
      if (read.name === 'replay' || read.name === 'exports') {
        expect([read.name, called.status, errorOf(called).code]).toEqual([
          read.name,
          403,
          'FORBIDDEN',
        ])
        continue
      }
      // Everything else is the student's own: an answer, or a state refusal (409) of a run that is
      // scored but not confirmed — never a refusal of existence.
      expect([read.name, [401, 403, 404].includes(called.status)]).toEqual([read.name, false])
    }
  })

  it('student A may read their own assignment but not its run list, which carries B’s run', async () => {
    const a = await session(fx.studentUser.id, fx.orgId)
    const called = await call(assignmentRuns, {
      path: `/assignments/${fx.assignment.id}/runs`,
      session: a,
      params: { assignmentId: fx.assignment.id },
    })
    // The assignment is A's own — `GET /assignments/{id}` answers them 200 — so the refusal of its
    // run list is a permission (FORBIDDEN) rather than a denial of existence; what matters here is
    // that no row of it, and no classmate, comes back.
    expect([403, 404]).toContain(called.status)
    expect(Object.keys(called.body as object)).toEqual(['error'])
    expect(called.text).not.toContain(runB)
    expect(called.text).not.toContain(fx.classmate.name)
  })

  it('an instructor of course X gets 404 for a run, assignment, roster, run list and course of course Y', async () => {
    const instructorX = await session(fx.instructor.id, fx.orgId)
    const secrets = [runB, fy.student.name, fy.student.email, fy.instructor.name]
    // Institution Y's student has a run too, so the run reads are answered about a real one.
    const runY = await scoredRun(fy)
    for (const read of courseReads(fy, courseY, runY)) {
      const called = await call(read.handler, {
        path: read.path,
        session: instructorX,
        params: read.params,
      })
      expectNotFoundAndNothingElse(read, called, [...secrets, runY])
    }
  })

  it('and reads their own course’s things at the same addresses (the control)', async () => {
    const instructorX = await session(fx.instructor.id, fx.orgId)
    for (const read of courseReads(fx, courseX, runB)) {
      const called = await call(read.handler, {
        path: read.path,
        session: instructorX,
        params: read.params,
      })
      expect([read.name, called.status]).toEqual([read.name, 200])
    }
  })

  it('an unauthenticated caller is 401 on every one of them', async () => {
    for (const read of [...runReads(runB), ...courseReads(fx, courseX, runB)]) {
      const called = await call(read.handler, {
        path: read.path,
        session: ANONYMOUS,
        params: read.params,
      })
      expect([read.name, called.status]).toEqual([read.name, 401])
      expect(errorOf(called).code).toBe('UNAUTHENTICATED')
    }
  })
})

// ---------------------------------------------------------------------------------------------
// (c) immutability after the lock
// ---------------------------------------------------------------------------------------------

describe('immutability after the lock (08 §4, 10 §9, FR-102, FR-115, D-085)', () => {
  /** Stand-in `element_id` for a singleton element (`scenarios/schema.ts` `SINGLETON_ELEMENT_ID`). */
  const SINGLETON_ELEMENT_ID = '00000000-0000-0000-0000-000000000000'

  /** An answer that names a document and a number, so no follow-up is drawn (D-031). */
  const SOURCED = {
    text: 'From the quarterly acquisition cohort table, dated 15 July 2026.',
    durationMs: 21_000,
  }

  let routes: Record<
    | 'brief'
    | 'briefSignals'
    | 'frame'
    | 'lock'
    | 'stance'
    | 'openDocument'
    | 'addendum'
    | 'turnResponse'
    | 'defenseAnswer'
    | 'defenseComplete'
    | 'element',
    RouteHandler
  >

  beforeAll(async () => {
    routes = {
      brief: (await import('@/app/api/v1/runs/[runId]/brief/route')).PUT,
      briefSignals: (await import('@/app/api/v1/runs/[runId]/brief/signals/route')).POST,
      frame: (await import('@/app/api/v1/runs/[runId]/frame/route')).POST,
      lock: (await import('@/app/api/v1/runs/[runId]/lock/route')).POST,
      stance: (await import('@/app/api/v1/runs/[runId]/claims/[claimId]/stance/route')).PUT,
      openDocument: (await import('@/app/api/v1/runs/[runId]/documents/[documentId]/open/route'))
        .POST,
      addendum: (await import('@/app/api/v1/runs/[runId]/addendum/route')).POST,
      turnResponse: (await import('@/app/api/v1/runs/[runId]/turn/response/route')).POST,
      defenseAnswer: (
        await import('@/app/api/v1/runs/[runId]/defense/questions/[runQuestionId]/answer/route')
      ).POST,
      defenseComplete: (await import('@/app/api/v1/runs/[runId]/defense/complete/route')).POST,
      element: (
        await import('@/app/api/v1/package-versions/[versionId]/elements/[elementType]/[elementId]/route')
      ).PATCH,
    }
  })

  /** The whole of what the lock froze, as written. */
  async function lockedRecord(runId: string) {
    return {
      run: await rowsOf('runs', 'id', runId),
      brief: await rowsOf('run_briefs', 'run_id', runId),
      frames: await rowsOf('run_frames', 'run_id', runId),
      claims: await rowsOf('run_claims', 'run_id', runId),
      addenda: await rowsOf('run_addenda', 'run_id', runId),
      turnResponses: await rowsOf('run_turn_responses', 'run_id', runId),
      documentOpens: await rowsOf('run_document_opens', 'run_id', runId),
      events: await rowsOf('run_events', 'run_id', runId),
    }
  }

  async function defenseRecord(runId: string) {
    const answers = await testSql<{ row: string }[]>`
      select to_jsonb(a)::text as row
        from run_defense_answers a
        join run_defense_questions q on q.id = a.run_defense_question_id
       where q.run_id = ${runId}
       order by 1`
    return {
      run: await rowsOf('runs', 'id', runId),
      questions: await rowsOf('run_defense_questions', 'run_id', runId),
      answers: answers.map((entry) => entry.row),
      events: await rowsOf('run_events', 'run_id', runId),
    }
  }

  /** A run at `decision_locked`: the acts `runToDefenseComplete` makes up to and including the lock. */
  async function lockedRun(fixture: AssistantFixture): Promise<string> {
    const runs = await import('@/server/modules/runs')
    const reliance = await import('@/server/modules/reliance')
    const runId = await runInWorking(fixture)
    await runs.openDocument(fixture.student, runId, fixture.documentId('D5'))
    await delegate(fixture, runId, 'What is the premium payback?')
    const c1 = fixture.claimId(claimByKey('C1').key)
    await reliance.setStance(fixture.student, runId, c1, 'verify')
    await reliance.runAction(fixture.student, runId, c1, 'source_trace')
    await reliance.setStance(fixture.student, runId, c1, 'challenge')
    await runs.lockDecision(fixture.student, runId, BRIEF)
    return runId
  }

  /** Delivers the Turn, stances its window and files the response: `turn_locked`, then `defense_pending`. */
  async function respondedRun(fixture: AssistantFixture, runId: string): Promise<void> {
    const runs = await import('@/server/modules/runs')
    const reliance = await import('@/server/modules/reliance')
    await advanceClock(fixture, runId, FIXTURE.version.turnDelaySeconds * 1000 + 2_000)
    for (const claim of await reliance.listRunClaims(fixture.student, runId)) {
      if (claim.inTurnWindow && claim.stance === null) {
        await reliance.setStance(fixture.student, runId, claim.id, 'verify')
      }
    }
    await runs.respondToTurn(fixture.student, runId, TURN_RESPONSE)
  }

  it('refuses the brief, the frame, a second lock and a stance once the decision is locked, and changes nothing', async () => {
    const fixture = await setupAssistantFixture('authz-locked')
    const runId = await lockedRun(fixture)
    const student = await session(fixture.studentUser.id, fixture.orgId)
    const c1 = fixture.claimId(claimByKey('C1').key)
    const before = await lockedRecord(runId)
    expect(before.brief).toHaveLength(1)
    expect(before.frames).toHaveLength(1)

    const brief = await call(routes.brief, {
      method: 'PUT',
      path: `/runs/${runId}/brief`,
      session: student,
      params: { runId },
      body: { recommendation: 'Move the whole budget to premium.' },
    })
    expect([brief.status, errorOf(brief).code]).toEqual([409, 'RUN_LOCKED'])

    const signal = await call(routes.briefSignals, {
      method: 'POST',
      path: `/runs/${runId}/brief/signals`,
      session: student,
      params: { runId },
      body: { opened: true },
    })
    expect([signal.status, errorOf(signal).code]).toEqual([409, 'RUN_LOCKED'])

    const frame = await call(routes.frame, {
      method: 'POST',
      path: `/runs/${runId}/frame`,
      session: student,
      params: { runId },
      body: {
        decision: 'Whether to move the whole budget to the premium tier at once',
        assumptions: ['Retention is fine', 'Payback is fine', 'Cost is fine'],
        position: 'Move it all now',
        confidence: 95,
      },
    })
    expect([frame.status, errorOf(frame).code]).toEqual([409, 'ILLEGAL_TRANSITION'])
    expect(errorOf(frame).details).toMatchObject({ from: 'decision_locked' })

    const lock = await call(routes.lock, {
      method: 'POST',
      path: `/runs/${runId}/lock`,
      session: student,
      params: { runId },
      body: { ...BRIEF, recommendation: 'Move the whole budget to premium.' },
    })
    expect([lock.status, errorOf(lock).code]).toEqual([409, 'RUN_LOCKED'])

    // A stance outside the Turn window: the run is between the lock and the delivery, and the
    // claims are closed with the room (`reliance.relianceNotWritable`).
    const stance = await call(routes.stance, {
      method: 'PUT',
      path: `/runs/${runId}/claims/${c1}/stance`,
      session: student,
      params: { runId, claimId: c1 },
      body: { stance: 'accept' },
    })
    expect([stance.status, errorOf(stance).code]).toEqual([409, 'RUN_LOCKED'])
    expect(errorOf(stance).details).toEqual({ state: 'decision_locked' })

    const opened = await call(routes.openDocument, {
      method: 'POST',
      path: `/runs/${runId}/documents/${fixture.documentId('D3')}/open`,
      session: student,
      params: { runId, documentId: fixture.documentId('D3') },
    })
    expect([opened.status, errorOf(opened).code]).toEqual([409, 'RUN_LOCKED'])

    expect(await lockedRecord(runId)).toEqual(before)
  })

  it('files the Turn response once: a second response, a stance and an addendum are refused and nothing changes', async () => {
    const fixture = await setupAssistantFixture('authz-turn')
    const runId = await lockedRun(fixture)
    await respondedRun(fixture, runId)
    const student = await session(fixture.studentUser.id, fixture.orgId)
    const c1 = fixture.claimId(claimByKey('C1').key)
    const before = await lockedRecord(runId)
    expect(before.turnResponses).toHaveLength(1)
    // The response moved the run past the window, and the refusal names the state it is in now.
    const state = await stateOf(runId)
    expect(['turn_locked', 'defense_pending']).toContain(state)

    const again = await call(routes.turnResponse, {
      method: 'POST',
      path: `/runs/${runId}/turn/response`,
      session: student,
      params: { runId },
      body: { ...TURN_RESPONSE, response: 'reverse' },
    })
    expect([again.status, errorOf(again).code]).toEqual([409, 'TURN_NOT_OPEN'])
    expect(errorOf(again).details).toEqual({ state })

    const stance = await call(routes.stance, {
      method: 'PUT',
      path: `/runs/${runId}/claims/${c1}/stance`,
      session: student,
      params: { runId, claimId: c1 },
      body: { stance: 'accept' },
    })
    expect([stance.status, errorOf(stance).code]).toEqual([409, 'RUN_LOCKED'])

    // The addendum is the one write the lock leaves open, and only until the Turn is locked.
    const addendum = await call(routes.addendum, {
      method: 'POST',
      path: `/runs/${runId}/addendum`,
      session: student,
      params: { runId },
      body: { text: 'A note after the Turn.' },
    })
    expect([addendum.status, errorOf(addendum).code]).toEqual([409, 'ILLEGAL_TRANSITION'])

    expect(await lockedRecord(runId)).toEqual(before)
  })

  it('answers each defense question once and finishes the defense once; afterwards every answer is refused', async () => {
    const fixture = await setupAssistantFixture('authz-defense')
    const defense = await import('@/server/modules/defense')
    const runId = await lockedRun(fixture)
    await respondedRun(fixture, runId)
    const student = await session(fixture.studentUser.id, fixture.orgId)

    let first: string | null = null
    for (let round = 0; round < 40; round += 1) {
      const view = await defense.openDefense(fixture.student, runId)
      const next = view.questions.find((question) => !question.answered)
      if (!next) break
      first ??= next.runQuestionId
      await defense.answerQuestion(fixture.student, runId, next.runQuestionId, SOURCED)
    }
    if (!first) throw new Error('the defense drew no questions')

    // Still `defense_pending`: an answered question does not take a second answer.
    const answered = await defenseRecord(runId)
    expect(answered.answers.length).toBeGreaterThan(0)
    const twice = await call(routes.defenseAnswer, {
      method: 'POST',
      path: `/runs/${runId}/defense/questions/${first}/answer`,
      session: student,
      params: { runId, runQuestionId: first },
      body: { text: 'A different answer, after the fact.', durationMs: 1_000 },
    })
    expect([twice.status, errorOf(twice).code]).toEqual([409, 'QUESTION_ALREADY_ANSWERED'])
    expect(await defenseRecord(runId)).toEqual(answered)

    const completed = await call(routes.defenseComplete, {
      method: 'POST',
      path: `/runs/${runId}/defense/complete`,
      session: student,
      params: { runId },
    })
    expect(completed.status).toBe(200)
    expect(completed.body).toMatchObject({ state: 'defense_complete' })

    // The completion queued `score_run`, and outside a Next request scope a job runs inline
    // (`src/server/jobs/enqueue.ts`), so by the time the response is read the run has been scored:
    // the record below is what the pipeline wrote, and the refusals must leave *that* alone too.
    const after = await defenseRecord(runId)
    const state = await stateOf(runId)
    expect(['defense_complete', 'scored']).toContain(state)

    const late = await call(routes.defenseAnswer, {
      method: 'POST',
      path: `/runs/${runId}/defense/questions/${first}/answer`,
      session: student,
      params: { runId, runQuestionId: first },
      body: { text: 'An answer after the defense was finished.', durationMs: 1_000 },
    })
    expect([late.status, errorOf(late).code]).toEqual([409, 'DEFENSE_NOT_OPEN'])
    expect(errorOf(late).details).toEqual({ state })

    const again = await call(routes.defenseComplete, {
      method: 'POST',
      path: `/runs/${runId}/defense/complete`,
      session: student,
      params: { runId },
    })
    expect([again.status, errorOf(again).code]).toEqual([409, 'DEFENSE_NOT_OPEN'])

    expect(await defenseRecord(runId)).toEqual(after)
  })

  it('refuses every element write on a confirmed package version with VERSION_FROZEN, and the rows stand', async () => {
    const instructor = await session(fx.instructor.id, fx.orgId)
    const documentId = fx.documentId('D5')
    const before = {
      version: await rowsOf('scenario_package_versions', 'id', fx.versionId),
      documents: await rowsOf('scenario_documents', 'package_version_id', fx.versionId),
      claims: await rowsOf('scenario_claims', 'package_version_id', fx.versionId),
    }
    expect(before.version[0]).toContain('"status": "confirmed"')

    const brief = await call(routes.element, {
      method: 'PATCH',
      path: `/package-versions/${fx.versionId}/elements/brief/${SINGLETON_ELEMENT_ID}`,
      session: instructor,
      params: { versionId: fx.versionId, elementType: 'brief', elementId: SINGLETON_ELEMENT_ID },
      body: { brief: 'A brief rewritten after confirmation.' },
    })
    expect([brief.status, errorOf(brief).code]).toEqual([409, 'VERSION_FROZEN'])

    const document = await call(routes.element, {
      method: 'PATCH',
      path: `/package-versions/${fx.versionId}/elements/document/${documentId}`,
      session: instructor,
      params: { versionId: fx.versionId, elementType: 'document', elementId: documentId },
      body: { title: 'A document retitled after confirmation' },
    })
    expect([document.status, errorOf(document).code]).toEqual([409, 'VERSION_FROZEN'])

    expect({
      version: await rowsOf('scenario_package_versions', 'id', fx.versionId),
      documents: await rowsOf('scenario_documents', 'package_version_id', fx.versionId),
      claims: await rowsOf('scenario_claims', 'package_version_id', fx.versionId),
    }).toEqual(before)
  })
})
