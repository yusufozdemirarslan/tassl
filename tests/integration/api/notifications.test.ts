// Step 10.4 — the three notification endpoints of docs/tech/07-api-spec.md §9, called as real
// `Request`s through the handlers `src/app/api/v1/notifications/**/route.ts` export (SYS-010).
//
// The rows are `S` in 08-auth-authz.md §4 — any signed-in seat, over their own rows and nobody
// else's — so the matrix cells worth a database are the ones where "their own" is decided:
//
//   * anonymous is 401 on all three;
//   * the list answers the actor's own notifications and no one else's, cursor-paginated;
//   * `POST /notifications/{id}/read` on somebody else's id is **404**, not 403: a refusal that says
//     "you may not" would say the notification exists;
//   * both mutations answer 204 with no body, and refuse a cookie-authenticated call without the
//     CSRF header (08 §2.7).
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'

type Factories = typeof import('@tests/factories')
type ListRoute = typeof import('@/app/api/v1/notifications/route')
type ReadRoute = typeof import('@/app/api/v1/notifications/[id]/read/route')
type ReadAllRoute = typeof import('@/app/api/v1/notifications/read-all/route')

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

let f: Factories
let listRoute: ListRoute
let readRoute: ReadRoute
let readAllRoute: ReadAllRoute
let orgId: string
let student: { id: string; email: string }
let classmate: { id: string; email: string }

type Called = { status: number; body: Record<string, unknown> | null }

async function call(
  handler: RouteHandler,
  options: {
    method?: string
    path: string
    session?: Headers | null
    params?: Record<string, string>
    csrf?: boolean
  },
): Promise<Called> {
  const method = options.method ?? 'GET'
  const headers = new Headers(options.session ?? undefined)
  if (method !== 'GET' && options.csrf !== false) headers.set('x-requested-with', 'tassl')
  const request = new Request(`http://localhost:3000/api/v1${options.path}`, { method, headers })
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) })
  const text = await response.text()
  return { status: response.status, body: text === '' ? null : (JSON.parse(text) as never) }
}

const codeOf = (called: Called): unknown =>
  (called.body?.error as { code?: unknown } | undefined)?.code

/** Rows written straight to the table: the writers are the scoring job's, tested in their own suite. */
async function seed(userId: string, count: number): Promise<string[]> {
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) {
    const [row] = await testSql<{ id: string }[]>`
      insert into notifications (user_id, organization_id, type, title, body, link, payload)
      values (${userId}, ${orgId}, 'run_scored', ${`Run ${String(index)} scored`},
              'The draft bands are with your instructor.', '/runs/abc', '{}'::jsonb)
      returning id`
    if (row) ids.push(row.id)
  }
  return ids
}

