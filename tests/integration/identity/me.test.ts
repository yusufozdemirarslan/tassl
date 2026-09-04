// Step 3.3 — the `/api/v1/me` endpoints (SYS-003, SYS-004, 07-api-spec.md §3, 08-auth-authz.md
// §2.9). The route handlers are driven exactly as Next drives them: a Request plus the params
// promise, with the session cookie `asUser()` mints.
//
// The export limit is two an hour (08 §2.9). Under APP_ENV=test the limiter is the in-memory one
// (D-164), so the third download has to be driven through this same process to be refused.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'

type Router = typeof import('@/server/modules/identity/router')
type Factories = typeof import('@tests/factories')
type Walkthrough = Awaited<ReturnType<Factories['buildWalkthroughFixture']>>

const ROUTE_CTX = { params: Promise.resolve({}) }
const BASE = 'http://localhost/api/v1'

let router: Router
let fixture: Walkthrough
let studentHeaders: Headers
let leaverHeaders: Headers
let leaverId: string
let leaverEmail: string

type Envelope = { error: { code: string; message: string; requestId: string } }

function mutate(headers: Headers, init: RequestInit = {}): RequestInit {
  const merged = new Headers(headers)
  merged.set('x-requested-with', 'tassl')
  if (init.body) merged.set('content-type', 'application/json')
  return { ...init, headers: merged }
}

beforeAll(async () => {
  await truncateAll()
  router = await import('@/server/modules/identity/router')
  const f: Factories = await import('@tests/factories')
  fixture = await f.buildWalkthroughFixture()
  const orgId = fixture.organization.id
  studentHeaders = await asUser(fixture.student1.id, { activeOrganizationId: orgId })

  const leaver = await f.createUser('identity-leaver')
  leaverId = leaver.id
  leaverEmail = leaver.email
  await f.addMember(orgId, leaver.id, 'student')
  leaverHeaders = await asUser(leaver.id, { activeOrganizationId: orgId })
  // An invitation to the same address that nobody accepted; deletion clears it (08 §2.9).
  await testSql`
    insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
    values (${crypto.randomUUID()}, ${orgId}, ${leaverEmail}, 'student', 'pending',
      ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)}, ${fixture.instructor.id})`
})

afterAll(async () => {
  await truncateAll()
})

