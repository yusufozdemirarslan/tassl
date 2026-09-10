// `POST /admin/sentry-test` (13 §4 row 7, D-708): platform admin only; answers the event id the SDK
// minted, the environment it was tagged with, and whether a DSN is set — which under the test
// environment it is not, so the answer says so instead of pretending the event travelled.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'

type Factories = typeof import('@tests/factories')
type Route = typeof import('@/app/api/v1/admin/sentry-test/route')

let f: Factories
let route: Route
let admin: { id: string }
let student: { id: string }

async function post(session: Headers | null): Promise<Response> {
  const headers = new Headers(session ?? undefined)
  headers.set('x-requested-with', 'tassl')
  return route.POST(
    new Request('http://localhost:3000/api/v1/admin/sentry-test', { method: 'POST', headers }),
    { params: Promise.resolve({}) },
  )
}

beforeEach(async () => {
  await truncateAll()
  f = (await import('@tests/factories')) as Factories
  route = await import('@/app/api/v1/admin/sentry-test/route')
  admin = await f.createUser('sentry-test-admin', { platformRole: 'admin' })
  student = await f.createUser('sentry-test-student')
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

describe('POST /admin/sentry-test', () => {
  it('sends one ops.sentry_test event for a platform admin and says whether a DSN is set', async () => {
    const response = await post(await asUser(admin.id))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      eventId: string
      environment: string
      dsnConfigured: boolean
    }
    expect(body.eventId).toMatch(/^[0-9a-f]{32}$/)
    expect(body.environment).toBe('test')
    expect(body.dsnConfigured).toBe(false)
  })

  it('refuses everyone else: 403 to a student, 401 signed out', async () => {
    expect((await post(await asUser(student.id))).status).toBe(403)
    expect((await post(null)).status).toBe(401)
  })
})
