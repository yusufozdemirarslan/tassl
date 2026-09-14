// D-749 — Claude as the configured provider: `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-opus-5`.
//
// The fallback suite beside this one proves the adapter's contract with `LLM_FALLBACK_MODEL`. This one
// proves what changes when Claude is the primary: the model is `LLM_MODEL`, the fallback instance
// still answers with the fallback model, no sampling parameter reaches a model that rejects one, each
// prompt family carries its effort and a thinking allowance on top of its output ceiling, the
// server-side refusal fallbacks are asked for, and a refusal that survives them is output with no
// commentary rather than an error. MSW throughout; no key, no network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  anthropicCalls,
  anthropicCompletion,
  anthropicRefusal,
  anthropicStream,
  resetAnthropicCalls,
} from '@tests/setup/msw/anthropic'
import { server } from '@tests/setup/msw/server'

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
  process.env.LLM_PROVIDER = 'anthropic'
  process.env.LLM_MODEL = 'claude-opus-5'
  process.env.LLM_FALLBACK_MODEL = 'claude-sonnet-5'
  process.env.LLM_MAX_OUTPUT_TOKENS = '4096'
})

const { anthropicFallbackProvider, anthropicProvider, effortFor, resetAnthropicClient } =
  await import('@/server/llm/providers/anthropic')
const { defaultModelFor } = await import('@/server/llm/provider')
const { costEstimateUsd } = await import('@/server/llm/pricing')

const request = (over: Record<string, unknown> = {}) => ({
  feature: 'assistant' as const,
  promptName: 'assistant-reply',
  promptVersion: 1,
  messages: [
    { role: 'system' as const, content: 'You are the assistant inside a scenario.' },
    { role: 'user' as const, content: 'What is the premium payback?' },
  ],
  temperature: 0.7,
  context: { requestId: 'req-unit-anthropic-primary' },
  ...over,
})

beforeEach(() => {
  resetAnthropicCalls()
  resetAnthropicClient()
})

afterEach(() => {
  resetAnthropicCalls()
})

describe('the model', () => {
  it('answers with LLM_MODEL as the primary and LLM_FALLBACK_MODEL as the fallback', async () => {
    server.use(anthropicCompletion('ok', 'claude-opus-5'))
    const primary = await anthropicProvider.complete(request())
    expect(primary.model).toBe('claude-opus-5')
    expect(anthropicCalls[0]?.body.model).toBe('claude-opus-5')

    server.use(anthropicCompletion('ok'))
    const fallback = await anthropicFallbackProvider.complete(request())
    expect(fallback.model).toBe('claude-sonnet-5')
    expect(anthropicCalls[1]?.body.model).toBe('claude-sonnet-5')
  })

  it('names the same model on a row whose call never reported one', () => {
    const env = {
      LLM_PROVIDER: 'anthropic',
      LLM_MODEL: 'claude-opus-5',
      LLM_FALLBACK_MODEL: 'claude-sonnet-5',
    }
    expect(defaultModelFor('anthropic', env)).toBe('claude-opus-5')
    expect(defaultModelFor('anthropic', { ...env, LLM_PROVIDER: 'openai-compatible' })).toBe(
      'claude-sonnet-5',
    )
  })
})

describe('the request', () => {
  it('sends no temperature, the effort of the prompt family, a thinking allowance and fallbacks', async () => {
    server.use(anthropicCompletion('ok', 'claude-opus-5'))
    await anthropicProvider.complete(request())

    const body = anthropicCalls[0]?.body ?? {}
    expect(body.temperature).toBeUndefined()
    expect(body.top_p).toBeUndefined()
    expect(body.output_config).toEqual({ effort: 'low' })
    // 4,096 for the answer plus 2,000 for low-effort thinking: thinking counts against max_tokens.
    expect(body.max_tokens).toBe(6096)
    expect(body.fallbacks).toBe('default')
  })

  it('gives band reads medium effort and a larger allowance, and generation steps low', async () => {
    expect(effortFor('assistant-reply')).toBe('low')
    expect(effortFor('trigger-classify')).toBe('low')
    expect(effortFor('band-read-framing')).toBe('medium')
    // Measured: at medium, gen-documents thought for 50 s and the step ran past GEN_TIMEOUT_MS.
    expect(effortFor('gen-documents')).toBe('low')

    server.use(anthropicCompletion('ok', 'claude-opus-5'))
    await anthropicProvider.complete(
      request({ feature: 'scoring', promptName: 'band-read-framing', maxOutputTokens: 2_048 }),
    )
    expect(anthropicCalls[0]?.body.max_tokens).toBe(10_048)
    expect(anthropicCalls[0]?.body.output_config).toEqual({ effort: 'medium' })

    server.use(anthropicCompletion('ok', 'claude-opus-5'))
    await anthropicProvider.complete(
      request({ feature: 'generation', promptName: 'gen-documents', maxOutputTokens: 12_288 }),
    )
    expect(anthropicCalls[1]?.body.max_tokens).toBe(14_288)
    expect(anthropicCalls[1]?.body.output_config).toEqual({ effort: 'low' })
  })

  it('streams the reply as it arrives', async () => {
    server.use(anthropicStream(['The payback ', 'is in ', 'the memo.'], 'claude-opus-5'))
    const texts: string[] = []
    let model = ''
    for await (const chunk of anthropicProvider.stream(request())) {
      if (chunk.type === 'text') texts.push(chunk.text)
      else model = chunk.model
    }
    expect(texts).toEqual(['The payback ', 'is in ', 'the memo.'])
    expect(model).toBe('claude-opus-5')
  })
})

describe('a refusal', () => {
  it('comes back as output with no commentary, never an error that would pause a run (11 §3)', async () => {
    server.use(anthropicRefusal())
    const result = await anthropicProvider.complete(request())

    // The assembler answers empty prose with the claims and the no-commentary sentence; a thrown
    // provider error would have paused the student's run on an unusual request instead.
    expect(result.text).toBe('')
    expect(result.provider).toBe('anthropic')
    expect(result.model).toBe('claude-opus-5')
  })
})

describe('the cost estimate', () => {
  it('prices Claude Opus 5 at $5 in and $25 out per million tokens, whatever the environment says', () => {
    const usage = { inputTokens: 2_000, outputTokens: 400 }
    // 2,000 × $5/M + 400 × $25/M = $0.010 + $0.010.
    expect(costEstimateUsd(usage, 'anthropic', 'claude-opus-5')).toBe('0.020000')
    expect(costEstimateUsd(usage, 'mock', 'mock-v1')).toBe('0.000000')
  })
})
