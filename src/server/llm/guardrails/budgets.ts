// Token budgets (docs/tech/11-llm-integration.md §1.1, §3; D-065).
//
// Two ceilings, checked before every call a network provider makes:
//
//   * **Per user per UTC day**, `LLM_USER_DAILY_TOKEN_BUDGET=200000`. This is the one that stops a
//     single run — or a single student with a script — from spending the institution's month in an
//     afternoon.
//   * **Globally per calendar month**, `LLM_GLOBAL_MONTHLY_TOKEN_BUDGET=20000000`. This is the
//     invoice.
//
// Exceeding either throws `LLM_BUDGET_EXCEEDED` (402), and each feature degrades its own way (§3):
// the assistant pauses the run with a sentence that says what happened and credits the clock, a band
// read holds the run rather than banding it from half the evidence, and a generation step fails
// visibly so the author can hand-author the element or come back tomorrow.
//
// **Three things this file deliberately does not do.**
//
// *It does not reserve.* The check reads what has been spent and the call then spends more, so two
// calls racing at the ceiling can both pass and overshoot by one call each. A reservation would need
// a row written before the call and reconciled after it, on the path a student is waiting on, to buy
// a bound that is already 0.1 percent of the daily figure.
//
// *It does not count the mock.* `llm_calls` carries a row for every mock call too, with real token
// estimates and — deliberately — a zero cost (`calls.ts`), because nobody was billed for them. A
// budget is a spend control, so it sums what was spent: counting a walkthrough run on the default
// configuration against the month's ceiling would let an environment that has never held a key
// arrive at its first real call already over budget (D-651).
//
// *It does not wrap the mock provider.* The registry composes these wrappers around the network
// adapters only, which is what makes `FEATURE_AI=false` change nothing — no budget query on a path
// that spends nothing, and no database read behind an assistant that is a pure function.
import { and, eq, gte, ne, sql } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { env } from '@/server/config'
import { db } from '@/server/db/client'
import { llmCalls } from '@/server/db/schema/platform'
import type {
  CompleteRequest,
  LlmCallContext,
  LlmProvider,
  StructuredRequest,
} from '@/server/llm/provider'

/** The two sums, in tokens; `userDay` is zero for a call with no user behind it (a job). */
export type BudgetUsage = { userDay: number; globalMonth: number }

export type BudgetLimits = { userDaily: number; globalMonthly: number }

/** Which ceiling was reached; the detail on the error and the reason on the ops alert. */
export type BudgetScope = 'user_day' | 'global_month'

export const budgetLimits = (): BudgetLimits => ({
  userDaily: env.LLM_USER_DAILY_TOKEN_BUDGET,
  globalMonthly: env.LLM_GLOBAL_MONTHLY_TOKEN_BUDGET,
})

/** Midnight UTC today. The day is UTC everywhere so that a budget does not move with a timezone. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** The first instant of the calendar month, UTC; §3 says calendar month, not rolling thirty days. */
export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/**
 * The verdict, as a pure function of the two sums and the two ceilings.
 *
 * Separate from the read so that the rule can be tested without a database and so that the rule is
 * one expression rather than one per call site. `>=` rather than `>`: a budget that is exactly spent
 * is spent.
 */
export function budgetVerdict(usage: BudgetUsage, limits: BudgetLimits): BudgetScope | null {
  if (usage.userDay >= limits.userDaily) return 'user_day'
  if (usage.globalMonth >= limits.globalMonthly) return 'global_month'
  return null
}

/** `LLM_BUDGET_EXCEEDED` (402), carrying which ceiling and what it was. */
export function budgetExceeded(
  scope: BudgetScope,
  usage: BudgetUsage,
  limits: BudgetLimits,
): never {
  throw new AppError('LLM_BUDGET_EXCEEDED', undefined, {
    details: {
      scope,
      usedTokens: scope === 'user_day' ? usage.userDay : usage.globalMonth,
      limitTokens: scope === 'user_day' ? limits.userDaily : limits.globalMonthly,
    },
  })
}

/** How the wrapper reads the sums; a parameter so the composition can be tested without Postgres. */
export type BudgetReader = (context: LlmCallContext, now: Date) => Promise<BudgetUsage>

