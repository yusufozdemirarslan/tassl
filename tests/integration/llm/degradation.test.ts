// Step 14.2 — the degradation ladder against a provider that is really failing
// (docs/tech/11-llm-integration.md §3; FR-001, FR-140, D-065, D-118, D-656).
//
// Phases 10 and 12 proved each rung of §3's ladder with `MOCK_FAIL_READS` and `MOCK_GEN_FAIL_ONCE`:
// a double asked to be down. This file asks the *network* to be down — `FEATURE_AI=true`,
// `LLM_PROVIDER=openai-compatible`, and MSW answering every MiMo request with a 500 — so that the
// path a real outage takes is exercised end to end: the adapter's error, the retry schedule, the
// circuit breaker, and then the three features' own degradations.
//
// The three rungs, and what each has to be true of:
//
//   * **Assistant.** The delegation fails, the run is Paused with cause `assistant_failure`, the
//     clock stops, and the student is told which of the two outages it was — a component that failed,
//     or a budget that is spent and will still be spent in thirty seconds (D-065).
//   * **Scoring.** The reads do not come back, so the run is *held* rather than banded on half the
//     evidence: `scoring_status = 'held'`, still `defense_complete`, no band written (FR-140).
//   * **Generation.** The step is `failed` with the reason on the row the generation screen renders,
//     and a failure a retry cannot fix — an exhausted budget — burns no second pass (D-656).
//
// The retry schedule is real here (one second, then three), so the tests that drive a 500 all the
// way through carry their own timeouts. That cost is the point: it is the wait a student would
// actually have had.
// @db:truncate
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { anthropicCalls, resetAnthropicCalls } from '@tests/setup/msw/anthropic'
import { mimoCalls, mimoStatus, resetMimoCalls } from '@tests/setup/msw/mimo'
import { server } from '@tests/setup/msw/server'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'

// `src/server/config` parses `process.env` once, at import. These four are what make this file the
// only integration suite in the repository that runs on a network provider.
vi.hoisted(() => {
  process.env.FEATURE_AI = 'true'
  process.env.LLM_PROVIDER = 'openai-compatible'
  process.env.LLM_API_KEY = 'test-mimo-key'
  process.env.LLM_BASE_URL = 'https://token-plan-sgp.xiaomimimo.com/v1'
  process.env.LLM_MODEL = 'mimo-v2.5-pro'
  // D-103: no fallback configured, so an open circuit fails fast rather than reaching a second
  // vendor. The fallback itself is covered in `tests/unit/llm/circuit-breaker.test.ts`.
  process.env.LLM_FALLBACK_PROVIDER = 'none'
  process.env.ANTHROPIC_API_KEY = ''
})

type Assistant = typeof import('@/server/modules/assistant')
type Authoring = typeof import('@/server/modules/authoring')
type Registry = typeof import('@/server/llm/registry')

let assistant: Assistant
let authoring: Authoring
let registry: Registry

beforeAll(() => {
  // `bypass`, not `error`: an integration suite talks to Postgres over a socket MSW does not see,
  // but other in-process clients (Sentry, PostHog) are no-ops without keys rather than absent, and a
  // suite that failed on one of those would be failing for a reason that is not this file's subject.
  server.listen({ onUnhandledRequest: 'bypass' })
})

afterAll(async () => {
  server.close()
  await truncateAll()
})

// 60 s rather than the default 10: the first hook of the file loads the registry, both adapters and
// two modules, and the AI SDK's own import graph is not small.
beforeEach(async () => {
  await truncateAll()
  resetMimoCalls()
  resetAnthropicCalls()
  // The breaker is in memory per process (D-118), so an outage opened by one test would make the
  // next one fail fast for the wrong reason.
  registry = await import('@/server/llm/registry')
  registry.resetProviderRegistry()
  assistant = await import('@/server/modules/assistant')
  authoring = await import('@/server/modules/authoring')
}, 60_000)

