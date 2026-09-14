// The Anthropic adapter (docs/tech/11-llm-integration.md §1.3, INT-008, D-103, D-749).
//
// Claude is the primary provider in production: `LLM_PROVIDER=anthropic` with `LLM_MODEL=claude-opus-5`
// (D-749). The same adapter also serves as the fallback behind another primary, where it answers with
// `LLM_FALLBACK_MODEL` and is reached only through `guardrails/fallback.ts`. Which model it serves is
// the one thing that differs, so the adapter is built by `createAnthropicProvider(model)` and the two
// instances below close over the environment rather than over a literal — a model id written into
// this file is a model that cannot be moved without a deploy.
//
// What this file absorbs, so nothing above `LlmProvider` knows which model answered:
//
//   * **Sampling parameters.** Claude Opus 5 and the rest of its generation reject `temperature`,
//     `top_p` and `top_k` with a 400. The SDK would drop them with a warning on every call; they are
//     not sent at all instead, so the contract's `temperature` stays a hint the MiMo adapter honours.
//   * **Thinking and effort.** Opus 5 thinks adaptively by default, and thinking tokens count against
//     `max_tokens`. Each prompt family gets an effort that matches what it is (`effortFor`) and a
//     thinking allowance on top of its output ceiling (`thinkingHeadroom`), so a generation step that
//     thinks first still has its whole `maxOutputTokens` left for the JSON it must write.
//   * **Refusals.** A policy decline is `stop_reason: "refusal"`. Server-side fallbacks are on for the
//     models that support them, and a refusal that survives them comes back as what 11 §3's content
//     policy row says it is: output with no commentary. The assistant then hands the student the
//     surfaced claims with "The assistant could not add commentary on this request." and flags the
//     delegation `no_commentary`; a structured call fails validation and degrades the way its feature
//     does. It is never thrown: a decline is not an outage, and pausing a student's run on it would
//     turn one unusual request into a stopped clock. It is logged at `warn` so an operator sees it.
//
// Structured output stays on `structuredViaPrompt` (§1.2): the schema in the system message, Zod as
// the judge, one repair call. No tool calling is exposed here either.
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, streamText } from 'ai'
import { getLogger } from '@/server/http/request-context'
import { env } from '@/server/config'
import type {
  CompleteRequest,
  CompleteResult,
  LlmProvider,
  StreamChunk,
  StructuredRequest,
  StructuredResult,
} from '@/server/llm/provider'
import { messagesText } from '@/server/llm/provider'
import { splitInstructions, timedStream, usageOf, withTimeout } from '@/server/llm/providers/shared'
import { structuredViaPrompt } from '@/server/llm/structured'

const PROVIDER_NAME = 'anthropic' as const

export type AnthropicEffort = 'low' | 'medium' | 'high'

/** Models of the Opus 5 generation: no sampling parameters, adaptive thinking, `effort`. */
const CURRENT_GENERATION = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
]

const isCurrentGeneration = (model: string): boolean =>
  CURRENT_GENERATION.some((prefix) => model.startsWith(prefix))

/** Server-side refusal fallbacks exist for these (`fallbacks: 'default'`). */
const supportsServerFallbacks = (model: string): boolean =>
  model.startsWith('claude-opus-5') || model.startsWith('claude-fable-5')

/**
 * How hard a prompt family thinks (D-749).
 *
 * The assistant answers a student under a clock and the trigger classifier is a yes/no over claim
 * ids: both are `low`, which keeps a streamed reply's first token near the MiMo figure. A band read
 * weighs a trace against a rubric, a judgment with little to write, and is `medium`.
 *
 * A generation step is `low` too, and that was measured rather than assumed. Every `gen-*` call has
 * `GEN_TIMEOUT_MS` (150 seconds) inside a job that expires at 280, and a step writes up to 12,288
 * tokens at about seventy a second. At `medium`, `gen-documents` thought for 50 seconds (3,703
 * reasoning tokens) before its first word and finished in 120 on the short eval case, so a larger
 * Evidence Room ran past the timeout; at `low` it thought for 15 seconds (1,031 tokens) and
 * finished the long case in 84, valid. The structure a step must satisfy is checked by its schema
 * and its subset of the rule table (10 §5), not left to the thinking, and `pnpm evals` holds the
 * result to the authoring suite's properties.
 */
export function effortFor(promptName: string): AnthropicEffort {
  return promptName.startsWith('band-read') ? 'medium' : 'low'
}

/** Thinking tokens allowed on top of the prompt's own output ceiling, by effort. */
export function thinkingHeadroom(effort: AnthropicEffort): number {
  if (effort === 'high') return 16_000
  return effort === 'medium' ? 8_000 : 2_000
}

/** The model the adapter serves as the primary (`LLM_MODEL`) or as the fallback. */
const primaryModel = (): string =>
  env.LLM_PROVIDER === 'anthropic' ? env.LLM_MODEL : env.LLM_FALLBACK_MODEL

