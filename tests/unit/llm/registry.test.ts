// Step 14.1 / 14.2 — the registry and the chain (docs/tech/11-llm-integration.md §1.1; D-029, D-118).
//
// **The property this whole phase rests on is the first describe block.** `FEATURE_AI=false` forces
// the mock whatever `LLM_PROVIDER` says (D-029), and CLAUDE.md's invariant is stronger than that: the
// app must be *fully usable* with no key, which means the default configuration must behave exactly
// as it did through thirteen phases of building on the mock. Adding five wrappers and two network
// adapters is the change most likely to break that quietly — a budget query per delegation, a breaker
// counting a pure function's failures, an SDK constructed on a cold start — so the tests below check
// the negative: same provider, same answer, and no socket opened at all.
//
// The environment is set in `vi.hoisted` because `src/server/config` parses `process.env` once, at
// import, and never re-reads it. The values below are the hostile case on purpose: a real-looking
// key, a real provider name, and a fallback configured. Nothing may reach any of them.
import { describe, expect, it, vi } from 'vitest'
import { server } from '@tests/setup/msw/server'
import type { StreamChunk } from '@/server/llm/provider'

vi.hoisted(() => {
  process.env.FEATURE_AI = 'false'
  process.env.LLM_PROVIDER = 'openai-compatible'
  process.env.LLM_API_KEY = 'a-key-that-must-never-be-used'
  process.env.ANTHROPIC_API_KEY = 'another-key-that-must-never-be-used'
  process.env.LLM_FALLBACK_PROVIDER = 'anthropic'
})

// The runtime switch (D-691) is the one thing added to this path since the invariant was written,
// and the invariant is that it is *not* on this path: with the flag off the registry never asks
// for the row. The read is doubled so that a registry that did would fail here rather than cost
// every mock delegation a query.
const aiMode = vi.hoisted(() => ({ readAiMode: vi.fn(async () => 'live' as const) }))
vi.mock('@/server/llm/ai-mode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/llm/ai-mode')>()),
  readAiMode: aiMode.readAiMode,
}))

const { getProvider, resetProviderRegistry } = await import('@/server/llm/registry')
const { mockProvider } = await import('@/server/llm/providers/mock')
const { effectiveLlmProvider, ServerEnvSchema } = await import('@/server/config')
const { effectiveAssistantMode } = await import('@/server/llm/ai-mode')

const request = () => ({
  feature: 'assistant' as const,
  promptName: 'assistant-reply',
  promptVersion: 1,
  messages: [
    { role: 'system' as const, content: 'You are the assistant inside a scenario.' },
    { role: 'user' as const, content: 'What is the premium payback?' },
  ],
  promptInput: {
    worldSummary: 'Halden Roastworks is choosing its acquisition mix.',
    request: 'What is the premium payback?',
    claims: [{ id: 'C3', text: 'Premium payback is about 11 months.' }],
  },
  context: { requestId: 'req-registry-unit' },
})

describe('FEATURE_AI=false changes nothing', () => {
  it('returns the mock however loudly LLM_PROVIDER asks for something else (D-029)', () => {
    expect(process.env.LLM_PROVIDER).toBe('openai-compatible')
    expect(effectiveLlmProvider()).toBe('mock')
    expect(getProvider().name).toBe('mock')
  })

  it('answers exactly what the unwrapped mock answers', async () => {
    // The whole point of the chain is that it is transparent when it wraps nothing that can fail.
    // Byte equality against the provider the last thirteen phases were built on.
    const throughRegistry = await getProvider().complete(request())
    const direct = await mockProvider.complete(request())

    expect(throughRegistry.text).toBe(direct.text)
    expect(throughRegistry.model).toBe(direct.model)
    expect(throughRegistry.provider).toBe('mock')
    expect(throughRegistry.usage).toEqual(direct.usage)
  })

  it('streams exactly what the unwrapped mock streams', async () => {
    const collect = async (source: AsyncIterable<StreamChunk>): Promise<string[]> => {
      const seen: string[] = []
      for await (const chunk of source) {
        if (chunk.type === 'text') seen.push(chunk.text)
      }
      return seen
    }
    expect(await collect(getProvider().stream(request()))).toEqual(
      await collect(mockProvider.stream(request())),
    )
  })

  it('opens no socket: no MSW handler is installed, and unhandled requests are errors', async () => {
    // `tests/setup/unit.ts` listens with `onUnhandledRequest: 'error'`, and this file installs no
    // provider handler at all. A chain that reached a network here would fail this test rather than
    // discovering it on the day someone sets a key.
    const requested: string[] = []
    const listener = ({ request: outbound }: { request: Request }): void => {
      requested.push(outbound.url)
    }
    server.events.on('request:start', listener)
    try {
      await getProvider().complete(request())
      for await (const _chunk of getProvider().stream(request())) void _chunk
    } finally {
      server.events.removeListener('request:start', listener)
    }
    expect(requested).toEqual([])
  })

  it('hands out one wrapped instance, so the breaker keeps its counts per provider (D-118)', () => {
    expect(getProvider()).toBe(getProvider())
    resetProviderRegistry()
    // A different instance after a reset, and still the mock.
    expect(getProvider().name).toBe('mock')
  })

  it('never reads the ai_mode row: the environment’s answer is unconditional (D-691)', async () => {
    await getProvider().complete(request())
    for await (const _chunk of getProvider().stream(request())) void _chunk
    expect(aiMode.readAiMode).not.toHaveBeenCalled()
    // And the effect is what the flag says, with nothing asked of the database on the way.
    expect(await effectiveAssistantMode()).toBe('scripted')
  })
})

describe('configuration', () => {
  it('refuses openai-compatible without a key in production, and allows it elsewhere', () => {
    const base = {
      DATABASE_URL: 'postgres://tassl:tassl@localhost:5432/tassl',
      DATABASE_URL_UNPOOLED: 'postgres://tassl:tassl@localhost:5432/tassl',
      BETTER_AUTH_SECRET: 'x'.repeat(48),
      CRON_SECRET: 'a-production-cron-secret',
      NEXT_PUBLIC_APP_URL: 'https://tassl.example',
      FEATURE_AI: 'true',
      LLM_PROVIDER: 'openai-compatible',
    }

    const refused = ServerEnvSchema.safeParse({ ...base, APP_ENV: 'production', LLM_API_KEY: '' })
    expect(refused.success).toBe(false)
    expect(JSON.stringify(refused.error?.issues)).toContain(
      'LLM_API_KEY required for openai-compatible',
    )

    expect(
      ServerEnvSchema.safeParse({ ...base, APP_ENV: 'production', LLM_API_KEY: 'k' }).success,
    ).toBe(true)
    // Local and preview are allowed to name the provider with no key: the flag decides, and with
    // `FEATURE_AI=false` the name is inert anyway.
    expect(ServerEnvSchema.safeParse({ ...base, APP_ENV: 'local', LLM_API_KEY: '' }).success).toBe(
      true,
    )
  })
})