afterEach(() => {
  server.resetHandlers()
})

// ---------------------------------------------------------------------------------------------
// The chain is really there
// ---------------------------------------------------------------------------------------------

describe('the chain', () => {
  it('selects the MiMo adapter, because FEATURE_AI is on in this file only', () => {
    expect(registry.getProvider().name).toBe('openai-compatible')
  })

  it('makes three attempts on a 5xx — one call and two retries (§3)', async () => {
    server.use(mimoStatus(500))
    const error = await registry
      .getProvider()
      .complete({
        feature: 'assistant',
        promptName: 'assistant-reply',
        promptVersion: 1,
        messages: [{ role: 'user', content: 'What is the premium payback?' }],
        context: { requestId: 'req-degradation-retries' },
      })
      .catch((thrown: unknown) => thrown)

    expect(isAppError(error) && error.code).toBe('LLM_PROVIDER_ERROR')
    expect(mimoCalls).toHaveLength(3)
    // The row is still written, with the outcome the dashboard breaks down by (§4).
    const [row] = await testSql<{ outcome: string; provider: string }[]>`
      select outcome, provider from llm_calls order by created_at desc limit 1`
    expect(row).toMatchObject({ outcome: 'error', provider: 'openai-compatible' })
  }, 40_000)

  it('opens the circuit after five failed calls and then refuses without a request', async () => {
    server.use(mimoStatus(500))
    const provider = registry.getProvider()
    const call = async (n: number): Promise<unknown> =>
      provider
        .complete({
          feature: 'eval',
          promptName: 'assistant-reply',
          promptVersion: 1,
          messages: [{ role: 'user', content: `call ${String(n)}` }],
          timeoutMs: 30_000,
          context: { requestId: `req-breaker-${String(n)}` },
        })
        .catch((thrown: unknown) => thrown)

    // Five calls at three attempts each is fifteen requests; the fifth call trips the breaker.
    for (let n = 0; n < 5; n += 1) await call(n)
    const before = mimoCalls.length
    const refused = await call(99)

    expect(isAppError(refused) && refused.code).toBe('LLM_CIRCUIT_OPEN')
    expect(mimoCalls).toHaveLength(before)
    // No fallback configured, so nothing reached Anthropic either (D-103).
    expect(anthropicCalls).toHaveLength(0)
  }, 120_000)
})

// ---------------------------------------------------------------------------------------------
// Assistant (FR-001, §3)
// ---------------------------------------------------------------------------------------------

