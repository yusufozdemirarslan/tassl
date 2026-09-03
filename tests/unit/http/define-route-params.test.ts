// D-165: Next resolves `params` to undefined for routes without dynamic segments; the wrapper must
// treat that as an empty object instead of crashing before its error envelope.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRoute } from '@/server/http/define-route'

describe('defineRoute on a static route', () => {
  it('answers when Next passes no params', async () => {
    const handler = defineRoute(
      {
        auth: 'public',
        output: z.object({ ok: z.boolean() }),
        openapi: { operationId: 'testStaticRoute', summary: 'static', tags: ['test'] },
      },
      async () => ({ ok: true }),
    )
    const res = await handler(new Request('http://t/api/internal/static'), {
      params: Promise.resolve(undefined as never),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
