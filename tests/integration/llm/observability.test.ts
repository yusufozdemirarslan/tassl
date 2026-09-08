// Step 14.5 — the LLM observability panel (docs/tech/13-observability-ops.md §5, §6.3, §7;
// 11-llm-integration.md §4; NFR-016, SYS-014, DATA-049, D-065, D-066, D-118).
//
// `tests/integration/llm/calls.test.ts` proves the *row*. This file proves everything the row feeds:
// the `ops_llm_call` counter every panel of 13 §6.3 is built from, and the three Sentry alerts of
// §7 — `NFR-016 LLM errors`, `NFR-016 circuit open`, `NFR-016 budget exceeded` — which fire off the
// `ops` tag alone and are read by their other tags.
//
// **Seven outcomes, one shape.** `llm_calls.outcome` has seven values (06 §3.6) and a dashboard that
// only ever sees three of them is a dashboard that is wrong on the day it matters. So every one is
// produced here for real — through the whole chain, against a MiMo double — and each is asserted to
// write its row *and* emit its counter with the properties 13 §5 lists. `ok` and `repaired` are the
// two that must not alert; the other five are the ones an operator is woken for.
//
// **And the invariant the whole step exists to hold: no prompt text and no completion text leaves
// the process.** The last describe block takes everything that was captured — every PostHog payload,
// every Sentry tag — and asserts that none of it contains a word of the request, the system message,
// or the answer. It is asserted over the *captured transport payloads* rather than over the code,
// because that is where a leak would actually be: a property added to an event without a thought,
// or an ops attribute assembled from whatever the call site had at hand.
//
// The two sinks are faked at their boundaries — `posthog-node`'s client and `@sentry/nextjs` — so
// the real `track`, `trackOps`, `safeOpsProperties` and `alertOps` all run. That is deliberate: the
// property allowlist of 17 §6 is one of the two guards this step is checked against, and a test that
// mocked `trackOps` would step over it.
// @db:truncate
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  mimoCompletion,
  mimoCompletionSequence,
  mimoNetworkError,
  mimoSlow,
  mimoStatus,
  resetMimoCalls,
} from '@tests/setup/msw/mimo'
import { server } from '@tests/setup/msw/server'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'

// `src/server/config` parses `process.env` once, at import: the network provider, and — unlike every
// other suite — a PostHog key, so `getPosthogServer()` constructs the faked client below and the
// real transport runs end to end. The key is a literal, never a real one; nothing is sent anywhere.
vi.hoisted(() => {
  process.env.FEATURE_AI = 'true'
  process.env.LLM_PROVIDER = 'openai-compatible'
  process.env.LLM_API_KEY = 'test-mimo-key'
  process.env.LLM_BASE_URL = 'https://token-plan-sgp.xiaomimimo.com/v1'
  process.env.LLM_MODEL = 'mimo-v2.5-pro'
  process.env.LLM_FALLBACK_PROVIDER = 'none'
  process.env.ANTHROPIC_API_KEY = ''
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key_not_a_real_key'
  process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
})

type Captured = {
  distinctId: string
  event: string
  properties: Record<string, unknown>
}

const captured: Captured[] = []

vi.mock('posthog-node', () => ({
  PostHog: class {
    capture(payload: Captured) {
      captured.push(payload)
    }
    async shutdown() {
      /* nothing to flush: the events are in `captured` */
    }
  },
}))

type SentryEvent = { message: string; level: string; tags: Record<string, string> }

const sentryEvents: SentryEvent[] = []
let pendingTags: Record<string, string> = {}

// Only the two entry points `alertOps` uses, plus the no-ops anything else in the import graph might
// reach. The real SDK is exercised in `tests/integration/system/sentry-noop.test.ts`.
vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (scope: unknown) => unknown) => {
    pendingTags = {}
    const scope = {
      setTag: (key: string, value: string) => {
        pendingTags[key] = value
      },
      setFingerprint: () => undefined,
      setLevel: () => undefined,
      setContext: () => undefined,
    }
    const result = fn(scope)
    pendingTags = {}
    return result
  },
  captureMessage: (message: string, level: string) => {
    sentryEvents.push({ message, level, tags: { ...pendingTags } })
    return 'event-id'
  },
  captureException: () => 'event-id',
  setTag: () => undefined,
  addBreadcrumb: () => undefined,
  startSpan: (_options: unknown, fn: () => unknown) => fn(),
}))