describe('GET /me', () => {
  it('answers with the profile, the memberships, and the capabilities', async () => {
    const res = await router.getMe(
      new Request(`${BASE}/me`, { headers: studentHeaders }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')

    const body = (await res.json()) as {
      id: string
      email: string
      platformRole: string
      activeOrganizationId: string
      memberships: { organizationId: string; name: string; role: string }[]
      capabilities: Record<string, boolean>
    }
    expect(body.id).toBe(fixture.student1.id)
    expect(body.email).toBe(fixture.student1.email)
    expect(body.platformRole).toBe('none')
    expect(body.activeOrganizationId).toBe(fixture.organization.id)
    expect(body.memberships).toEqual([
      {
        organizationId: fixture.organization.id,
        name: fixture.organization.name,
        slug: fixture.organization.slug,
        role: 'student',
        joinedAt: expect.any(String) as unknown as string,
      },
    ])
    expect(body.capabilities.canTakeRuns).toBe(true)
    expect(body.capabilities.canReviewRuns).toBe(false)
  })

  it('refuses an anonymous request', async () => {
    const res = await router.getMe(new Request(`${BASE}/me`), ROUTE_CTX)
    expect(res.status).toBe(401)
    expect(((await res.json()) as Envelope).error.code).toBe('UNAUTHENTICATED')
  })
})

describe('PATCH /me', () => {
  it('updates the name and answers with the fresh view', async () => {
    const res = await router.updateMe(
      new Request(
        `${BASE}/me`,
        mutate(studentHeaders, { method: 'PATCH', body: JSON.stringify({ name: 'S. One' }) }),
      ),
      ROUTE_CTX,
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { name: string }).name).toBe('S. One')

    const [row] = await testSql<{ name: string }[]>`
      select name from "user" where id = ${fixture.student1.id}`
    expect(row?.name).toBe('S. One')
  })

  it('rejects an empty name', async () => {
    const res = await router.updateMe(
      new Request(
        `${BASE}/me`,
        mutate(studentHeaders, { method: 'PATCH', body: JSON.stringify({ name: '  ' }) }),
      ),
      ROUTE_CTX,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_ERROR')
  })

  it('refuses a cookie-authenticated write without X-Requested-With (08 §2.7)', async () => {
    const headers = new Headers(studentHeaders)
    headers.set('content-type', 'application/json')
    const res = await router.updateMe(
      new Request(`${BASE}/me`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name: 'No CSRF header' }),
      }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(403)
  })
})

describe('GET /me/assignments and GET /me/runs', () => {
  it('lists the assignments of the sections the student is in', async () => {
    const res = await router.listMyAssignments(
      new Request(`${BASE}/me/assignments`, { headers: studentHeaders }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: { assignmentId: string; label: string; latestRun: unknown; sectionId: string }[]
      nextCursor: string | null
    }
    expect(body.nextCursor).toBeNull()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.assignmentId).toBe(fixture.assignment.id)
    expect(body.items[0]?.sectionId).toBe(fixture.section.id)
    expect(body.items[0]?.latestRun).toBeNull()
  })

  it('answers with an empty page of runs before any run exists', async () => {
    const res = await router.listMyRuns(
      new Request(`${BASE}/me/runs`, { headers: studentHeaders }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [], nextCursor: null })
  })

  it('rejects an unknown query parameter', async () => {
    const res = await router.listMyRuns(
      new Request(`${BASE}/me/runs?state=working&sneaky=1`, { headers: studentHeaders }),
      ROUTE_CTX,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_ERROR')
  })
})

describe('POST /me/export', () => {
  const exportOnce = async (headers: Headers): Promise<Response> =>
    router.exportMe(
      new Request(`${BASE}/me/export`, mutate(headers, { method: 'POST' })),
      ROUTE_CTX,
    )

  it('downloads the profile and the memberships as a file', async () => {
    const res = await exportOnce(studentHeaders)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="tassl-my-data.json"')

    const body = (await res.json()) as {
      exportedAt: string
      profile: { id: string; email: string }
      memberships: { organizationId: string }[]
      sectionMemberships: { sectionId: string; role: string }[]
      runs: unknown[]
      notifications: unknown[]
      auditLog: unknown[]
    }
    expect(body.profile.id).toBe(fixture.student1.id)
    expect(body.profile.email).toBe(fixture.student1.email)
    expect(body.memberships[0]?.organizationId).toBe(fixture.organization.id)
    expect(body.sectionMemberships).toEqual([
      expect.objectContaining({ sectionId: fixture.section.id, role: 'student' }),
    ])
    expect(body.runs).toEqual([])
    expect(Date.parse(body.exportedAt)).not.toBeNaN()
  })

  it('refuses the third download of the hour with EXPORT_RATE_LIMITED', async () => {
    const second = await exportOnce(studentHeaders)
    expect(second.status).toBe(200)

    const third = await exportOnce(studentHeaders)
    expect(third.status).toBe(429)
    expect(((await third.json()) as Envelope).error.code).toBe('EXPORT_RATE_LIMITED')
  })

  it('counts the limit per account, so another person still downloads', async () => {
    const res = await exportOnce(leaverHeaders)
    expect(res.status).toBe(200)
  })
})

describe('DELETE /me', () => {
  it('answers 204, soft-deletes, drops the memberships, and audits the deletion', async () => {
    const res = await router.deleteMe(
      new Request(`${BASE}/me`, mutate(leaverHeaders, { method: 'DELETE' })),
      ROUTE_CTX,
    )
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')

    const [row] = await testSql<{ deleted_at: Date | null }[]>`
      select deleted_at from "user" where id = ${leaverId}`
    expect(row?.deleted_at).toBeInstanceOf(Date)

    const members = await testSql`select 1 from member where user_id = ${leaverId}`
    expect(members).toHaveLength(0)

    const sessions = await testSql`select 1 from session where user_id = ${leaverId}`
    expect(sessions).toHaveLength(0)

    const audit = await testSql<{ action: string; organization_id: string | null }[]>`
      select action, organization_id from audit_logs where actor_id = ${leaverId}`
    expect(audit).toEqual([{ action: 'account.delete', organization_id: fixture.organization.id }])
  })

  it('treats the deleted account as signed out', async () => {
    const res = await router.getMe(new Request(`${BASE}/me`, { headers: leaverHeaders }), ROUTE_CTX)
    expect(res.status).toBe(401)
  })

  it('leaves no pending invitation addressed to the deleted account', async () => {
    const rows = await testSql`select 1 from invitation where email = ${leaverEmail}`
    expect(rows).toHaveLength(0)
  })
})