beforeEach(async () => {
  await truncateAll()
  f = (await import('@tests/factories')) as Factories
  listRoute = await import('@/app/api/v1/notifications/route')
  readRoute = await import('@/app/api/v1/notifications/[id]/read/route')
  readAllRoute = await import('@/app/api/v1/notifications/read-all/route')

  const { organization } = await f.createInstitution('api-notifications')
  orgId = organization.id
  student = await f.createUser('api-notifications-student')
  classmate = await f.createUser('api-notifications-classmate')
  await f.addMember(orgId, student.id, 'student')
  await f.addMember(orgId, classmate.id, 'student')
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

describe('GET /notifications', () => {
  it('answers 401 without a session', async () => {
    const called = await call(listRoute.GET, { path: '/notifications', session: null })
    expect(called.status).toBe(401)
    expect(codeOf(called)).toBe('UNAUTHENTICATED')
  })

  it('answers the actor’s own notifications, newest first, with a cursor', async () => {
    await seed(student.id, 3)
    await seed(classmate.id, 2)
    const session = await asUser(student.id, { activeOrganizationId: orgId })

    const page = await call(listRoute.GET, { path: '/notifications?limit=2', session })
    expect(page.status).toBe(200)
    const items = page.body?.items as { id: string; title: string }[]
    expect(items).toHaveLength(2)
    expect(page.body?.nextCursor).not.toBeNull()

    const next = await call(listRoute.GET, {
      path: `/notifications?limit=2&cursor=${encodeURIComponent(String(page.body?.nextCursor))}`,
      session,
    })
    expect((next.body?.items as unknown[]).length).toBe(1)
    expect(next.body?.nextCursor).toBeNull()
  })

  // 07 §9 publishes `?cursor&limit&unread?`, and a query string carries no booleans: the schema
  // declared `z.boolean()`, so `?unread=true` was a 400 and the published parameter could not be
  // sent at all (D-484). The rows are seeded unread, so `unread=false` is the half that proves the
  // value is read rather than the key merely being tolerated.
  it('filters on the published `unread` parameter, in both spellings (D-484)', async () => {
    const [read = ''] = await seed(student.id, 1)
    await seed(student.id, 2)
    await testSql`update notifications set read_at = now() where id = ${read}`
    const session = await asUser(student.id, { activeOrganizationId: orgId })

    const unread = await call(listRoute.GET, { path: '/notifications?unread=true', session })
    expect(unread.status).toBe(200)
    expect(unread.body?.items).toHaveLength(2)

    const all = await call(listRoute.GET, { path: '/notifications?unread=false', session })
    expect(all.status).toBe(200)
    expect(all.body?.items).toHaveLength(3)

    // And a value that is neither is a validation error rather than a silently truthy filter, which
    // is what `z.coerce.boolean()` would have made of it (`Boolean('false') === true`).
    const bad = await call(listRoute.GET, { path: '/notifications?unread=maybe', session })
    expect(bad.status).toBe(400)
    expect(codeOf(bad)).toBe('VALIDATION_ERROR')
  })

  it('rejects a query parameter the endpoint does not declare', async () => {
    const session = await asUser(student.id, { activeOrganizationId: orgId })
    const called = await call(listRoute.GET, { path: '/notifications?userId=someone', session })
    expect(called.status).toBe(400)
    expect(codeOf(called)).toBe('VALIDATION_ERROR')
  })
})

describe('POST /notifications/{id}/read', () => {
  it('answers 204 and stamps read_at', async () => {
    const [id = ''] = await seed(student.id, 1)
    const session = await asUser(student.id, { activeOrganizationId: orgId })

    const called = await call(readRoute.POST, {
      method: 'POST',
      path: `/notifications/${id}/read`,
      session,
      params: { id },
    })
    expect(called.status).toBe(204)
    expect(called.body).toBeNull()

    const [row] = await testSql<{ read_at: Date | null }[]>`
      select read_at from notifications where id = ${id}`
    expect(row?.read_at).not.toBeNull()
  })

  it('answers 404 for somebody else’s notification, never 403', async () => {
    const [id = ''] = await seed(classmate.id, 1)
    const session = await asUser(student.id, { activeOrganizationId: orgId })

    const called = await call(readRoute.POST, {
      method: 'POST',
      path: `/notifications/${id}/read`,
      session,
      params: { id },
    })
    expect(called.status).toBe(404)
    expect(codeOf(called)).toBe('NOT_FOUND')

    const [row] = await testSql<{ read_at: Date | null }[]>`
      select read_at from notifications where id = ${id}`
    expect(row?.read_at).toBeNull()
  })

  it('refuses a cookie-authenticated mutation with no CSRF header (08 §2.7)', async () => {
    const [id = ''] = await seed(student.id, 1)
    const session = await asUser(student.id, { activeOrganizationId: orgId })

    const called = await call(readRoute.POST, {
      method: 'POST',
      path: `/notifications/${id}/read`,
      session,
      params: { id },
      csrf: false,
    })
    expect(called.status).toBe(403)
    expect(codeOf(called)).toBe('FORBIDDEN')
  })

  it('answers 401 without a session and 400 for an id that is not a uuid', async () => {
    const [id = ''] = await seed(student.id, 1)
    expect(
      (
        await call(readRoute.POST, {
          method: 'POST',
          path: `/notifications/${id}/read`,
          session: null,
          params: { id },
        })
      ).status,
    ).toBe(401)

    const session = await asUser(student.id, { activeOrganizationId: orgId })
    const bad = await call(readRoute.POST, {
      method: 'POST',
      path: '/notifications/not-a-uuid/read',
      session,
      params: { id: 'not-a-uuid' },
    })
    expect(bad.status).toBe(400)
    expect(codeOf(bad)).toBe('VALIDATION_ERROR')
  })
})

describe('POST /notifications/read-all', () => {
  it('answers 204 and marks only the actor’s own rows', async () => {
    await seed(student.id, 2)
    await seed(classmate.id, 1)
    const session = await asUser(student.id, { activeOrganizationId: orgId })

    const called = await call(readAllRoute.POST, {
      method: 'POST',
      path: '/notifications/read-all',
      session,
    })
    expect(called.status).toBe(204)

    const rows = await testSql<{ user_id: string; read_at: Date | null }[]>`
      select user_id, read_at from notifications`
    for (const row of rows) {
      if (row.user_id === student.id) expect(row.read_at).not.toBeNull()
      else expect(row.read_at).toBeNull()
    }
  })

  it('answers 401 without a session', async () => {
    const called = await call(readAllRoute.POST, {
      method: 'POST',
      path: '/notifications/read-all',
      session: null,
    })
    expect(called.status).toBe(401)
    expect(codeOf(called)).toBe('UNAUTHENTICATED')
  })
})