const tokens = sql<number>`coalesce(sum(${llmCalls.inputTokens} + ${llmCalls.outputTokens}), 0)::int`

/**
 * The two sums, from `llm_calls`, in two queries against the two indexes 06 §3.6 declares for exactly
 * this (`llm_calls_user_id_created_at_idx`, `llm_calls_created_at_idx`).
 *
 * `provider <> 'mock'` on both, for the reason in the header. A call with no `userId` — a scoring or
 * generation job — skips the per-user query entirely rather than summing every anonymous call in the
 * institution into one bucket: the daily ceiling is per person, and a job is not one.
 */
export const readBudgetUsage: BudgetReader = async (context, now) => {
  const [monthRow] = await db
    .select({ tokens })
    .from(llmCalls)
    .where(and(gte(llmCalls.createdAt, startOfUtcMonth(now)), ne(llmCalls.provider, 'mock')))

  let userDay = 0
  if (context.userId !== undefined) {
    const [dayRow] = await db
      .select({ tokens })
      .from(llmCalls)
      .where(
        and(
          eq(llmCalls.userId, context.userId),
          gte(llmCalls.createdAt, startOfUtcDay(now)),
          ne(llmCalls.provider, 'mock'),
        ),
      )
    userDay = dayRow?.tokens ?? 0
  }

  return { userDay, globalMonth: monthRow?.tokens ?? 0 }
}

/**
 * What the two sums were when this request's budget was checked, keyed by the request object.
 *
 * The operations panel's two budget-consumption panels need "how much of the ceiling had been spent
 * after this call" (13 §6.3), and the only place that number is known cheaply is here: the check has
 * just read both sums, and the call's own tokens are added to them by the logging wrapper. The
 * alternative was two more `sum()` queries per call, on the path a student is waiting on, for a
 * number that is already in memory (D-662).
 *
 * A `WeakMap` keyed by the request rather than a field on it: the request belongs to the caller, the
 * chain passes the same object down unchanged, and an entry disappears with the request it describes
 * — no lifecycle to manage and nothing to clear between calls. Nothing outside `calls.ts` reads it.
 */
const usageSeen = new WeakMap<object, BudgetUsage>()

/** The sums as they stood before this request's call, or `undefined` when no budget check ran. */
export const budgetUsageOf = (request: object): BudgetUsage | undefined => usageSeen.get(request)

/**
 * Reads both sums, records them against the request, and throws `LLM_BUDGET_EXCEEDED` when either
 * ceiling is reached.
 *
 * Exported on its own because the wrapper below is then three lines, and because the recording has
 * to happen *before* the verdict: a call refused for being over budget is exactly the call whose
 * consumption numbers an operator wants on the dashboard.
 */
export async function assertWithinBudget<R extends { context: LlmCallContext }>(
  request: R,
  read: BudgetReader = readBudgetUsage,
  now: Date = new Date(),
): Promise<BudgetUsage> {
  const limits = budgetLimits()
  const usage = await read(request.context, now)
  usageSeen.set(request, usage)
  const scope = budgetVerdict(usage, limits)
  if (scope !== null) budgetExceeded(scope, usage, limits)
  return usage
}

/**
 * `budgets` in the chain of §1.1: every call, including the repair call inside `structured`, is
 * refused before it is made once the ceiling is reached.
 *
 * The check is made once per `structured` rather than once per underlying `complete` — the repair is
 * part of the same call (§1.2) and refusing it halfway would throw `LLM_BUDGET_EXCEEDED` from a path
 * whose first half had already been spent.
 */
export function withBudgets(
  provider: LlmProvider,
  read: BudgetReader = readBudgetUsage,
): LlmProvider {
  return {
    name: provider.name,

    async complete(req: CompleteRequest) {
      await assertWithinBudget(req, read)
      return provider.complete(req)
    },

    async *stream(req: CompleteRequest) {
      await assertWithinBudget(req, read)
      yield* provider.stream(req)
    },

    async structured<T>(req: StructuredRequest<T>) {
      await assertWithinBudget(req, read)
      return provider.structured<T>(req)
    },
  }
}
