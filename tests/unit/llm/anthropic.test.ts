// Step 14.1 — the Anthropic fallback adapter (docs/tech/11-llm-integration.md §1.3; INT-008, D-103).
//
// The fallback is the provider nobody exercises until the day the primary is down, which is the
// worst day to find out that it was never wired up. So it is tested the same way and to the same
// depth as the primary: complete, stream, structured, and the failure shape the breaker reads.
//
// MSW throughout; no key, no network. The Messages API is a different shape from chat completions —
// content blocks, `input_tokens`, named SSE events — and the point of this file is that the
// difference stops at `LlmProvider`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  anthropicCalls,
  anthropicCompletion,
  anthropicStatus,
  anthropicStream,
  resetAnthropicCalls,
} from '@tests/setup/msw/anthropic'
import { server } from '@tests/setup/msw/server'
import { isAppError } from '@/lib/errors'

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
  process.env.LLM_FALLBACK_MODEL = 'claude-sonnet-5'
})

const { anthropicProvider, resetAnthropicClient } = await import('@/server/llm/providers/anthropic')

const request = (over: Record<string, unknown> = {}) => ({
  feature: 'assistant' as const,
  promptName: 'assistant-reply',
  promptVersion: 1,
  messages: [
    { role: 'system' as const, content: 'You are the assistant inside a scenario.' },
    { role: 'user' as const, content: 'What is the premium payback?' },
  ],
  context: { requestId: 'req-unit-anthropic' },
  ...over,
})

beforeEach(() => {
  resetAnthropicCalls()
  resetAnthropicClient()
})

afterEach(() => {
  resetAnthropicCalls()
})

describe('complete', () => {
  it('answers with the text, the fallback model and its own provider name', async () => {
    server.use(anthropicCompletion('The payback is in the memo.'))
    const result = await anthropicProvider.complete(request())

    expect(result.text).toBe('The payback is in the memo.')
    expect(result.provider).toBe('anthropic')
    // D-103: the model is `LLM_FALLBACK_MODEL`, never a literal in the adapter.
    expect(result.model).toBe('claude-sonnet-5')
    expect(result.usage).toEqual({ inputTokens: 33, outputTokens: 14 })
  })

  it('sends the system message as the API’s own system field, and exposes no tools', async () => {
    server.use(anthropicCompletion('ok'))
    await anthropicProvider.complete(request())

    const call = anthropicCalls[0]
    expect(call?.body.model).toBe('claude-sonnet-5')
    expect(JSON.stringify(call?.body.system)).toContain('You are the assistant inside a scenario.')
    expect(call?.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'What is the premium payback?' }] },
    ])
    expect(call?.body.tools).toBeUndefined()
    expect(call?.headers['x-api-key']).toBe('test-anthropic-key')
  })
})

describe('stream', () => {
  it('yields the deltas in order, then one done chunk with the usage', async () => {
    server.use(anthropicStream(['The payback ', 'is in ', 'the memo.']))

    const texts: string[] = []
    let done: { usage: { inputTokens: number; outputTokens: number }; model: string } | null = null
    for await (const chunk of anthropicProvider.stream(request())) {
      if (chunk.type === 'text') texts.push(chunk.text)
      else done = { usage: chunk.usage, model: chunk.model }
    }

    expect(texts.join('')).toBe('The payback is in the memo.')
    expect(done?.model).toBe('claude-sonnet-5')
    expect(done?.usage).toEqual({ inputTokens: 33, outputTokens: 14 })
  })
})

describe('structured', () => {
  it('runs the same structuredViaPrompt the primary runs (§1.2)', async () => {
    const { z } = await import('zod')
    server.use(anthropicCompletion('{"matched_claim_ids":["C3"]}'))

    const result = await anthropicProvider.structured({
      ...request({ feature: 'trigger_classify', promptName: 'trigger-classify' }),
      schema: z.object({ matched_claim_ids: z.array(z.string()) }),
      schemaName: 'TriggerClassifyOutput',
    })

    expect(result.value).toEqual({ matched_claim_ids: ['C3'] })
    expect(result.repaired).toBe(false)
    // §1.2: the schema travels in the system message and Zod decides, on this provider exactly as
    // on the primary. The sampling temperature does not appear on the wire — the Anthropic SDK drops
    // `temperature` for a model that does not accept one and says so in a warning — which is the
    // provider's business and changes nothing about the contract this adapter keeps.
    expect(JSON.stringify(anthropicCalls[0]?.body.system)).toContain(
      'Respond with a single JSON object',
    )
    expect(anthropicCalls[0]?.body.max_tokens).toBe(4096)
  })
})

describe('failures', () => {
  it('turns a 529 into LLM_PROVIDER_ERROR carrying the status the breaker reads', async () => {
    server.use(anthropicStatus(529))
    const error = await anthropicProvider.complete(request()).catch((thrown: unknown) => thrown)

    expect(isAppError(error) && error.code).toBe('LLM_PROVIDER_ERROR')
    expect(isAppError(error) && (error.opts.details as { status: number }).status).toBe(529)
    expect(isAppError(error) && (error.opts.details as { provider: string }).provider).toBe(
      'anthropic',
    )
  })

  it('makes one request per call: the SDK’s own retries are off (D-652)', async () => {
    server.use(anthropicStatus(500))
    await anthropicProvider.complete(request()).catch(() => null)
    expect(anthropicCalls).toHaveLength(1)
  })
})
