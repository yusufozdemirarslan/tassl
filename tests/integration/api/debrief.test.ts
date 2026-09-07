// Step 11.2 — the debrief and the mapping change as Next drives them: a real `Request` through the
// handler each `src/app/api/v1/**/route.ts` exports, with the session cookie `asUser()` mints and
// the `X-Requested-With: tassl` header every cookie-authenticated mutation carries (08 §2.7).
//
//   GET  /runs/{runId}/debrief                    the run walked in order (FR-150 to FR-155)
//   POST /runs/{runId}/debrief/answers            the two questions that close it (FR-152)
//   POST /courses/{courseId}/mapping/preview      which exported points would change (FR-206)
//   POST /courses/{courseId}/mapping              apply it and re-export (FR-206, D-095)
//
// **The seats are the point of this file.** 07 §7 gives the debrief to the run's own student *and*
// to the reviewers of its section — the one student-facing read on this surface that a reviewer
// shares, because FR-154 says they read one document — while the two questions are the student's
// alone: a reviewer who may read the whole page has no form on it. 07 §5 gives both halves of the
// mapping change to the course's instructor and to nobody else. Every row is checked against a real
// scored run rather than an empty one, because a payload assertion on an empty fixture passes
// vacuously.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'
import { findForbiddenKeys } from '@/server/auth/student-view'
import { DEBRIEF_SECTION_ORDER } from '@/server/modules/debrief'
import { scoredRun, setupAssistantFixture, type AssistantFixture } from '../review/fixture'

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

let fx: AssistantFixture
let courseId: string
let routes: {
  debrief: RouteHandler
  answers: RouteHandler
  mappingPreview: RouteHandler
  mapping: RouteHandler
}

type Called = { status: number; body: unknown }

