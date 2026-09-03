// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { defineRoute, routePattern } from '@/server/http/define-route'

const noParams = { params: Promise.resolve({}) }
const REQ_ID = '11111111-1111-1111-1111-111111111111'
const openapi = (operationId: string) => ({ operationId, summary: operationId, tags: ['test'] })

type Envelope = { error: { code: string; message: string; requestId: string; details?: unknown } }

const echo = defineRoute(
  {
    auth: 'public',
    input: { query: z.object({ n: z.coerce.number().int() }) },
    output: z.object({ doubled: z.number() }),
    openapi: openapi('testEcho'),
  },
  async (ctx) => ({ doubled: ctx.input.query.n * 2, secret: 'stripped' }) as { doubled: number },
)

describe('defineRoute', () => {
  it('returns JSON with x-request-id echoed and Cache-Control: no-store', async () => {
    const res = await echo(
      new Request('http://t/api/v1/echo?n=21', { headers: { 'x-request-id': REQ_ID } }),
      noParams,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBe(REQ_ID)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ doubled: 42 })
  })

  it('generates a request id when the incoming one is not a UUID', async () => {
    const res = await echo(
      new Request('http://t/api/v1/echo?n=1', { headers: { 'x-request-id': 'nope' } }),
      noParams,
    )
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('maps a validation failure to a 400 envelope with details', async () => {
    const res = await echo(new Request('http://t/api/v1/echo?n=abc'), noParams)
    const body = (await res.json()) as Envelope
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.error.details).toBeDefined()
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('maps an unknown error to 500 INTERNAL_ERROR with the request id', async () => {
    const boom = defineRoute(
      { auth: 'public', output: z.unknown(), openapi: openapi('testBoom') },
      async () => {
        throw new Error('database exploded')
      },
    )
    const res = await boom(
      new Request('http://t/api/v1/boom', { headers: { 'x-request-id': REQ_ID } }),
      noParams,
    )
    const body = (await res.json()) as Envelope
    expect(res.status).toBe(500)
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.requestId).toBe(REQ_ID)
    expect(body.error.message).not.toContain('exploded')
  })

  it('keeps an AppError status and code', async () => {
    const missing = defineRoute(
      { auth: 'public', output: z.unknown(), openapi: openapi('testMissing') },
      async () => {
        throw new AppError('NOT_FOUND')
      },
    )
    const res = await missing(new Request('http://t/api/v1/x'), noParams)
    expect(res.status).toBe(404)
    expect(((await res.json()) as Envelope).error.code).toBe('NOT_FOUND')
  })

  it('answers 401 UNAUTHENTICATED on session routes until Phase 3', async () => {
    const guarded = defineRoute(
      { auth: 'session', output: z.object({}), openapi: openapi('testGuarded') },
      async () => ({}),
    )
    const res = await guarded(new Request('http://t/api/v1/me'), noParams)
    expect(res.status).toBe(401)
  })

  it('checks the cron bearer in constant time', async () => {
    const cron = defineRoute(
      { auth: 'cron', output: z.object({ ok: z.boolean() }), openapi: openapi('testCron') },
      async () => ({ ok: true }),
    )
    const ok = await cron(
      new Request('http://t/api/internal/x', {
        headers: { authorization: 'Bearer local-cron-secret' },
      }),
      noParams,
    )
    const bad = await cron(
      new Request('http://t/api/internal/x', { headers: { authorization: 'Bearer wrong' } }),
      noParams,
    )
    expect(ok.status).toBe(200)
    expect(bad.status).toBe(401)
  })

  it('rejects a body that is not JSON', async () => {
    const withBody = defineRoute(
      {
        auth: 'public',
        input: { body: z.object({ name: z.string() }) },
        output: z.object({ name: z.string() }),
        openapi: { ...openapi('testBody'), status: 201 },
      },
      async (ctx) => ({ name: ctx.input.body.name }),
    )
    const bad = await withBody(
      new Request('http://t/api/v1/b', { method: 'POST', body: '{' }),
      noParams,
    )
    expect(bad.status).toBe(400)
    const good = await withBody(
      new Request('http://t/api/v1/b', { method: 'POST', body: JSON.stringify({ name: 'z' }) }),
      noParams,
    )
    expect(good.status).toBe(201)
  })

  it('returns 429 with Retry-After once the bucket is exhausted', async () => {
    const limited = defineRoute(
      {
        auth: 'public',
        output: z.object({}),
        rateLimit: { bucket: 'auth', key: () => 'test-bucket-key' },
        openapi: openapi('testLimited'),
      },
      async () => ({}),
    )
    let last: Response | undefined
    for (let i = 0; i < 11; i++) last = await limited(new Request('http://t/api/v1/l'), noParams)
    expect(last?.status).toBe(429)
    expect(Number(last?.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(((await last!.json()) as Envelope).error.code).toBe('RATE_LIMITED')
  })
})

describe('routePattern', () => {
  it('replaces matched params with their segment names', () => {
    expect(routePattern('/api/v1/runs/abc/lock', { runId: 'abc' })).toBe(
      '/api/v1/runs/[runId]/lock',
    )
    expect(routePattern('/api/health', {})).toBe('/api/health')
  })
})