describe('the assistant', () => {
  it('pauses the run, credits the clock, and says the provider did not answer', async () => {
    const { codeOf, delegationRows, pauseRows, runInWorking, setupAssistantFixture } =
      await import('../assistant/fixture')
    const fx = await setupAssistantFixture('degradation-assistant')
    const runId = await runInWorking(fx)

    server.use(mimoStatus(500))
    const code = await codeOf(
      assistant.delegate(fx.student, runId, { request: 'What is the premium payback?' }),
    )

    expect(code).toBe('ASSISTANT_UNAVAILABLE')
    // The row says what was asked and that no answer came, rather than vanishing (FR-001).
    const [delegation] = await delegationRows(runId)
    expect(delegation).toMatchObject({ response_text: '', failed: true, claim_ids: [] })
    // The run is Paused with the cause the overlay reads, and the pause names the delegation.
    const [pause] = await pauseRows(runId)
    expect(pause).toMatchObject({
      cause: 'assistant_failure',
      related_delegation_id: delegation?.id,
    })
    const [run] = await testSql<{ state: string }[]>`select state from runs where id = ${runId}`
    expect(run?.state).toBe('paused')
  }, 60_000)

  it('tells the student a spent budget is a spent budget, not a component to wait out (D-065)', async () => {
    const { delegationRows, runInWorking, setupAssistantFixture } =
      await import('../assistant/fixture')
    const fx = await setupAssistantFixture('degradation-budget')
    const runId = await runInWorking(fx)

    // A day's worth of spend already on the ledger for this student, from a *network* provider:
    // mock rows are excluded on purpose, so a walkthrough cannot exhaust a budget nobody was billed
    // for (D-651).
    await testSql`
      insert into llm_calls
        (feature, prompt_name, prompt_version, provider, model, input_tokens, output_tokens,
         latency_ms, cost_estimate_usd, outcome, user_id, request_id)
      values
        ('assistant', 'assistant-reply', 1, 'openai-compatible', 'mimo-v2.5-pro', 150000, 60000,
         900, 0.128, 'ok', ${fx.student.id}, 'req-seeded-budget')`

    let thrown: unknown
    try {
      const stream = await assistant.delegate(fx.student, runId, {
        request: 'What is the premium payback?',
      })
      for await (const _chunk of stream) void _chunk
    } catch (error) {
      thrown = error
    }

    expect(isAppError(thrown) && thrown.code).toBe('ASSISTANT_UNAVAILABLE')
    expect(isAppError(thrown) && thrown.message).toContain('usage limit reached')
    expect(isAppError(thrown) && (thrown.opts.details as { reason: string }).reason).toBe(
      'budget_exceeded',
    )
    // Nothing went out: the ceiling is checked before the network, not after it.
    expect(mimoCalls).toHaveLength(0)
    const [delegation] = await delegationRows(runId)
    expect(delegation?.response_text).toBe('')
  }, 60_000)

  it('does not count mock rows towards the ceiling (D-651)', async () => {
    const { runInWorking, setupAssistantFixture } = await import('../assistant/fixture')
    const fx = await setupAssistantFixture('degradation-mock-rows')
    const runId = await runInWorking(fx)

    await testSql`
      insert into llm_calls
        (feature, prompt_name, prompt_version, provider, model, input_tokens, output_tokens,
         latency_ms, cost_estimate_usd, outcome, user_id, request_id)
      values
        ('assistant', 'assistant-reply', 1, 'mock', 'mock-v1', 400000, 400000, 3, 0, 'ok',
         ${fx.student.id}, 'req-seeded-mock')`

    server.use(mimoStatus(500))
    const { codeOf } = await import('../assistant/fixture')
    const code = await codeOf(
      assistant.delegate(fx.student, runId, { request: 'What is the premium payback?' }),
    )

    // The budget admitted the call — it reached the provider and failed there instead.
    expect(code).toBe('ASSISTANT_UNAVAILABLE')
    expect(mimoCalls.length).toBeGreaterThan(0)
  }, 60_000)
})

// ---------------------------------------------------------------------------------------------
// Scoring (FR-140, §3)
// ---------------------------------------------------------------------------------------------

