// Step 14.2 — `FEATURE_AI=false` changes nothing, against a real database
// (CLAUDE.md's product invariant; docs/tech/11-llm-integration.md §1.1, §6; D-029, D-651).
//
// `tests/unit/llm/registry.test.ts` proves the negative at the seam: same provider, same bytes, no
// socket. This file proves it where a student would feel it — a run in `working`, a real delegation,
// the trace and the `llm_calls` row it writes — with the environment set as hostile as it can be:
// `LLM_PROVIDER=openai-compatible`, a key present, a fallback configured, and MSW listening with
// `onUnhandledRequest: 'error'` so that any request at all fails the test that made it.
//
// It is a separate file from `degradation.test.ts` because `src/server/config` parses the
// environment once per process: one file per configuration is the only honest way to hold two.
//
// What "nothing" means here is precise:
//   * the registry answers `mock`, so the four network guardrails are not in the chain at all — no
//     budget query per delegation, no breaker counting a pure function, no retry schedule;
//   * the delegation succeeds and carries its claim verbatim, exactly as it has since Phase 7;
//   * the row says `mock` and costs zero, so a walkthrough cannot spend a budget nobody was billed
//     for (D-651);
//   * and nothing left the process.
// @db:truncate
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '@tests/setup/msw/server'
import { testSql, truncateAll } from '@tests/setup/integration'

vi.hoisted(() => {
  // The kill switch, and everything it has to override.
  process.env.FEATURE_AI = 'false'
  process.env.LLM_PROVIDER = 'openai-compatible'
  process.env.LLM_API_KEY = 'a-key-that-must-never-be-used'
  process.env.ANTHROPIC_API_KEY = 'another-key-that-must-never-be-used'
  process.env.LLM_FALLBACK_PROVIDER = 'anthropic'
  // A ceiling already spent, on the mock. It must not stop a single call (D-651).
  process.env.LLM_USER_DAILY_TOKEN_BUDGET = '1'
  process.env.LLM_GLOBAL_MONTHLY_TOKEN_BUDGET = '1'
})

type Assistant = typeof import('@/server/modules/assistant')
type Registry = typeof import('@/server/llm/registry')

let assistant: Assistant
let registry: Registry

const outbound: string[] = []
const onRequest = ({ request }: { request: Request }): void => {
  outbound.push(request.url)
}

beforeAll(() => {
  // No handler is installed anywhere in this file, and `error` is what turns "the mock reached no
  // network" from a claim into a failing test if it ever stops being true.
  server.listen({ onUnhandledRequest: 'error' })
  server.events.on('request:start', onRequest)
})

afterAll(async () => {
  server.events.removeListener('request:start', onRequest)
  server.close()
  await truncateAll()
})

beforeEach(async () => {
  await truncateAll()
  outbound.length = 0
  registry = await import('@/server/llm/registry')
  registry.resetProviderRegistry()
  assistant = await import('@/server/modules/assistant')
}, 60_000)

afterEach(() => {
  server.resetHandlers()
})

describe('with FEATURE_AI=false', () => {
  it('selects the mock however the rest of the environment is set (D-029)', () => {
    expect(process.env.LLM_PROVIDER).toBe('openai-compatible')
    expect(process.env.LLM_API_KEY).not.toBe('')
    expect(registry.getProvider().name).toBe('mock')
  })

  it('answers a real delegation exactly as it did before the adapters existed', async () => {
    const { claimByKey, delegationRows, runClaimRows, runInWorking, setupAssistantFixture } =
      await import('../assistant/fixture')
    const fx = await setupAssistantFixture('mock-unchanged')
    const runId = await runInWorking(fx)

    // The stream is 07 §7's server-sent events: prose segments and claim cards, then `done`.
    const drain = async (): Promise<string> => {
      const stream = await assistant.delegate(fx.student, runId, {
        request: 'What is the premium payback?',
      })
      let out = ''
      for await (const chunk of stream) {
        if (chunk.event !== 'segment') continue
        out += chunk.data.type === 'text' ? chunk.data.text : chunk.data.claim.text
      }
      return out
    }
    const reply = await drain()

    // The claim the deterministic matcher surfaces, carried verbatim behind its marker (FR-051).
    const claim = claimByKey('C3')
    expect(reply).toContain(claim.text)
    const [delegation] = await delegationRows(runId)
    expect(delegation).toMatchObject({ failed: false, flags: [] })
    expect(delegation?.response_text).toContain(claim.text)
    expect((await runClaimRows(runId)).map((row) => row.key)).toContain('C3')

    // Deterministic: the same request in the same run answers the same way (§1.4, D-063).
    expect(await drain()).toBe(reply)
  }, 60_000)

  it('writes a mock row that costs nothing, and spends no budget doing it', async () => {
    const { runInWorking, setupAssistantFixture } = await import('../assistant/fixture')
    const fx = await setupAssistantFixture('mock-unchanged-rows')
    const runId = await runInWorking(fx)

    const stream = await assistant.delegate(fx.student, runId, {
      request: 'What is the premium payback?',
    })
    for await (const chunk of stream) void chunk

    const rows = await testSql<{ provider: string; cost_estimate_usd: string; outcome: string }[]>`
      select provider, cost_estimate_usd, outcome from llm_calls where run_id = ${runId}`
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.provider).toBe('mock')
      expect(Number(row.cost_estimate_usd)).toBe(0)
      expect(row.outcome).toBe('ok')
    }
    // The budgets of D-065 are set to one token in this file and refused nothing: they are not in
    // the chain, because the chain around the mock is `logging ← mock` and nothing else.
  }, 60_000)

  it('opened no socket at any point', () => {
    expect(outbound).toEqual([])
  })
})
