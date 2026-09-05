// Call logging: one `llm_calls` row per model call (docs/tech/11-llm-integration.md §4, DATA-049,
// NFR-016, 06-data-model.md §3.6).
//
// The row is the only durable record that a call happened, and three things depend on it: the daily
// and monthly token budgets (D-065) sum it, the operations dashboard reads error rate, latency and
// cost from it, and support answers "what did the assistant do for this run" from it. It carries no
// prompt and no completion text — never the words, only the shape of the call — because the
// prompt holds student writing and package internals and this table outlives both (D-066). What it
// does carry, at `debug` level and nowhere else, is a sha256 of the rendered prompt, so two support
// cases can be told apart or recognised as the same call.
//
// Logging never fails a call. A failed insert is logged and swallowed: an observability write that
// could pause a student's run would be a worse bug than the missing row.
import { createHash } from 'node:crypto'
import { AppError, isAppError } from '@/lib/errors'
import { hashUserId } from '@/server/analytics/distinct-id'
import { env } from '@/server/config'
import { db } from '@/server/db/client'
import { llmCalls } from '@/server/db/schema/platform'
import { getLogger } from '@/server/http/request-context'
import { alertOps, countOps } from '@/server/logging/ops-events'
import type {
  CompleteRequest,
  LlmFeature,
  LlmMessage,
  LlmProvider,
  LlmUsage,
  StreamChunk,
  StructuredRequest,
} from '@/server/llm/provider'
import { defaultModelFor, messagesText } from '@/server/llm/provider'

/** `llm_calls.outcome` (06 §3.6); the vocabulary §4 and the analytics event share. */
export type LlmOutcome =
  'ok' | 'validation_failed' | 'repaired' | 'timeout' | 'error' | 'budget_exceeded' | 'circuit_open'

export type LlmCallRecord = {
  feature: LlmFeature
  promptName: string
  promptVersion: number
  provider: string
  model: string
  usage: LlmUsage
  latencyMs: number
  outcome: LlmOutcome
  context: CompleteRequest['context']
}

/**
 * `tokens / 1e6 x USD per MTok`, at the six-decimal scale of `llm_calls.cost_estimate_usd` (§4).
 *
 * Zero for the mock, whatever it counted. Its tokens are an estimate of work nobody was billed for,
 * and pricing them would put a number in the cost panel and in the monthly spend that no invoice
 * will ever match. The token counts are still recorded, so the budgets of D-065 have something to
 * sum and can be exercised without a key.
 */
export function costEstimateUsd(usage: LlmUsage, provider: string): string {
  if (provider === 'mock') return (0).toFixed(6)
  const dollars =
    (usage.inputTokens / 1_000_000) * env.LLM_INPUT_USD_PER_MTOK +
    (usage.outputTokens / 1_000_000) * env.LLM_OUTPUT_USD_PER_MTOK
  return dollars.toFixed(6)
}

/** De-duplication key for support cases (§4). The digest, never the text. */
export const promptDigest = (messages: readonly LlmMessage[]): string =>
  createHash('sha256').update(messagesText(messages)).digest('hex')

/**
 * The outcome an error means. `LLM_OUTPUT_INVALID` is the structured path giving up after its one
 * repair (§1.2); a timeout is the abort signal firing, which arrives as a `TimeoutError` or an
 * `AbortError` depending on the runtime, so both names are read.
 */
export function outcomeOf(error: unknown): LlmOutcome {
  if (isAppError(error)) {
    if (error.code === 'LLM_OUTPUT_INVALID') return 'validation_failed'
    if (error.code === 'LLM_BUDGET_EXCEEDED') return 'budget_exceeded'
    if (error.code === 'LLM_CIRCUIT_OPEN') return 'circuit_open'
    return 'error'
  }
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout'
  return 'error'
}

const ALERTING_OUTCOMES: ReadonlySet<LlmOutcome> = new Set<LlmOutcome>([
  'validation_failed',
  'timeout',
  'error',
])

/**
 * Writes the row, the operational counter and the debug digest. Never throws.
 *
 * The insert runs on `db`, deliberately outside any caller transaction: a call that was made is a
 * fact, and a delegation that rolls back must not erase the tokens it spent.
 */
