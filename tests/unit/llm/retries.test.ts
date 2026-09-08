// Step 14.2 — retries (docs/tech/11-llm-integration.md §1.1, §3).
//
// Two retries, one second then three, on a network error, a 429, a 5xx and a timeout; nothing else.
// The schedule is asserted by injecting `sleep` and reading the waits back, rather than by waiting
// four seconds per case.
//
// The stream rule is the one worth reading twice: a stream is retried only while nothing has reached
// the consumer. A student under a clock who has read half an answer must not be handed the beginning
// of a second one, and the case that actually matters — a provider that is down refuses the
// connection — is covered, because that failure happens before the first chunk.
import { describe, expect, it, vi } from 'vitest'
import { AppError, isAppError } from '@/lib/errors'
import {
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_MS,
  isRetryable,
  withRetries,
  withRetry,
} from '@/server/llm/guardrails/retries'
import type { LlmProvider, StreamChunk } from '@/server/llm/provider'

const httpError = (status: number): AppError =>
  new AppError('LLM_PROVIDER_ERROR', `upstream ${String(status)}`, { details: { status } })

const timeoutError = (): Error => {
  const error = new Error('timed out')
  error.name = 'TimeoutError'
  return error
}

const waits: number[] = []
const sleep = vi.fn(async (ms: number) => {
  waits.push(ms)
  return Promise.resolve()
})

const options = () => {
  waits.length = 0
  sleep.mockClear()
  return { sleep }
}

describe('what is retried', () => {
  it('retries a 429 and every 5xx', () => {
    expect(isRetryable(httpError(429))).toBe(true)
    expect(isRetryable(httpError(500))).toBe(true)
    expect(isRetryable(httpError(503))).toBe(true)
    expect(isRetryable(httpError(529))).toBe(true)
  })

  it('retries a timeout and a bare network failure', () => {
    expect(isRetryable(timeoutError())).toBe(true)
    expect(isRetryable(new TypeError('fetch failed'))).toBe(true)
  })

  it('does not retry a 4xx that is not 429: the request was wrong and will be wrong again', () => {
    expect(isRetryable(httpError(400))).toBe(false)
    expect(isRetryable(httpError(401))).toBe(false)
    expect(isRetryable(httpError(404))).toBe(false)
  })

  it('does not retry the three control-plane refusals', () => {
    // The structured path has already spent its one repair (§1.2); a ceiling does not move in three
    // seconds; and retrying an open circuit is the thing the circuit exists to stop.
    expect(isRetryable(new AppError('LLM_OUTPUT_INVALID'))).toBe(false)
    expect(isRetryable(new AppError('LLM_BUDGET_EXCEEDED'))).toBe(false)
    expect(isRetryable(new AppError('LLM_CIRCUIT_OPEN'))).toBe(false)
  })
})

describe('the schedule', () => {
  it('is two retries, one second then three (§3)', async () => {
    expect(RETRY_ATTEMPTS).toBe(2)
    expect([...RETRY_BACKOFF_MS]).toEqual([1000, 3000])

    const call = vi.fn(async () => Promise.reject(httpError(500)))
    await withRetry(call, 'test', options()).catch(() => null)

    expect(call).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([1000, 3000])
  })

  it('stops the moment a retry succeeds', async () => {
    let attempt = 0
    const call = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) return Promise.reject(httpError(503))
      return Promise.resolve('answered')
    })

    await expect(withRetry(call, 'test', options())).resolves.toBe('answered')
    expect(call).toHaveBeenCalledTimes(2)
    expect(waits).toEqual([1000])
  })

  it('throws the last failure, not the first', async () => {
    let attempt = 0
    const call = vi.fn(async () => {
      attempt += 1
      return Promise.reject(httpError(attempt === 3 ? 502 : 500))
    })

    const error = await withRetry(call, 'test', options()).catch((thrown: unknown) => thrown)
    expect(isAppError(error) && (error.opts.details as { status: number }).status).toBe(502)
  })

  it('does not wait at all for a failure it will not retry', async () => {
    const call = vi.fn(async () => Promise.reject(httpError(400)))
    await withRetry(call, 'test', options()).catch(() => null)
    expect(call).toHaveBeenCalledTimes(1)
    expect(waits).toEqual([])
  })
})

describe('the wrapper', () => {
  const provider = (script: () => Promise<string>): LlmProvider => ({
    name: 'openai-compatible',
    complete: async () => ({
      text: await script(),
      usage: { inputTokens: 1, outputTokens: 1 },
      model: 'm',
      provider: 'openai-compatible',
    }),
    async *stream(): AsyncIterable<StreamChunk> {
      const text = await script()
      yield { type: 'text', text }
      yield {
        type: 'done',
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'm',
        provider: 'openai-compatible',
      }
    },
    structured: async () => ({
      value: (await script()) as never,
      repaired: false,
      raw: '{}',
      usage: { inputTokens: 1, outputTokens: 1 },
      model: 'm',
      provider: 'openai-compatible',
    }),
  })

  const request = () => ({
    feature: 'assistant' as const,
    promptName: 'assistant-reply',
    promptVersion: 1,
    messages: [{ role: 'user' as const, content: 'hello' }],
    context: { requestId: 'req-retries-unit' },
  })

  it('retries a stream that failed before its first chunk', async () => {
    let attempt = 0
    const wrapped = withRetries(
      provider(async () => {
        attempt += 1
        if (attempt === 1) return Promise.reject(httpError(500))
        return Promise.resolve('the answer')
      }),
      options(),
    )

    const texts: string[] = []
    for await (const chunk of wrapped.stream(request())) {
      if (chunk.type === 'text') texts.push(chunk.text)
    }
    expect(texts).toEqual(['the answer'])
    expect(attempt).toBe(2)
  })

  it('does not retry a stream that had already yielded, and does not repeat what was read', async () => {
    let attempt = 0
    const partial: LlmProvider = {
      name: 'openai-compatible',
      complete: async () => Promise.reject(httpError(500)),
      async *stream(): AsyncIterable<StreamChunk> {
        attempt += 1
        yield { type: 'text', text: 'half an ' }
        throw httpError(500)
      },
      structured: async () => Promise.reject(httpError(500)),
    }
    const wrapped = withRetries(partial, options())

    const texts: string[] = []
    const drain = async (): Promise<void> => {
      for await (const chunk of wrapped.stream(request())) {
        if (chunk.type === 'text') texts.push(chunk.text)
      }
    }

    await expect(drain()).rejects.toMatchObject({ code: 'LLM_PROVIDER_ERROR' })
    expect(attempt).toBe(1)
    expect(texts).toEqual(['half an '])
  })
})
