// Step 7.1 — `llm_calls` (docs/tech/11-llm-integration.md §4; 06-data-model.md §3.6; DATA-049,
// NFR-016).
//
// One row per model call, whatever shape the call took. That row is what the daily and monthly token
// budgets sum (D-065), what the operations dashboard reads latency and cost from, and the only place
// a support case can see that a call happened at all — so "per call" has to hold for a completion, a
// stream, a structured call that validated first time, and one that gave up after its repair.
//
// The row also has to be *quiet*: never the prompt, never the completion, and no user identifier
// beyond the opaque id the schema already carries (D-066). The last test reads the whole row back and
// checks that nothing in it echoes the words that went in.
// @db:truncate
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'

type Registry = typeof import('@/server/llm/registry')
type Provider = typeof import('@/server/llm/provider')
type Calls = typeof import('@/server/llm/calls')

let getProvider: Registry['getProvider']
let MOCK_MODEL: Provider['MOCK_MODEL']
let costEstimateUsd: Calls['costEstimateUsd']

type LlmCallRow = {
  feature: string
  prompt_name: string
  prompt_version: number
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  latency_ms: number
  cost_estimate_usd: string
  outcome: string
  user_id: string | null
  run_id: string | null
  package_version_id: string | null
  request_id: string | null
}

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = 'user-under-test'
const REQUEST_TEXT = 'What is the premium payback, and where does that figure come from?'
const CLAIM_TEXT = 'Premium payback is about 11 months on a contribution of 28.20 dollars.'

const context = { userId: USER_ID, runId: RUN_ID, requestId: 'req-integration' }

const assistantRequest = () => ({
  feature: 'assistant' as const,
  promptName: 'assistant-reply',
  promptVersion: 1,
  messages: [
    { role: 'system' as const, content: 'You are an assistant inside a scenario.' },
    { role: 'user' as const, content: REQUEST_TEXT },
  ],
  promptInput: {
    worldSummary: 'Halden Roastworks is deciding its acquisition mix.',
    request: REQUEST_TEXT,
    claims: [{ id: 'c-payback', text: CLAIM_TEXT }],
  },
  context,
})

const rows = async (): Promise<LlmCallRow[]> =>
  testSql<LlmCallRow[]>`select * from llm_calls order by created_at, prompt_name`