export async function recordLlmCall(
  record: LlmCallRecord,
  messages: readonly LlmMessage[],
): Promise<void> {
  const cost = costEstimateUsd(record.usage, record.provider)
  const logger = getLogger()

  try {
    await db.insert(llmCalls).values({
      feature: record.feature,
      promptName: record.promptName,
      promptVersion: record.promptVersion,
      provider: record.provider,
      model: record.model,
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
      latencyMs: record.latencyMs,
      costEstimateUsd: cost,
      outcome: record.outcome,
      userId: record.context.userId ?? null,
      runId: record.context.runId ?? null,
      packageVersionId: record.context.packageVersionId ?? null,
      requestId: record.context.requestId,
    })
  } catch (error) {
    logger.error({ err: error, feature: record.feature }, 'llm call log write failed')
  }

  logger.debug(
    { promptDigest: promptDigest(messages), prompt: record.promptName, outcome: record.outcome },
    'llm call',
  )

  countOps(
    'ops_llm_call',
    {
      feature: record.feature,
      prompt: record.promptName,
      version: record.promptVersion,
      provider: record.provider,
      model: record.model,
      outcome: record.outcome,
      latency_ms: record.latencyMs,
      input_tokens: record.usage.inputTokens,
      output_tokens: record.usage.outputTokens,
      cost_usd: Number(cost),
      run_id: record.context.runId ?? null,
      package_version_id: record.context.packageVersionId ?? null,
    },
    record.context.userId ? hashUserId(record.context.userId) : 'system',
  )

  if (ALERTING_OUTCOMES.has(record.outcome)) {
    alertOps('llm_error', {
      feature: record.feature,
      prompt: record.promptName,
      provider: record.provider,
      outcome: record.outcome,
    })
  } else if (record.outcome === 'budget_exceeded') {
    alertOps('budget_exceeded', { feature: record.feature, provider: record.provider })
  } else if (record.outcome === 'circuit_open') {
    alertOps('circuit_open', { feature: record.feature, provider: record.provider })
  }
}

const EMPTY_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 }

/**
 * The outermost wrapper of the registry's chain (§1.1): every call the application makes lands here
 * exactly once, whatever the concrete provider did underneath.
 *
 * `structured` logs one row, not two, when the repair call ran: §1.2 defines the repair as part of
 * the same call, its tokens are summed into the usage, and the outcome `repaired` is how the repair
 * shows up. A provider's own `structured` therefore has to be reached through the *unwrapped*
 * provider, which is exactly how the adapters are written.
 */
export function withCallLogging(provider: LlmProvider): LlmProvider {
  const fallbackModel = defaultModelFor(provider.name, env)

  const log = async (
    req: CompleteRequest,
    startedAt: number,
    outcome: LlmOutcome,
    usage: LlmUsage,
    model: string,
  ): Promise<void> =>
    recordLlmCall(
      {
        feature: req.feature,
        promptName: req.promptName,
        promptVersion: req.promptVersion,
        provider: provider.name,
        model,
        usage,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        outcome,
        context: req.context,
      },
      req.messages,
    )

  return {
    name: provider.name,

    async complete(req) {
      const startedAt = performance.now()
      try {
        const result = await provider.complete(req)
        await log(req, startedAt, 'ok', result.usage, result.model)
        return result
      } catch (error) {
        await log(req, startedAt, outcomeOf(error), EMPTY_USAGE, fallbackModel)
        throw error
      }
    },

    async *stream(req) {
      const startedAt = performance.now()
      let usage: LlmUsage | undefined
      let model = fallbackModel
      let streamed = 0
      let outcome: LlmOutcome = 'ok'
      try {
        for await (const chunk of provider.stream(req)) {
          if (chunk.type === 'text') streamed += chunk.text.length
          else {
            usage = chunk.usage
            model = chunk.model
          }
          yield chunk satisfies StreamChunk
        }
      } catch (error) {
        outcome = outcomeOf(error)
        throw error
      } finally {
        // `finally`, so a consumer that stops reading — a closed SSE connection, a client that
        // navigated away — still costs what it cost. Without a `done` chunk the output is estimated
        // from what actually reached the wire.
        await log(
          req,
          startedAt,
          outcome,
          usage ?? { inputTokens: 0, outputTokens: Math.ceil(streamed / 4) },
          model,
        )
      }
    },

    async structured<T>(req: StructuredRequest<T>) {
      const startedAt = performance.now()
      try {
        const result = await provider.structured(req)
        await log(req, startedAt, result.repaired ? 'repaired' : 'ok', result.usage, result.model)
        return result
      } catch (error) {
        const usage =
          isAppError(error) && error.code === 'LLM_OUTPUT_INVALID'
            ? usageFromDetails(error)
            : EMPTY_USAGE
        await log(req, startedAt, outcomeOf(error), usage, fallbackModel)
        throw error
      }
    },
  }
}

/** `structuredViaPrompt` puts the summed usage of both attempts on the error it throws (§1.2). */
function usageFromDetails(error: AppError): LlmUsage {
  const details = error.opts.details
  if (details === null || typeof details !== 'object' || !('usage' in details)) return EMPTY_USAGE
  const usage = (details as { usage: unknown }).usage
  if (usage === null || typeof usage !== 'object') return EMPTY_USAGE
  const { inputTokens, outputTokens } = usage as Partial<LlmUsage>
  return {
    inputTokens: typeof inputTokens === 'number' ? inputTokens : 0,
    outputTokens: typeof outputTokens === 'number' ? outputTokens : 0,
  }
}