describe('the band reads', () => {
  it('all fail as provider errors, which is the condition scoreRun holds a run on', async () => {
    const { loadFixture } = await import('../../unit/scoring/graphs/fixtures')
    const { buildGraphs } = await import('@/server/modules/scoring/graphs')
    const { runBandReads } = await import('@/server/modules/scoring/reads')
    const { draftBands } = await import('@/server/modules/scoring/bands')
    const { categoricalFacts } = await import('@/server/modules/scoring/facts')
    const { currentRubric } = await import('@/server/modules/scoring/rubric')

    const input = loadFixture('marco-8-of-11')
    const graphs = buildGraphs(input)

    server.use(mimoStatus(500))
    const { reads, failures } = await runBandReads(
      {
        events: input.events,
        graphs,
        flaggedDelegationIds: input.flaggedDelegationIds,
        turn: input.packageVersion.turn,
        positions: [],
        documents: [],
        claims: input.packageVersion.claims.map((claim) => ({
          id: claim.id,
          text: claim.text,
          sourceDocumentId: claim.sourceDocumentId,
        })),
        defense: [],
        rubric: currentRubric(),
      },
      registry.getProvider(),
      { runId: '00000000-0000-4000-8000-0000000000ff', requestId: 'req-degradation-reads' },
    )

    // Five reads, five failures, none of them guessed at a band.
    expect(failures).toHaveLength(5)
    expect(failures.every((failure) => failure.reason === 'provider_error')).toBe(true)
    expect(reads).toEqual({})

    // `scoreRun` branches on exactly this: a dimension the recorded events cannot place without a
    // read is `read_failed`, and any of those holds the run (FR-140). The hold itself, its
    // notification and its idempotence are proven on the mock in
    // `tests/integration/scoring/score-run.test.ts`; what this file adds is that a *network* outage
    // arrives at the same place.
    const bands = draftBands({ facts: categoricalFacts(input, graphs), graphs, reads })
    expect(bands.delegation).toMatchObject({ status: 'unassessed', reason: 'read_failed' })
    // The two counted dimensions never asked a model anything and are unmoved by the outage.
    expect(bands.verification.basis).toBe('trace')
    expect(bands.calibration.basis).toBe('trace')

    // Every failed read is on the ledger, so the operations panel sees the outage (§4).
    const rows = await testSql<{ n: number }[]>`
      select count(*)::int as n from llm_calls
      where feature = 'band_read' and outcome = 'error' and provider = 'openai-compatible'`
    expect(rows[0]?.n).toBe(5)
  }, 90_000)
})

// ---------------------------------------------------------------------------------------------
// Generation (§3, D-656)
// ---------------------------------------------------------------------------------------------

describe('generation', () => {
  it('marks the step failed and visible, with the provider’s reason on the row', async () => {
    const { setupAuthoringFixture } = await import('../authoring/fixture')
    const fx = await setupAuthoringFixture('degradation')

    server.use(mimoStatus(500))
    const outcome = await authoring.runGenerationStep({
      packageVersionId: fx.versionId,
      organizationId: fx.orgId,
      step: 'reskin_brief_stakeholders',
      passNumber: 1,
      restatedRules: [],
    })

    // 10 §5 gives a step one retry, and a 500 might not repeat, so this one is retried: `retrying`
    // is the honest outcome and the row is closed out as failed either way.
    expect(outcome.outcome).toBe('retrying')
    const rows = await testSql<{ status: string; error: string | null }[]>`
      select status, error from generation_runs
      where package_version_id = ${fx.versionId} and pass_number = 1`
    expect(rows[0]?.status).toBe('failed')
    expect(rows[0]?.error).toBeTruthy()
  }, 60_000)

  it('burns no second pass on a failure a retry cannot fix (D-656)', async () => {
    const { setupAuthoringFixture } = await import('../authoring/fixture')
    const fx = await setupAuthoringFixture('degradation-budget')

    // The month's ceiling, already spent by somebody. A second pass would fail identically and put
    // "the budget has been used up" into the next prompt as a rule to satisfy.
    await testSql`
      insert into llm_calls
        (feature, prompt_name, prompt_version, provider, model, input_tokens, output_tokens,
         latency_ms, cost_estimate_usd, outcome, request_id)
      values
        ('generation', 'gen-documents', 1, 'openai-compatible', 'mimo-v2.5-pro', 15000000, 6000000,
         900, 12.8, 'ok', 'req-seeded-global-budget')`

    const outcome = await authoring.runGenerationStep({
      packageVersionId: fx.versionId,
      organizationId: fx.orgId,
      step: 'reskin_brief_stakeholders',
      passNumber: 1,
      restatedRules: [],
    })

    expect(outcome.outcome).toBe('failed')
    expect(mimoCalls).toHaveLength(0)
    const rows = await testSql<{ pass_number: number; status: string; error: string | null }[]>`
      select pass_number, status, error from generation_runs
      where package_version_id = ${fx.versionId} order by pass_number`
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ pass_number: 1, status: 'failed' })
    expect(rows[0]?.error).toContain('budget')
  }, 60_000)
})