async function call(
  handler: RouteHandler,
  options: {
    method?: string
    path: string
    session?: Headers | null
    params?: Record<string, string>
    body?: unknown
    csrf?: boolean
  },
): Promise<Called> {
  const method = options.method ?? 'GET'
  const headers = new Headers(options.session ?? undefined)
  if (method !== 'GET') {
    if (options.csrf !== false) headers.set('x-requested-with', 'tassl')
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
  ((called.body as { error?: { code?: unknown } } | null)?.error ?? {}) as { code?: unknown }

const sessionFor = (who: 'student' | 'instructor' | 'ta' | 'classmate'): Promise<Headers> =>
  asUser(fx[who].id, { activeOrganizationId: fx.orgId })

const ANSWERS = {
  stanceToChange: 'I would have verified C3 before pricing the recommendation on it.',
  doDifferently: 'Read the retention memo before opening the assistant.',
}

const DOUBLED = { novice: 2, developing: 4, proficient: 6, professional: 8 }

beforeEach(async () => {
  await truncateAll()
  routes = {
    debrief: (await import('@/app/api/v1/runs/[runId]/debrief/route')).GET,
    answers: (await import('@/app/api/v1/runs/[runId]/debrief/answers/route')).POST,
    mappingPreview: (await import('@/app/api/v1/courses/[courseId]/mapping/preview/route')).POST,
    mapping: (await import('@/app/api/v1/courses/[courseId]/mapping/route')).POST,
  }
  fx = await setupAssistantFixture('api-debrief')
  const [row] = await testSql<{ id: string }[]>`
    select c.id from courses c
      join sections s on s.course_id = c.id
      join assignments a on a.section_id = s.id
     where a.id = ${fx.assignment.id}`
  if (!row) throw new Error('the fixture assignment has no course')
  courseId = row.id
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

/** A run at `confirmed`, so both versions of the debrief can be asked for through the route. */
async function confirmedRun(): Promise<string> {
  const review = await import('@/server/modules/review')
  const runId = await scoredRun(fx)
  await review.confirmRemaining(fx.instructor, runId)
  return runId
}

// ---------------------------------------------------------------------------------------------
// GET /runs/{runId}/debrief (07 §7)
// ---------------------------------------------------------------------------------------------

describe('GET /runs/{runId}/debrief', () => {
  it('answers the run’s own student with the twelve sections in order', async () => {
    const runId = await scoredRun(fx)
    const called = await call(routes.debrief, {
      path: `/runs/${runId}/debrief`,
      session: await sessionFor('student'),
      params: { runId },
    })
    expect(called.status).toBe(200)
    const view = called.body as {
      sections: { key: string }[]
      bands: unknown[]
      labels: { version: string; viewer: string }
      questions: { canAnswer: boolean }
      doneWell: string
    }
    expect(view.sections.map((section) => section.key)).toEqual([...DEBRIEF_SECTION_ORDER])
    expect(view.bands).toHaveLength(7)
    expect(view.labels).toMatchObject({ version: 'draft', viewer: 'owner' })
    expect(view.questions.canAnswer).toBe(true)
    expect(view.doneWell.length).toBeGreaterThan(0)
  })

  it('answers a reviewer with the same document and no form (FR-154)', async () => {
    const runId = await scoredRun(fx)
    for (const seat of ['instructor', 'ta'] as const) {
      const called = await call(routes.debrief, {
        path: `/runs/${runId}/debrief`,
        session: await sessionFor(seat),
        params: { runId },
      })
      expect(called.status, seat).toBe(200)
      const view = called.body as { labels: { viewer: string }; questions: { canAnswer: boolean } }
      expect(view.labels.viewer, seat).toBe('reviewer')
      expect(view.questions.canAnswer, seat).toBe(false)
    }
  })

  it('refuses a classmate and an anonymous caller', async () => {
    const runId = await scoredRun(fx)
    const classmate = await call(routes.debrief, {
      path: `/runs/${runId}/debrief`,
      session: await sessionFor('classmate'),
      params: { runId },
    })
    expect(classmate.status).toBe(404)
    expect(errorOf(classmate).code).toBe('NOT_FOUND')

    const anonymous = await call(routes.debrief, {
      path: `/runs/${runId}/debrief`,
      session: null,
      params: { runId },
    })
    expect(anonymous.status).toBe(401)
  })

  it('serializes a payload with nothing a student may not see, on a real run', async () => {
    const runId = await confirmedRun()
    const called = await call(routes.debrief, {
      path: `/runs/${runId}/debrief`,
      session: await sessionFor('student'),
      params: { runId },
    })
    expect(called.status).toBe(200)
    // A real scored run, serialized and parsed back: the sweep is over the bytes the student gets.
    expect(JSON.stringify(called.body).length).toBeGreaterThan(2000)
    expect(findForbiddenKeys(called.body, { scored: true })).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// POST /runs/{runId}/debrief/answers (07 §7, FR-152)
// ---------------------------------------------------------------------------------------------

describe('POST /runs/{runId}/debrief/answers', () => {
  it('files both answers and moves a confirmed run to recorded', async () => {
    const runId = await confirmedRun()
    const called = await call(routes.answers, {
      method: 'POST',
      path: `/runs/${runId}/debrief/answers`,
      session: await sessionFor('student'),
      params: { runId },
      body: ANSWERS,
    })
    expect(called.status).toBe(200)
    expect((called.body as { state: string }).state).toBe('recorded')
  })

  it('refuses a reviewer: the questions are the student’s own (FR-154)', async () => {
    const runId = await confirmedRun()
    const called = await call(routes.answers, {
      method: 'POST',
      path: `/runs/${runId}/debrief/answers`,
      session: await sessionFor('instructor'),
      params: { runId },
      body: ANSWERS,
    })
    expect(called.status).toBe(404)
  })

  it('refuses a second answer, and a body over the word limit', async () => {
    const runId = await confirmedRun()
    const session = await sessionFor('student')
    await call(routes.answers, {
      method: 'POST',
      path: `/runs/${runId}/debrief/answers`,
      session,
      params: { runId },
      body: ANSWERS,
    })
    const again = await call(routes.answers, {
      method: 'POST',
      path: `/runs/${runId}/debrief/answers`,
      session: await sessionFor('student'),
      params: { runId },
      body: ANSWERS,
    })
    expect(again.status).toBe(409)
    expect(errorOf(again).code).toBe('DEBRIEF_ANSWERED')

    const long = await call(routes.answers, {
      method: 'POST',
      path: `/runs/${runId}/debrief/answers`,
      session: await sessionFor('student'),
      params: { runId },
      body: { stanceToChange: 'word '.repeat(120), doDifferently: 'Read the memo first.' },
    })
    expect(long.status).toBe(400)
    expect(errorOf(long).code).toBe('VALIDATION_ERROR')
  })

  it('refuses a cookie-authenticated write with no CSRF header (08 §2.7)', async () => {
    const runId = await confirmedRun()
    const called = await call(routes.answers, {
      method: 'POST',
      path: `/runs/${runId}/debrief/answers`,
      session: await sessionFor('student'),
      params: { runId },
      body: ANSWERS,
      csrf: false,
    })
    expect(called.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------------------------
// The mapping change (07 §5, FR-206)
// ---------------------------------------------------------------------------------------------

describe('POST /courses/{courseId}/mapping/preview and /mapping', () => {
  it('previews for the course instructor and refuses every other seat', async () => {
    await confirmedRun()
    const called = await call(routes.mappingPreview, {
      method: 'POST',
      path: `/courses/${courseId}/mapping/preview`,
      session: await sessionFor('instructor'),
      params: { courseId },
      body: { mapping: DOUBLED },
    })
    expect(called.status).toBe(200)
    const preview = called.body as {
      affected: { runId: string; pointsNow: number; pointsAfter: number }[]
      changedCount: number
    }
    expect(preview.affected).toHaveLength(1)
    expect(preview.changedCount).toBe(1)
    expect(preview.affected[0]?.pointsAfter).toBeGreaterThan(preview.affected[0]?.pointsNow ?? 0)

    for (const seat of ['ta', 'student'] as const) {
      const refused = await call(routes.mappingPreview, {
        method: 'POST',
        path: `/courses/${courseId}/mapping/preview`,
        session: await sessionFor(seat),
        params: { courseId },
        body: { mapping: DOUBLED },
      })
      expect(refused.status, seat).toBe(403)
    }
  })

  it('refuses an apply that is not confirmed, and applies one that is', async () => {
    await confirmedRun()
    const unconfirmed = await call(routes.mapping, {
      method: 'POST',
      path: `/courses/${courseId}/mapping`,
      session: await sessionFor('instructor'),
      params: { courseId },
      body: { mapping: DOUBLED, confirm: false },
    })
    expect(unconfirmed.status).toBe(409)
    expect(errorOf(unconfirmed).code).toBe('MAPPING_CHANGE_UNCONFIRMED')

    const applied = await call(routes.mapping, {
      method: 'POST',
      path: `/courses/${courseId}/mapping`,
      session: await sessionFor('instructor'),
      params: { courseId },
      body: { mapping: DOUBLED, confirm: true },
    })
    expect(applied.status).toBe(200)
    expect((applied.body as { mapping: unknown }).mapping).toEqual(DOUBLED)
  })

  it('refuses a mapping that is not four positive numbers', async () => {
    const called = await call(routes.mapping, {
      method: 'POST',
      path: `/courses/${courseId}/mapping`,
      session: await sessionFor('instructor'),
      params: { courseId },
      body: {
        mapping: { novice: 0, developing: 2, proficient: 3, professional: 4 },
        confirm: true,
      },
    })
    expect(called.status).toBe(400)
    expect(errorOf(called).code).toBe('MAPPING_INVALID')
  })
})
