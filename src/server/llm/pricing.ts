// What a model call cost (docs/tech/11-llm-integration.md §4, D-749): the estimate `llm_calls.cost_estimate_usd`
// carries, the cost panel sums and the monthly dollar ceiling reads. Pure, so a unit test can price a
// call without the database client the logging wrapper needs.
import { env } from '@/server/config'
import type { LlmUsage } from '@/server/llm/provider'

/** USD per million tokens, input and output (§4). Output includes the thinking a model did. */
export type ModelPrice = { input: number; output: number }

/**
 * Anthropic's list prices for the Claude models this deployment can name (D-749). A Claude model's
 * price is a property of the model rather than of the deployment, so it is written here and moves
 * with the model id; `LLM_INPUT_USD_PER_MTOK` and `LLM_OUTPUT_USD_PER_MTOK` price every model this
 * table does not name, which is how the MiMo adapter has always been priced.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

export const priceFor = (model: string): ModelPrice =>
  MODEL_PRICES[model] ?? { input: env.LLM_INPUT_USD_PER_MTOK, output: env.LLM_OUTPUT_USD_PER_MTOK }

/**
 * `tokens / 1e6 x USD per MTok`, at the six-decimal scale of `llm_calls.cost_estimate_usd` (§4).
 *
 * Zero for the mock, whatever it counted. Its tokens are an estimate of work nobody was billed for,
 * and pricing them would put a number in the cost panel and in the monthly spend that no invoice
 * will ever match. The token counts are still recorded, so the budgets of D-065 have something to
 * sum and can be exercised without a key.
 */
export function costEstimateUsd(usage: LlmUsage, provider: string, model: string): string {
  if (provider === 'mock') return (0).toFixed(6)
  const price = priceFor(model)
  const dollars =
    (usage.inputTokens / 1_000_000) * price.input + (usage.outputTokens / 1_000_000) * price.output
  return dollars.toFixed(6)
}