describe('llm_calls', () => {
  beforeAll(async () => {
    ;({ getProvider } = await import('@/server/llm/registry'))
    ;({ MOCK_MODEL } = await import('@/server/llm/provider'))
    ;({ costEstimateUsd } = await import('@/server/llm/calls'))
  })

  afterEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await truncateAll()
  })

  it('selects the mock provider while FEATURE_AI is false', () => {
    expect(getProvider().name).toBe('mock')
    // The same wrapped instance every time, so Phase 14's breaker can keep its counts (§1.1).
    expect(getProvider()).toBe(getProvider())
  })

  // Step 14.1 replaced the two throwing placeholders with the adapters of §1.2 and §1.3. The test
  // that asserted the placeholders threw is now the test that they are gone: both names resolve to a
  // provider that answers to its own name, and neither is reachable while `FEATURE_AI=false`.
  it('has both network adapters installed, and reaches neither on the mock', async () => {
    const { openAiCompatibleProvider } = await import('@/server/llm/providers/openai-compatible')
    const { anthropicProvider } = await import('@/server/llm/providers/anthropic')
    expect(openAiCompatibleProvider.name).toBe('openai-compatible')
    expect(anthropicProvider.name).toBe('anthropic')
    expect(getProvider().name).toBe('mock')
  })

  it('writes one row for a completion, with every field §4 names', async () => {
    const result = await getProvider().complete(assistantRequest())

    const [row, ...rest] = await rows()
    expect(rest).toEqual([])
    expect(row).toMatchObject({
      feature: 'assistant',
      prompt_name: 'assistant-reply',
      prompt_version: 1,
      provider: 'mock',
      model: MOCK_MODEL,
      outcome: 'ok',
      user_id: USER_ID,
      run_id: RUN_ID,
      package_version_id: null,
      request_id: 'req-integration',
    })
    expect(row?.input_tokens).toBe(result.usage.inputTokens)
    expect(row?.output_tokens).toBe(result.usage.outputTokens)
    expect(row?.input_tokens).toBeGreaterThan(0)
    expect(row?.latency_ms).toBeGreaterThanOrEqual(0)
    // §1.4: the mock costs nothing, and the row says so rather than leaving it null.
    expect(Number(row?.cost_estimate_usd)).toBe(0)
  })

  it('writes one row for a stream, once the stream has finished', async () => {
    const stream = getProvider().stream(assistantRequest())
    let seen = 0
    for await (const chunk of stream) {
      if (chunk.type === 'text') {
        seen += 1
        // Nothing is logged while the reply is still arriving.
        if (seen === 1) expect(await rows()).toEqual([])
      }
    }

    const written = await rows()
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ feature: 'assistant', outcome: 'ok', provider: 'mock' })
    expect(written[0]?.output_tokens).toBeGreaterThan(0)
  })

  it('logs a stream the consumer abandoned, for what it actually cost', async () => {
    for await (const chunk of getProvider().stream(assistantRequest())) {
      if (chunk.type === 'text') break
    }

    const written = await rows()
    expect(written).toHaveLength(1)
    expect(written[0]?.outcome).toBe('ok')
  })

  it('logs a structured call once, as ok, when the answer validated first time', async () => {
    const result = await getProvider().structured({
      feature: 'band_read',
      promptName: 'band-read-delegation',
      promptVersion: 1,
      messages: [{ role: 'system', content: 'Read the delegation log.' }],
      promptInput: {
        delegations: [
          {
            request: REQUEST_TEXT,
            why: 'I needed the payback to size the share.',
            usedClaimCount: 1,
          },
        ],
      },
      schema: z.object({
        band: z.enum(['novice', 'developing', 'proficient', 'professional']),
        rationale: z.string().min(1),
        quotes: z.array(z.object({ field: z.string(), text: z.string() })),
      }),
      schemaName: 'DelegationRead',
      context,
    })

    expect(result.repaired).toBe(false)
    const written = await rows()
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      feature: 'band_read',
      prompt_name: 'band-read-delegation',
      outcome: 'ok',
    })
  })

  it('logs one row with outcome validation_failed when the repair also failed', async () => {
    const call = getProvider().structured({
      feature: 'band_read',
      promptName: 'band-read-ownership',
      promptVersion: 1,
      messages: [{ role: 'system', content: 'Read the defense.' }],
      promptInput: { qa: [{ question: 'Why that share?', answer: 'Because the memo says so.' }] },
      // A shape the reader never produces, so both the first answer and the repair fail.
      schema: z.object({ somethingElse: z.literal(true) }),
      schemaName: 'ImpossibleRead',
      context,
    })

    await expect(call).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === 'LLM_OUTPUT_INVALID',
    )

    const written = await rows()
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ outcome: 'validation_failed', provider: 'mock' })
    // The repair's tokens are in the row: a failed call still spent them (§1.2).
    expect(written[0]?.input_tokens).toBeGreaterThan(0)
  })

  it('prices a call from the per-million rates, and prices a mock call at nothing', async () => {
    await getProvider().complete(assistantRequest())
    const [row] = await rows()
    const usage = {
      inputTokens: row?.input_tokens ?? 0,
      outputTokens: row?.output_tokens ?? 0,
    }
    expect(row?.cost_estimate_usd).toBe(costEstimateUsd(usage, 'mock'))
    expect(Number(costEstimateUsd(usage, 'openai-compatible'))).toBeGreaterThan(0)
  })

  it('stores no prompt, no completion and no free text (D-066)', async () => {
    await getProvider().complete(assistantRequest())
    const [row] = await rows()
    const serialized = JSON.stringify(row)

    expect(serialized).not.toContain('premium payback')
    expect(serialized).not.toContain(REQUEST_TEXT)
    expect(serialized).not.toContain(CLAIM_TEXT)
    expect(serialized).not.toContain('assistant inside a scenario')
    expect(Object.keys(row ?? {})).toEqual(
      expect.not.arrayContaining(['prompt', 'completion', 'messages', 'response']),
    )
  })

  it('writes a row per call, not per feature', async () => {
    await getProvider().complete(assistantRequest())
    await getProvider().complete(assistantRequest())
    for await (const chunk of getProvider().stream(assistantRequest())) void chunk

    expect(await rows()).toHaveLength(3)
  })
})
