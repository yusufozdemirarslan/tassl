// Step 14.2 — token budgets (docs/tech/11-llm-integration.md §3; D-065, D-651).
//
// The rule is a pure function of two sums and two ceilings, and the reader that produces the sums is
// a parameter, so both halves are testable without Postgres: the SQL itself is exercised in
// `tests/integration/llm/degradation.test.ts` against seeded `llm_calls` rows.
//
// The window arithmetic is the part worth pinning. A daily budget that moved with the server's
// timezone would reset at a different hour in every region; §3 says UTC day and calendar month, and
// the two helpers below are what make that a statement rather than an intention.
import { describe, expect, it, vi } from 'vitest'
import { isAppError } from '@/lib/errors'
import {
  budgetVerdict,
  startOfUtcDay,
  startOfUtcMonth,
  withBudgets,
  type BudgetReader,
  type BudgetUsage,
} from '@/server/llm/guardrails/budgets'
import type { LlmProvider } from '@/server/llm/provider'

const LIMITS = { userDaily: 200_000, globalMonthly: 20_000_000 }

const request = () => ({
  feature: 'assistant' as const,
  promptName: 'assistant-reply',
  promptVersion: 1,
  messages: [{ role: 'user' as const, content: 'hello' }],
  context: { userId: 'user-1', requestId: 'req-budget-unit' },
})

const answering = (): LlmProvider => ({
  name: 'openai-compatible',
  complete: vi.fn(async () => ({
    text: 'answered',
    usage: { inputTokens: 1, outputTokens: 1 },
    model: 'mimo-v2.5-pro',
    provider: 'openai-compatible',
  })),
  async *stream() {
    yield { type: 'text' as const, text: 'answered' }
    yield {
      type: 'done' as const,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: 'mimo-v2.5-pro',
      provider: 'openai-compatible',
    }
  },
  structured: vi.fn(async () => ({
    value: {} as never,
    repaired: false,
    raw: '{}',
    usage: { inputTokens: 1, outputTokens: 1 },
    model: 'mimo-v2.5-pro',
    provider: 'openai-compatible',
  })),
})

const reader = (usage: BudgetUsage): BudgetReader => vi.fn(async () => usage)

describe('the windows', () => {
  it('starts the day at midnight UTC, whatever the server’s timezone is', () => {
    expect(startOfUtcDay(new Date('2026-09-08T23:59:59.999Z')).toISOString()).toBe(
      '2026-09-08T00:00:00.000Z',
    )
    expect(startOfUtcDay(new Date('2026-09-09T00:00:00.000Z')).toISOString()).toBe(
      '2026-09-09T00:00:00.000Z',
    )
  })

  it('starts the month on the first, not thirty days back', () => {
    expect(startOfUtcMonth(new Date('2026-09-30T18:00:00Z')).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    )
    expect(startOfUtcMonth(new Date('2026-01-01T00:00:00Z')).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    )
  })
})

describe('the verdict', () => {
  it('admits a call under both ceilings', () => {
    expect(budgetVerdict({ userDay: 199_999, globalMonth: 19_999_999 }, LIMITS)).toBeNull()
  })

  it('names the per-user day when that is the one that was reached', () => {
    expect(budgetVerdict({ userDay: 200_000, globalMonth: 0 }, LIMITS)).toBe('user_day')
  })

  it('names the global month when the day is fine and the month is not', () => {
    expect(budgetVerdict({ userDay: 10, globalMonth: 20_000_000 }, LIMITS)).toBe('global_month')
  })

  it('treats an exactly spent budget as spent', () => {
    expect(budgetVerdict({ userDay: LIMITS.userDaily, globalMonth: 0 }, LIMITS)).toBe('user_day')
  })
})

describe('the wrapper', () => {
  it('lets a call through when there is budget left', async () => {
    const provider = answering()
    const wrapped = withBudgets(provider, reader({ userDay: 10, globalMonth: 10 }))
    await expect(wrapped.complete(request())).resolves.toMatchObject({ text: 'answered' })
    expect(provider.complete).toHaveBeenCalledTimes(1)
  })

  it('refuses with LLM_BUDGET_EXCEEDED before the provider is reached', async () => {
    const provider = answering()
    const wrapped = withBudgets(provider, reader({ userDay: 200_000, globalMonth: 0 }))

    const error = await wrapped.complete(request()).catch((thrown: unknown) => thrown)
    expect(isAppError(error) && error.code).toBe('LLM_BUDGET_EXCEEDED')
    // 402: the request was fine and the account is out (07 §3).
    expect(isAppError(error) && error.status).toBe(402)
    expect(isAppError(error) && (error.opts.details as { scope: string }).scope).toBe('user_day')
    // The whole point: nothing was spent finding out.
    expect(provider.complete).not.toHaveBeenCalled()
  })

  it('refuses a stream before its first chunk', async () => {
    const wrapped = withBudgets(answering(), reader({ userDay: 0, globalMonth: 20_000_000 }))
    const iterate = async (): Promise<void> => {
      for await (const _chunk of wrapped.stream(request())) void _chunk
    }
    await expect(iterate()).rejects.toMatchObject({ code: 'LLM_BUDGET_EXCEEDED' })
  })

  it('checks once per structured call, not once per underlying completion (§1.2)', async () => {
    const read = reader({ userDay: 0, globalMonth: 0 })
    const wrapped = withBudgets(answering(), read)
    await wrapped.structured({
      ...request(),
      schema: { safeParse: () => ({}) } as never,
      schemaName: 'X',
    })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('carries the ceiling and what was spent, so an operator can see which one it was', async () => {
    const wrapped = withBudgets(answering(), reader({ userDay: 0, globalMonth: 25_000_000 }))
    const error = await wrapped.complete(request()).catch((thrown: unknown) => thrown)
    expect(isAppError(error) && error.opts.details).toMatchObject({
      scope: 'global_month',
      usedTokens: 25_000_000,
      limitTokens: 20_000_000,
    })
  })
})
