// The error envelope under hostile input (docs/prompts/02-qa-and-guides.md C7): wrong types,
// missing fields, unknown keys, bodies that are not JSON, and a body over the handler's cap all
// answer a clean 4xx in the shared envelope — `{ error: { code, message, details?, requestId } }`
// — with no stack trace and no partial write. The route under fuzz is the platform-role change,
// chosen because it needs an admin session and validates a body, so every layer of `defineRoute`
// is between the request and the service.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'
import { MAX_JSON_BODY_BYTES } from '@/server/http/define-route'

type Factories = typeof import('@tests/factories')
type RoleRoute = typeof import('@/app/api/v1/admin/users/[userId]/platform-role/route')

type Envelope = {
  error: { code: string; message: string; details?: unknown; requestId: string }
}

let f: Factories
let roleRoute: RoleRoute
let adminSession: Headers
let target: { id: string }

async function put(raw: string, headers?: Record<string, string>): Promise<Response> {
  const h = new Headers(adminSession)
  h.set('x-requested-with', 'tassl')
  h.set('content-type', 'application/json')
  for (const [name, value] of Object.entries(headers ?? {})) h.set(name, value)
  return roleRoute.PUT(
    new Request(`http://localhost:3000/api/v1/admin/users/${target.id}/platform-role`, {
      method: 'PUT',
      headers: h,
      body: raw,
    }),
    { params: Promise.resolve({ userId: target.id }) },
  )
}

async function envelopeOf(response: Response): Promise<Envelope> {
  const body = (await response.json()) as Envelope
  expect(body.error.code).toMatch(/^[A-Z_]+$/)
  expect(body.error.message.length).toBeGreaterThan(0)
  expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/)
  expect(JSON.stringify(body)).not.toMatch(/at .*\.ts:\d+/)
  expect(JSON.stringify(body)).not.toMatch(/node_modules/)
  return body
}

async function roleOfTarget(): Promise<string> {
  const [row] = await testSql<{ platform_role: string }[]>`
    select platform_role from "user" where id = ${target.id}`
  return row?.platform_role ?? ''
}

beforeEach(async () => {
  await truncateAll()
  f = (await import('@tests/factories')) as Factories
  roleRoute = await import('@/app/api/v1/admin/users/[userId]/platform-role/route')
  const admin = await f.createUser('envelope-admin', { platformRole: 'admin' })
  adminSession = await asUser(admin.id)
  target = await f.createUser('envelope-target')
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

describe('the error envelope under hostile input', () => {
  it('answers 400 VALIDATION_ERROR to a wrong type, a missing field and an unknown value', async () => {
    for (const raw of ['{"role": 42}', '{}', '{"role": "overlord"}', '{"role": null}']) {
      const response = await put(raw)
      expect(response.status, raw).toBe(400)
      const body = await envelopeOf(response)
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(await roleOfTarget()).toBe('none')
    }
  })

  it('answers 400 to a body that is not JSON, and to an array where an object is expected', async () => {
    for (const raw of ['{not json', '"admin"', '[{"role":"admin"}]']) {
      const response = await put(raw)
      expect(response.status, raw).toBe(400)
      expect((await envelopeOf(response)).error.code).toBe('VALIDATION_ERROR')
    }
    expect(await roleOfTarget()).toBe('none')
  })

  it('answers 413 PAYLOAD_TOO_LARGE to a body over the cap, declared or not', async () => {
    const padding = 'x'.repeat(MAX_JSON_BODY_BYTES + 1024)
    const raw = `{"role": "admin", "padding": "${padding}"}`

    const undeclared = await put(raw)
    expect(undeclared.status).toBe(413)
    expect((await envelopeOf(undeclared)).error.code).toBe('PAYLOAD_TOO_LARGE')

    const lied = await put('{"role": "admin"}', {
      'content-length': String(MAX_JSON_BODY_BYTES * 4),
    })
    expect(lied.status).toBe(413)
    expect((await envelopeOf(lied)).error.code).toBe('PAYLOAD_TOO_LARGE')

    expect(await roleOfTarget()).toBe('none')
  })

  it('accepts a body just under the cap that is otherwise valid', async () => {
    // Zod's strict object refuses the padding key, which proves the body was read whole and parsed
    // rather than cut off — a 413 here would mean the cap is lower than it says.
    const padding = 'x'.repeat(MAX_JSON_BODY_BYTES - 2048)
    const response = await put(`{"role": "admin", "padding": "${padding}"}`)
    expect([200, 400]).toContain(response.status)
    expect(response.status).not.toBe(413)
  })

  it('answers 403 FORBIDDEN without the X-Requested-With header, and 401 without a session', async () => {
    const h = new Headers(adminSession)
    h.set('content-type', 'application/json')
    const noCsrf = await roleRoute.PUT(
      new Request(`http://localhost:3000/api/v1/admin/users/${target.id}/platform-role`, {
        method: 'PUT',
        headers: h,
        body: '{"role": "admin"}',
      }),
      { params: Promise.resolve({ userId: target.id }) },
    )
    expect(noCsrf.status).toBe(403)
    expect((await envelopeOf(noCsrf)).error.code).toBe('FORBIDDEN')

    const anonymous = await roleRoute.PUT(
      new Request(`http://localhost:3000/api/v1/admin/users/${target.id}/platform-role`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'tassl' },
        body: '{"role": "admin"}',
      }),
      { params: Promise.resolve({ userId: target.id }) },
    )
    expect(anonymous.status).toBe(401)
    expect((await envelopeOf(anonymous)).error.code).toBe('UNAUTHENTICATED')
    expect(await roleOfTarget()).toBe('none')
  })
})
