// Step 14.1 — the MiMo adapter (docs/tech/11-llm-integration.md §1.2; AI-002, INT-007, D-028).
//
// Everything here runs against MSW. Steps 14.1 to 14.3 never call the real provider: 14.4 is where a
// key belongs, and a suite that reached the network would be a suite whose results depend on a
// vendor's uptime and whose failures cost money.
//
// What is actually being asserted is the *request*, more than the answer. The answer is the SDK's job
// and it is well covered upstream; the three departures from the OpenAI API that this adapter exists
// to absorb — the `thinking` field, the `json_schema` downgrade, the two auth headers — are ours, and
// none of them is visible anywhere except on the bytes that go out.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MIMO_BASE_URL,
  mimoCalls,
  mimoCompletion,
  mimoCompletionSequence,
  mimoSlow,
  mimoStatus,
  mimoStream,
  resetMimoCalls,
} from '@tests/setup/msw/mimo'
import { server } from '@tests/setup/msw/server'
import { isAppError } from '@/lib/errors'

// Before `src/server/config` parses the environment, and before the adapter builds a client from it.
// A fake key, never the one in `.env`: nothing in this file may depend on a real credential, and a
// header assertion that read the real key would print it into a failure message.
vi.hoisted(() => {
  process.env.LLM_API_KEY = 'test-mimo-key'
  process.env.LLM_BASE_URL = 'https://token-plan-sgp.xiaomimimo.com/v1'
  process.env.LLM_MODEL = 'mimo-v2.5-pro'
  process.env.LLM_REASONING = 'off'
})

const { mimoRequestBody, openAiCompatibleProvider, resetOpenAiCompatibleClient } =
  await import('@/server/llm/providers/openai-compatible')

const request = (over: Record<string, unknown> = {}) => ({
  feature: 'assistant' as const,
  promptName: 'assistant-reply',
  promptVersion: 1,
  messages: [
    { role: 'system' as const, content: 'You are the assistant inside a scenario.' },
    { role: 'user' as const, content: 'What is the premium payback?' },
  ],
  context: { requestId: 'req-unit-mimo' },
  ...over,
})

beforeEach(() => {
  resetMimoCalls()
  resetOpenAiCompatibleClient()
})

afterEach(() => {
  resetMimoCalls()
})

describe('the outbound request', () => {
  it('carries both auth headers §1.2 names, and the model and messages it was given', async () => {
    server.use(mimoCompletion('The payback is in the memo.'))
    const result = await openAiCompatibleProvider.complete(request())

    expect(result.text).toBe('The payback is in the memo.')
    expect(result.provider).toBe('openai-compatible')
    expect(result.model).toBe('mimo-v2.5-pro')

    const call = mimoCalls[0]
    expect(call?.headers['api-key']).toBe('test-mimo-key')
    expect(call?.headers.authorization).toBe('Bearer test-mimo-key')
    expect(call?.body.model).toBe('mimo-v2.5-pro')
    expect(call?.body.messages).toEqual([
      { role: 'system', content: 'You are the assistant inside a scenario.' },
      { role: 'user', content: 'What is the premium payback?' },
    ])
  })

  it('carries thinking: disabled, because LLM_REASONING is off', async () => {
    server.use(mimoCompletion('ok'))
    await openAiCompatibleProvider.complete(request())
    expect(mimoCalls[0]?.body.thinking).toEqual({ type: 'disabled' })
  })

  it('exposes no tool calling at all (§1.2, D-067)', async () => {
    server.use(mimoCompletion('ok'))
    await openAiCompatibleProvider.complete(request())
    const call = mimoCalls[0]
    expect(call?.body.tools).toBeUndefined()
    expect(call?.body.tool_choice).toBeUndefined()
  })

  it('sends the temperature the caller asked for, and the default 0.7 when it asked for none', async () => {
    server.use(mimoCompletion('ok'))
    await openAiCompatibleProvider.complete(request())
    expect(mimoCalls[0]?.body.temperature).toBe(0.7)

    resetMimoCalls()
    server.use(mimoCompletion('ok'))
    await openAiCompatibleProvider.complete(request({ temperature: 0.2 }))
    expect(mimoCalls[0]?.body.temperature).toBe(0.2)
  })
})

describe('mimoRequestBody', () => {
  it('turns thinking on when LLM_REASONING=on, without touching anything else', () => {
    const out = JSON.parse(mimoRequestBody(JSON.stringify({ model: 'm', messages: [] }), 'on')) as {
      thinking: unknown
      model: string
    }
    expect(out.thinking).toEqual({ type: 'enabled' })
    expect(out.model).toBe('m')
  })

  it('downgrades a json_schema response_format to json_object (§1.2: no schema enforcement)', () => {
    const raw = JSON.stringify({
      model: 'm',
      response_format: { type: 'json_schema', json_schema: { name: 'X', schema: {} } },
    })
    const out = JSON.parse(mimoRequestBody(raw, 'off')) as { response_format: unknown }
    expect(out.response_format).toEqual({ type: 'json_object' })
  })

  it('leaves a json_object response_format alone', () => {
    const raw = JSON.stringify({ response_format: { type: 'json_object' } })
    const out = JSON.parse(mimoRequestBody(raw, 'off')) as { response_format: unknown }
    expect(out.response_format).toEqual({ type: 'json_object' })
  })

  it('returns a body it cannot parse untouched rather than failing the call', () => {
    expect(mimoRequestBody('not json at all', 'off')).toBe('not json at all')
    expect(mimoRequestBody('[1,2,3]', 'off')).toBe('[1,2,3]')
  })
})