type Registry = typeof import('@/server/llm/registry')

let registry: Registry

// The prompt and the answer, in one place, so the leak test at the bottom can look for every one of
// them. They read like a real delegation on purpose: a check that a synthetic token is absent proves
// less than a check that the sentence a student actually wrote is.
const SYSTEM_TEXT = 'You are an assistant inside a scenario. Never say which claim is defective.'
const REQUEST_TEXT = 'What is the premium payback, and where does that figure come from?'
const ANSWER_TEXT =
  'The payback figure is in the supplier memo, which is dated before the contract was signed.'

const RUN_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = 'observability-user'

const completeRequest = (requestId: string, extra: Record<string, unknown> = {}) => ({
  feature: 'assistant' as const,
  promptName: 'assistant-reply',
  promptVersion: 3,
  messages: [
    { role: 'system' as const, content: SYSTEM_TEXT },
    { role: 'user' as const, content: REQUEST_TEXT },
  ],
  promptInput: { request: REQUEST_TEXT },
  context: { userId: USER_ID, runId: RUN_ID, requestId },
  ...extra,
})

// Both messages, and deliberately: D-657 lifts every system message into the SDK's `instructions`,
// so a request whose only message is a system one arrives at the adapter with an empty array.
const structuredRequest = (requestId: string) => ({
  feature: 'band_read' as const,
  promptName: 'band-read-delegation',
  promptVersion: 2,
  messages: [
    { role: 'system' as const, content: SYSTEM_TEXT },
    { role: 'user' as const, content: REQUEST_TEXT },
  ],
  promptInput: { request: REQUEST_TEXT },
  schema: z.object({ band: z.enum(['novice', 'professional']), rationale: z.string().min(1) }),
  schemaName: 'DelegationRead',
  context: { userId: USER_ID, runId: RUN_ID, requestId },
})

type Row = {
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
  request_id: string | null
}

const lastRow = async (): Promise<Row | undefined> => {
  const rows = await testSql<Row[]>`select * from llm_calls order by created_at desc limit 1`
  return rows[0]
}

/** The `ops_llm_call` counter for the most recent call, as PostHog would have received it. */
const lastCounter = (): Captured | undefined =>
  [...captured].reverse().find((entry) => entry.event === 'ops_llm_call')

const alertsTagged = (name: string): SentryEvent[] =>
  sentryEvents.filter((event) => event.tags.ops === name)

/** A call that is expected to fail, with the error rather than the rejection. */
const failing = async (call: Promise<unknown>): Promise<unknown> => call.catch((e: unknown) => e)

beforeAll(() => {
  // `bypass`: Postgres is a socket MSW does not see, and the faked sinks open no connection at all.
  server.listen({ onUnhandledRequest: 'bypass' })
})

afterAll(async () => {
  server.close()
  await truncateAll()
})

// 60 s: the first hook loads the registry, the adapters and the AI SDK's import graph.
beforeEach(async () => {
  await truncateAll()
  resetMimoCalls()
  captured.length = 0
  sentryEvents.length = 0
  registry = await import('@/server/llm/registry')
  // The breaker is in memory per process (D-118): an outage opened by one test would make the next
  // one fail fast for a reason that is not its subject.
  registry.resetProviderRegistry()
}, 60_000)

afterEach(() => {
  server.resetHandlers()
})

// ---------------------------------------------------------------------------------------------
// The counter's shape (13 §5, §6.3)
// ---------------------------------------------------------------------------------------------

