// Step 13.1: with an empty NEXT_PUBLIC_SENTRY_DSN — the non-secret default, and the value every
// test and every local machine runs with — the whole Sentry path is inert and the application
// behaves exactly as it must (D-098): a thrown INTERNAL_ERROR still returns the envelope, still
// carries the request id, and is still logged at `error`.
//
// This is the real integration, not a fake: `@sentry/nextjs` is loaded, `sentry.server.config.ts`
// has run, and `Sentry.captureException` and `Sentry.startSpan` are called for real. What makes
// them silent is `enabled: false`, which is what an empty DSN produces.
import { describe, expect, it, beforeAll } from 'vitest'
import pino from 'pino'
import { z } from 'zod'
import * as Sentry from '@sentry/nextjs'
import { AppError } from '@/lib/errors'
import { defineRoute } from '@/server/http/define-route'
import { alertOps, countOps } from '@/server/logging/ops-events'
import { rootLogger } from '@/server/logging/logger'

type Line = { level: string; event?: string; status?: number; code?: string }

/** Swaps the root logger's destination for the duration of `fn`; child loggers inherit it. */
async function captureLogs(fn: () => Promise<void>): Promise<Line[]> {
  const lines: Line[] = []
  const streamSym = pino.symbols.streamSym
  const logger = rootLogger as unknown as Record<symbol, { write: (chunk: string) => void }>
  const original = logger[streamSym]
  logger[streamSym] = {
    write: (chunk: string) => {
      for (const raw of chunk.split('\n')) {
        if (raw.trim() !== '') lines.push(JSON.parse(raw) as Line)
      }
    },
  }
  try {
    await fn()
  } finally {
    if (original) logger[streamSym] = original
  }
  return lines
}

const noParams = { params: Promise.resolve({}) }
const REQ_ID = '3f1f2c88-40e6-4f0e-8a76-6f6a4b3b1f11'

const boom = defineRoute(
  {
    auth: 'public',
    output: z.object({ ok: z.boolean() }),
    openapi: { operationId: 'sentryNoopBoom', summary: 'throws', tags: ['test'] },
  },
  async () => {
    throw new Error('kaboom')
  },
)

const refused = defineRoute(
  {
    auth: 'public',
    output: z.object({ ok: z.boolean() }),
    openapi: { operationId: 'sentryNoopRefused', summary: 'refuses', tags: ['test'] },
  },
  async () => {
    throw new AppError('FORBIDDEN')
  },
)

describe('Sentry with an empty DSN', () => {
  beforeAll(async () => {
    await import('../../../sentry.server.config')
  })

  it('initializes disabled, so no client is bound and nothing can be sent', () => {
    expect(process.env.NEXT_PUBLIC_SENTRY_DSN ?? '').toBe('')
    expect(Sentry.getClient()?.getOptions().enabled ?? false).toBe(false)
  })

  it('still answers a 500 with the envelope and the request id, and logs it at error', async () => {
    let res!: Response
    const lines = await captureLogs(async () => {
      res = await boom(
        new Request('http://t/api/v1/boom', { headers: { 'x-request-id': REQ_ID } }),
        noParams,
      )
    })

    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string; requestId: string } }
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.requestId).toBe(REQ_ID)

    const failure = lines.find((line) => line.event === 'http_request')
    expect(failure).toMatchObject({ level: 'error', status: 500, code: 'INTERNAL_ERROR' })
  })

  it('leaves a 4xx alone: it is a refusal, not an incident', async () => {
    const res = await refused(new Request('http://t/api/v1/refused'), noParams)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('FORBIDDEN')
  })

  it('makes alertOps and countOps no-ops that still return', () => {
    expect(() => alertOps('readiness_failed', { db: 'timeout', jobs: 'skipped' })).not.toThrow()
    expect(() => countOps('ops_queue_depth', { queue: 'send_email', created: 0 })).not.toThrow()
  })

  it('flushes instantly because there is nothing to flush', async () => {
    await expect(Sentry.flush(2000)).resolves.toBe(true)
  })
})