let client: ReturnType<typeof createAnthropic> | null = null

/** Built lazily, so a deployment that never calls Claude never constructs a client (§1.3). */
function languageModel(model: string) {
  client ??= createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return client(model)
}

/** Test seam: the next call builds a fresh client, so a changed key is picked up. */
export const resetAnthropicClient = (): void => {
  client = null
}

const maxOutputTokensOf = (req: CompleteRequest): number =>
  req.maxOutputTokens ?? env.LLM_MAX_OUTPUT_TOKENS
const timeoutOf = (req: CompleteRequest): number => req.timeoutMs ?? env.LLM_TIMEOUT_MS

/** Retries belong to `guardrails/retries.ts` alone; see the note in the MiMo adapter (D-652). */
const CALL_SETTINGS = { maxRetries: 0 } as const

/** The request settings that depend on the model: sampling, thinking allowance, effort, fallbacks. */
export function callSettingsFor(model: string, req: CompleteRequest) {
  if (!isCurrentGeneration(model)) {
    return {
      maxOutputTokens: maxOutputTokensOf(req),
      temperature: req.temperature ?? 0.7,
    }
  }
  const effort = effortFor(req.promptName)
  return {
    maxOutputTokens: maxOutputTokensOf(req) + thinkingHeadroom(effort),
    providerOptions: {
      anthropic: {
        effort,
        ...(supportsServerFallbacks(model) ? { fallbacks: 'default' as const } : {}),
      },
    },
  }
}

/** A decline that survived the server-side fallbacks: recorded, and answered as no commentary. */
function noteRefusal(model: string, req: CompleteRequest): void {
  getLogger().warn(
    { provider: PROVIDER_NAME, model, prompt: req.promptName, feature: req.feature },
    'the model declined the request; it is answered with no commentary',
  )
}

export function createAnthropicProvider(model: () => string): LlmProvider {
  const provider: LlmProvider = {
    name: PROVIDER_NAME,

    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const modelId = model()
      const timeoutMs = timeoutOf(req)
      const signal = AbortSignal.timeout(timeoutMs)
      const { instructions, rest } = splitInstructions(req.messages)
      const result = await withTimeout(signal, timeoutMs, PROVIDER_NAME, () =>
        generateText({
          ...CALL_SETTINGS,
          ...callSettingsFor(modelId, req),
          model: languageModel(modelId),
          ...(instructions === undefined ? {} : { instructions }),
          messages: rest,
          abortSignal: signal,
        }),
      )
      const declined = result.finishReason === 'content-filter'
      if (declined) noteRefusal(modelId, req)
      return {
        text: declined ? '' : result.text,
        usage: usageOf(result.usage, messagesText(req.messages), result.text),
        model: modelId,
        provider: PROVIDER_NAME,
      }
    },

    async *stream(req: CompleteRequest): AsyncIterable<StreamChunk> {
      const modelId = model()
      const timeoutMs = timeoutOf(req)
      const signal = AbortSignal.timeout(timeoutMs)
      const { instructions, rest } = splitInstructions(req.messages)
      const stream = streamText({
        ...CALL_SETTINGS,
        ...callSettingsFor(modelId, req),
        model: languageModel(modelId),
        ...(instructions === undefined ? {} : { instructions }),
        messages: rest,
        abortSignal: signal,
      })

      let answer = ''
      for await (const text of timedStream(signal, timeoutMs, PROVIDER_NAME, stream.textStream)) {
        answer += text
        yield { type: 'text', text }
      }

      // `stream.usage` and `stream.finishReason` are `PromiseLike`s, not `Promise`s; awaiting them
      // inside the arrow is what makes them one, and what keeps a block that never arrives inside
      // the timeout.
      const finishReason = await withTimeout(
        signal,
        timeoutMs,
        PROVIDER_NAME,
        async () => stream.finishReason,
      )
      // A decline before any text streams nothing, and the assembler answers it as no commentary. A
      // decline after text has streamed leaves what was written, which is the provider's own answer.
      if (finishReason === 'content-filter') noteRefusal(modelId, req)
      const usage = await withTimeout(signal, timeoutMs, PROVIDER_NAME, async () => stream.usage)
      yield {
        type: 'done',
        usage: usageOf(usage, messagesText(req.messages), answer),
        model: modelId,
        provider: PROVIDER_NAME,
      }
    },

    structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      return structuredViaPrompt(req, (messages) =>
        provider.complete({ ...req, messages, temperature: 0.2 }),
      )
    },
  }
  return provider
}

/** Claude as the configured provider: `LLM_MODEL` when `LLM_PROVIDER=anthropic` (D-749). */
export const anthropicProvider: LlmProvider = createAnthropicProvider(primaryModel)

/** Claude behind another primary: always `LLM_FALLBACK_MODEL` (D-103). */
export const anthropicFallbackProvider: LlmProvider = createAnthropicProvider(
  () => env.LLM_FALLBACK_MODEL,
)