describe('ops_llm_call', () => {
  it('carries every property 13 §5 lists, on a call that succeeded', async () => {
    server.use(mimoCompletion(ANSWER_TEXT))
    await registry.getProvider().complete(completeRequest('req-obs-ok'))

    const counter = lastCounter()
    expect(counter?.event).toBe('ops_llm_call')
    expect(counter?.properties).toMatchObject({
      feature: 'assistant',
      // `prompt` and `version`, not `prompt_name` and `prompt_version`: the runtime allowlist of
      // 17 §6 drops any key whose last word is `name`, so the documented spelling would have been
      // swallowed silently and the panel would have had a column that never arrives (D-660).
      prompt: 'assistant-reply',
      version: 3,
      provider: 'openai-compatible',
      model: 'mimo-v2.5-pro',
      outcome: 'ok',
      run_id: RUN_ID,
      source: 'server',
    })
    expect(counter?.properties.latency_ms).toBeGreaterThanOrEqual(0)
    expect(counter?.properties.input_tokens).toBeGreaterThan(0)
    expect(counter?.properties.output_tokens).toBeGreaterThan(0)
    // A real provider costs real money, and the cost panel sums exactly this property (§6.3).
    expect(Number(counter?.properties.cost_estimate_usd)).toBeGreaterThan(0)
    // No person: the counter is keyed by the hashed id (17 §5.2), which is what makes the per-user
    // budget panel possible without anybody being named.
    expect(counter?.distinctId).not.toBe(USER_ID)
    expect(counter?.distinctId).toMatch(/^[0-9a-f]{16}$/)
  })

  it('reports both budget ceilings as they stood after the call (§6.3)', async () => {
    // A day already partly spent, from a network provider — mock rows are excluded on purpose so a
    // walkthrough cannot exhaust a budget nobody was billed for (D-651).
    await testSql`
      insert into llm_calls
        (feature, prompt_name, prompt_version, provider, model, input_tokens, output_tokens,
         latency_ms, cost_estimate_usd, outcome, user_id, request_id)
      values
        ('assistant', 'assistant-reply', 1, 'openai-compatible', 'mimo-v2.5-pro', 900, 100,
         12, 0.001, 'ok', ${USER_ID}, 'req-seed')`

    server.use(mimoCompletion(ANSWER_TEXT))
    await registry.getProvider().complete(completeRequest('req-obs-budget-numbers'))

    const properties = lastCounter()?.properties ?? {}
    const spent = Number(properties.input_tokens) + Number(properties.output_tokens)
    // 1,000 tokens were on the ledger before this call; both numbers are that plus what it spent.
    expect(properties.user_daily_tokens_after).toBe(1000 + spent)
    expect(properties.global_monthly_tokens_after).toBe(1000 + spent)
  })

  it('sends no budget numbers for a call the mock answered, because it spends nothing', async () => {
    // The one place `FEATURE_AI` is turned back off: the mock is not wrapped in budgets (D-651), so
    // there is no consumption to report and the panel must show a gap rather than a zero.
    const config = await import('@/server/config')
    vi.spyOn(config, 'effectiveLlmProvider').mockReturnValue('mock')
    registry.resetProviderRegistry()
    try {
      await registry.getProvider().complete(completeRequest('req-obs-mock'))
    } finally {
      vi.restoreAllMocks()
      registry.resetProviderRegistry()
    }

    const properties = lastCounter()?.properties ?? {}
    expect(properties.provider).toBe('mock')
    expect(properties).not.toHaveProperty('user_daily_tokens_after')
    expect(properties).not.toHaveProperty('global_monthly_tokens_after')
    // §1.4: nobody was billed, and the counter says so rather than pricing an estimate.
    expect(Number(properties.cost_estimate_usd)).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Every outcome (06 §3.6): the row, the counter, and whether it wakes anybody (13 §7)
// ---------------------------------------------------------------------------------------------

describe('outcomes', () => {
  it('ok — one row, one counter, no alert', async () => {
    server.use(mimoCompletion(ANSWER_TEXT))
    await registry.getProvider().complete(completeRequest('req-obs-outcome-ok'))

    expect((await lastRow())?.outcome).toBe('ok')
    expect(lastCounter()?.properties.outcome).toBe('ok')
    expect(sentryEvents).toEqual([])
  })

  it('repaired — the repair is part of the same call, and is not an error', async () => {
    server.use(
      mimoCompletionSequence([
        'not json at all',
        JSON.stringify({ band: 'professional', rationale: 'Cited the memo.' }),
      ]),
    )
    const result = await registry.getProvider().structured(structuredRequest('req-obs-repaired'))

    expect(result.repaired).toBe(true)
    // One row, not two: §1.2 defines the repair as part of the call, and its tokens are summed.
    const rows = await testSql<Row[]>`select * from llm_calls`
    expect(rows).toHaveLength(1)
    expect(rows[0]?.outcome).toBe('repaired')
    expect(lastCounter()?.properties.outcome).toBe('repaired')
    expect(sentryEvents).toEqual([])
  })

  it('validation_failed — the row, the counter, and an llm_error alert', async () => {
    server.use(mimoCompletion('still not the shape anybody asked for'))
    const error = await failing(registry.getProvider().structured(structuredRequest('req-obs-inv')))

    expect(isAppError(error) && error.code).toBe('LLM_OUTPUT_INVALID')
    expect((await lastRow())?.outcome).toBe('validation_failed')
    expect(lastCounter()?.properties.outcome).toBe('validation_failed')
    expect(alertsTagged('llm_error')).toHaveLength(1)
    expect(alertsTagged('llm_error')[0]?.tags).toMatchObject({
      feature: 'band_read',
      provider: 'openai-compatible',
      outcome: 'validation_failed',
    })
  })

  it('timeout — the row, the counter, and an llm_error alert', async () => {
    server.use(mimoSlow(400))
    const error = await failing(
      registry.getProvider().complete(completeRequest('req-obs-timeout', { timeoutMs: 40 })),
    )

    // A timeout is the abort signal firing, and it arrives as a `TimeoutError` rather than an
    // `AppError` — which is exactly what `outcomeOf` reads to tell it from a provider error (D-653).
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('TimeoutError')
    expect((await lastRow())?.outcome).toBe('timeout')
    expect(lastCounter()?.properties.outcome).toBe('timeout')
    expect(alertsTagged('llm_error')[0]?.tags.outcome).toBe('timeout')
  }, 30_000)

  it('error — the row, the counter, and an llm_error alert', async () => {
    server.use(mimoStatus(500))
    const error = await failing(
      registry.getProvider().complete(completeRequest('req-obs-error', { timeoutMs: 5_000 })),
    )

    expect(isAppError(error) && error.code).toBe('LLM_PROVIDER_ERROR')
    expect((await lastRow())?.outcome).toBe('error')
    expect(lastCounter()?.properties.outcome).toBe('error')
    expect(alertsTagged('llm_error')[0]?.tags).toMatchObject({
      feature: 'assistant',
      prompt: 'assistant-reply',
      provider: 'openai-compatible',
      outcome: 'error',
    })
  }, 30_000)

  it('budget_exceeded — the row, the counter, and the alert 13 §7 wakes somebody for', async () => {
    // A day's worth of spend already on this student's ledger: `LLM_USER_DAILY_TOKEN_BUDGET` is
    // 200,000 tokens (D-065), and `>=` means a budget that is exactly spent is spent.
    await testSql`
      insert into llm_calls
        (feature, prompt_name, prompt_version, provider, model, input_tokens, output_tokens,
         latency_ms, cost_estimate_usd, outcome, user_id, request_id)
      values
        ('assistant', 'assistant-reply', 1, 'openai-compatible', 'mimo-v2.5-pro', 200000, 0,
         12, 0.122, 'ok', ${USER_ID}, 'req-seed-budget')`

    server.use(mimoCompletion(ANSWER_TEXT))
    const error = await failing(registry.getProvider().complete(completeRequest('req-obs-budget')))

    expect(isAppError(error) && error.code).toBe('LLM_BUDGET_EXCEEDED')
    const row = await lastRow()
    expect(row?.outcome).toBe('budget_exceeded')
    // Refused before the network: nothing was spent, and the row says so.
    expect(row?.input_tokens).toBe(0)
    expect(row?.output_tokens).toBe(0)

    const properties = lastCounter()?.properties ?? {}
    expect(properties.outcome).toBe('budget_exceeded')
    // The two numbers are the sums that caused the refusal, which is the point on the graph where
    // the ceiling was met.
    expect(properties.user_daily_tokens_after).toBe(200_000)

    expect(alertsTagged('budget_exceeded')).toHaveLength(1)
    expect(alertsTagged('budget_exceeded')[0]).toMatchObject({
      message: 'ops.budget_exceeded',
      level: 'warning',
      tags: {
        ops: 'budget_exceeded',
        feature: 'assistant',
        provider: 'openai-compatible',
        outcome: 'budget_exceeded',
      },
    })
    // A spent budget is not a provider error: it must not also fire the error rule (§7).
    expect(alertsTagged('llm_error')).toEqual([])
  })

  it('circuit_open — the row, the counter, and the circuit_open alert', async () => {
    server.use(mimoNetworkError())
    const provider = registry.getProvider()
    const call = (n: number): Promise<unknown> =>
      failing(
        provider.complete(completeRequest(`req-obs-breaker-${String(n)}`, { timeoutMs: 5_000 })),
      )

    // Five consecutive failed calls trip the breaker (D-118); the sixth is refused without a request.
    for (let n = 0; n < 5; n += 1) await call(n)
    sentryEvents.length = 0
    captured.length = 0
    const refused = await call(99)

    expect(isAppError(refused) && refused.code).toBe('LLM_CIRCUIT_OPEN')
    expect((await lastRow())?.outcome).toBe('circuit_open')
    expect(lastCounter()?.properties.outcome).toBe('circuit_open')
    expect(alertsTagged('circuit_open')[0]?.tags).toMatchObject({
      ops: 'circuit_open',
      feature: 'assistant',
      provider: 'openai-compatible',
      outcome: 'circuit_open',
    })
  }, 120_000)
})

// ---------------------------------------------------------------------------------------------
// The invariant (11 §4, D-066, 17 §1 rule 3)
// ---------------------------------------------------------------------------------------------

describe('no prompt or completion text leaves the process', () => {
  it('holds across every sink, on every outcome this file produces', async () => {
    server.use(mimoCompletion(ANSWER_TEXT))
    await registry.getProvider().complete(completeRequest('req-obs-quiet'))
    server.use(mimoStatus(500))
    await failing(
      registry.getProvider().complete(completeRequest('req-obs-quiet-error', { timeoutMs: 5_000 })),
    )

    // Everything that was handed to a transport, in one string.
    const outbound = JSON.stringify({ posthog: captured, sentry: sentryEvents })
    for (const words of [SYSTEM_TEXT, REQUEST_TEXT, ANSWER_TEXT, 'premium payback', 'defective']) {
      expect(outbound).not.toContain(words)
    }

    // And the row, which outlives both (D-066).
    const rows = await testSql<Row[]>`select * from llm_calls`
    const stored = JSON.stringify(rows)
    for (const words of [SYSTEM_TEXT, REQUEST_TEXT, ANSWER_TEXT]) {
      expect(stored).not.toContain(words)
    }

    // Both events are the catalogue's and the counter's, and nothing else was emitted about a call.
    const events = [...new Set(captured.map((entry) => entry.event))].sort()
    expect(events).toEqual(['llm_call', 'ops_llm_call'])
  }, 30_000)

  it('sends the digest of a prompt to the debug log and never the prompt (§4)', async () => {
    const { promptDigest } = await import('@/server/llm/calls')
    const digest = promptDigest([
      { role: 'system', content: SYSTEM_TEXT },
      { role: 'user', content: REQUEST_TEXT },
    ])
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(digest).not.toContain('payback')
    // The same two messages always give the same digest, which is what makes it useful for support.
    expect(
      promptDigest([
        { role: 'system', content: SYSTEM_TEXT },
        { role: 'user', content: REQUEST_TEXT },
      ]),
    ).toBe(digest)
  })
})