describe('streaming', () => {
  it('yields the text chunks in order, then one done chunk carrying the usage', async () => {
    server.use(mimoStream(['The payback ', 'is in ', 'the memo.']))

    const texts: string[] = []
    let done: { usage: { inputTokens: number; outputTokens: number }; provider: string } | null =
      null
    for await (const chunk of openAiCompatibleProvider.stream(request())) {
      if (chunk.type === 'text') texts.push(chunk.text)
      else done = { usage: chunk.usage, provider: chunk.provider }
    }

    expect(texts.join('')).toBe('The payback is in the memo.')
    expect(done?.provider).toBe('openai-compatible')
    expect(done?.usage).toEqual({ inputTokens: 41, outputTokens: 17 })
  })

  it('asks for the usage block, so a streamed reply costs what it spent rather than an estimate', async () => {
    server.use(mimoStream(['a']))
    for await (const _chunk of openAiCompatibleProvider.stream(request())) void _chunk
    expect(mimoCalls[0]?.body.stream).toBe(true)
    expect(mimoCalls[0]?.body.stream_options).toEqual({ include_usage: true })
  })
})

describe('structured output', () => {
  it('goes through structuredViaPrompt: JSON in the system message, JSON object back', async () => {
    const { z } = await import('zod')
    server.use(mimoCompletion('{"band":"proficient","rationale":"The frame names the decision."}'))

    const result = await openAiCompatibleProvider.structured({
      ...request({ feature: 'band_read', promptName: 'band-read-framing' }),
      schema: z.object({ band: z.string(), rationale: z.string() }),
      schemaName: 'FramingRead',
    })

    expect(result.value).toEqual({ band: 'proficient', rationale: 'The frame names the decision.' })
    expect(result.repaired).toBe(false)
    // §1.2: the schema is described in the system message, not enforced by the endpoint.
    const system = (mimoCalls[0]?.body.messages as { role: string; content: string }[])[0]
    expect(system?.content).toContain('Respond with a single JSON object')
    // Temperature 0.2 for a structured call, whatever the caller passed.
    expect(mimoCalls[0]?.body.temperature).toBe(0.2)
  })

  it('spends exactly one repair call and reports the answer as repaired', async () => {
    const { z } = await import('zod')
    server.use(
      mimoCompletionSequence(['not an object at all', '{"band":"novice","rationale":"Thin."}']),
    )

    const result = await openAiCompatibleProvider.structured({
      ...request({ feature: 'band_read', promptName: 'band-read-framing' }),
      schema: z.object({ band: z.string(), rationale: z.string() }),
      schemaName: 'FramingRead',
    })

    expect(result.repaired).toBe(true)
    expect(mimoCalls).toHaveLength(2)
    // The usage of both attempts is summed (§1.2), so a repair costs what it cost.
    expect(result.usage.outputTokens).toBe(34)
  })
})

describe('failures', () => {
  it('turns a 500 into LLM_PROVIDER_ERROR carrying the upstream status', async () => {
    server.use(mimoStatus(500))
    const error = await openAiCompatibleProvider
      .complete(request())
      .catch((thrown: unknown) => thrown)

    expect(isAppError(error) && error.code).toBe('LLM_PROVIDER_ERROR')
    expect(isAppError(error) && (error.opts.details as { status: number }).status).toBe(500)
  })

  it('turns a 429 into the same shape, with the status a retry can read', async () => {
    server.use(mimoStatus(429))
    const error = await openAiCompatibleProvider
      .complete(request())
      .catch((thrown: unknown) => thrown)
    expect(isAppError(error) && (error.opts.details as { status: number }).status).toBe(429)
  })

  it('does not retry inside the SDK: one call out for one call in (D-652)', async () => {
    server.use(mimoStatus(500))
    await openAiCompatibleProvider.complete(request()).catch(() => null)
    expect(mimoCalls).toHaveLength(1)
  })

  it('reports a timeout under the name calls.ts logs as `timeout`', async () => {
    // An answer that takes a second against a twenty-millisecond budget: the abort fires first, and
    // whatever the SDK throws when its fetch is aborted has to reach `calls.outcomeOf` under a name
    // that file reads as a timeout rather than as a generic provider error.
    server.use(mimoSlow(1000))
    const error = await openAiCompatibleProvider
      .complete(request({ timeoutMs: 20 }))
      .catch((thrown: unknown) => thrown)
    expect((error as Error).name).toBe('TimeoutError')

    const { outcomeOf } = await import('@/server/llm/calls')
    expect(outcomeOf(error)).toBe('timeout')
  })
})

describe('the base URL', () => {
  it('is the one D-028 verified', () => {
    expect(MIMO_BASE_URL).toBe('https://token-plan-sgp.xiaomimimo.com/v1')
  })
})
