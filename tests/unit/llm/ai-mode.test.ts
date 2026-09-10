// The runtime assistant switch (docs/tech/11-llm-integration.md §6; D-691).
//
// Two things are pinned here, and both are about what the switch may *not* do.
//
// *`readAiMode` never throws and never widens.* A missing row, a row holding a value nobody wrote,
// and a database that cannot be read all answer `live` — the answer the environment already gave.
// The row can only ever narrow a deployment that names a network provider onto the mock.
//
// *The switching provider reads the row per call.* `getProvider()` hands out one instance for the
// life of the process, and that instance asks the row before every `complete`, `stream` and
// `structured` — so the request after an admin flips the switch is the one it applies to, with no
// restart and no cache to wait out.
//
// The environment is set in `vi.hoisted` because `src/server/config` parses `process.env` once, at
// import. The database is a thenable builder driven by `state`: it is the one seam these tests
// need, and it stands in for `db` alone — the two network adapters, the call logger and the budget
// wrapper are doubled so that nothing here reaches a socket or a second table.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmProvider, StreamChunk } from '@/server/llm/provider'

vi.hoisted(() => {
  process.env.FEATURE_AI = 'true'
  process.env.LLM_PROVIDER = 'openai-compatible'
  process.env.LLM_API_KEY = 'a-key-that-must-never-be-used'
  process.env.LLM_FALLBACK_PROVIDER = 'none'
})

const state = vi.hoisted(() => ({
  rows: [] as Array<{ value: string }>,
  fail: false,
  reads: 0,
  writes: [] as unknown[],
}))

vi.mock('@/server/db/client', () => {
  // One builder object: every query method returns it, and awaiting it settles with `state.rows`.
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  Object.assign(builder, {
    select: () => {
      state.reads += 1
      return builder
    },
    from: chain,
    where: chain,
    limit: chain,
    insert: chain,
    values: (values: unknown) => {
      state.writes.push(values)
      return builder
    },
    onConflictDoUpdate: chain,
    then: (resolve: (rows: unknown) => void, reject: (error: unknown) => void) =>
      state.fail ? reject(new Error('database is down')) : resolve(state.rows),
  })
  return { db: builder, sql: () => '', pingDb: async () => undefined }
})

const answered = vi.hoisted(() => ({ calls: [] as string[] }))

/** A provider that answers to its own name and records that it was reached. */
const fake = (name: LlmProvider['name']): LlmProvider => ({
  name,
  async complete() {
    answered.calls.push(`${name}:complete`)
    return { text: name, usage: { inputTokens: 1, outputTokens: 1 }, model: name, provider: name }
  },
  async *stream() {
    answered.calls.push(`${name}:stream`)
    yield { type: 'text', text: name } satisfies StreamChunk
    yield {
      type: 'done',
      usage: { inputTokens: 1, outputTokens: 1 },
      model: name,
      provider: name,
    } satisfies StreamChunk
  },
  async structured() {
    answered.calls.push(`${name}:structured`)
    return {
      value: { by: name } as never,
      repaired: false,
      raw: '{}',
      usage: { inputTokens: 1, outputTokens: 1 },
      model: name,
      provider: name,
    }
  },
})

vi.mock('@/server/llm/providers/mock', () => ({ mockProvider: fake('mock') }))
vi.mock('@/server/llm/providers/openai-compatible', () => ({
  openAiCompatibleProvider: fake('openai-compatible'),
}))
vi.mock('@/server/llm/providers/anthropic', () => ({ anthropicProvider: fake('anthropic') }))
vi.mock('@/server/llm/calls', () => ({ withCallLogging: (provider: LlmProvider) => provider }))
vi.mock('@/server/llm/guardrails/budgets', () => ({
  withBudgets: (provider: LlmProvider) => provider,
}))

const { AI_MODE_KEY, effectiveAssistantMode, readAiMode, writeAiMode } =
  await import('@/server/llm/ai-mode')
const { getProvider, resetProviderRegistry } = await import('@/server/llm/registry')

const request = () => ({
  feature: 'assistant' as const,
  promptName: 'assistant-reply',
  promptVersion: 1,
  messages: [{ role: 'user' as const, content: 'What is the premium payback?' }],
  context: { requestId: 'req-ai-mode-unit' },
})

const collect = async (source: AsyncIterable<StreamChunk>): Promise<string[]> => {
  const seen: string[] = []
  for await (const chunk of source) if (chunk.type === 'text') seen.push(chunk.text)
  return seen
}

beforeEach(() => {
  state.rows = []
  state.fail = false
  state.reads = 0
  state.writes = []
  answered.calls = []
  resetProviderRegistry()
})

describe('readAiMode', () => {
  it('is live when there is no row', async () => {
    expect(await readAiMode()).toBe('live')
  })

  it('is mock only when the row says exactly that', async () => {
    state.rows = [{ value: 'mock' }]
    expect(await readAiMode()).toBe('mock')
    state.rows = [{ value: 'MOCK' }]
    expect(await readAiMode()).toBe('live')
    state.rows = [{ value: 'off' }]
    expect(await readAiMode()).toBe('live')
  })

  it('answers live, and does not throw, when the database cannot be read', async () => {
    state.fail = true
    await expect(readAiMode()).resolves.toBe('live')
  })

  it('writes one upsert carrying the key, the mode and who set it', async () => {
    await writeAiMode('mock', 'admin-1')
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0]).toMatchObject({ key: AI_MODE_KEY, value: 'mock', updatedBy: 'admin-1' })
  })
})

describe('effectiveAssistantMode', () => {
  it('is live on a network provider with no row, and scripted once the row says mock', async () => {
    expect(await effectiveAssistantMode()).toBe('live')
    state.rows = [{ value: 'mock' }]
    expect(await effectiveAssistantMode()).toBe('scripted')
  })
})

describe('the switching provider', () => {
  it('carries the network provider’s name and is one instance', () => {
    expect(getProvider().name).toBe('openai-compatible')
    expect(getProvider()).toBe(getProvider())
  })

  it('reads the row before each call and delegates accordingly', async () => {
    const provider = getProvider()

    const live = await provider.complete(request())
    expect(live.provider).toBe('openai-compatible')

    state.rows = [{ value: 'mock' }]
    const scripted = await provider.complete(request())
    expect(scripted.provider).toBe('mock')

    state.rows = []
    const back = await provider.complete(request())
    expect(back.provider).toBe('openai-compatible')

    expect(answered.calls).toEqual([
      'openai-compatible:complete',
      'mock:complete',
      'openai-compatible:complete',
    ])
    // One row read per call: the switch is honoured per request, never cached.
    expect(state.reads).toBe(3)
  })

  it('switches stream and structured the same way', async () => {
    const provider = getProvider()

    state.rows = [{ value: 'mock' }]
    expect(await collect(provider.stream(request()))).toEqual(['mock'])
    const structured = await provider.structured({
      ...request(),
      schema: {} as never,
      schemaName: 'Anything',
    })
    expect(structured.provider).toBe('mock')

    state.rows = []
    expect(await collect(provider.stream(request()))).toEqual(['openai-compatible'])

    expect(answered.calls).toEqual(['mock:stream', 'mock:structured', 'openai-compatible:stream'])
  })

  it('answers from the network chain when the row cannot be read', async () => {
    state.fail = true
    // `readAiMode` swallows the failure and answers `live`; the fake builder rejects only the
    // read, and the fake providers never touch it.
    const result = await getProvider().complete(request())
    expect(result.provider).toBe('openai-compatible')
  })
})
