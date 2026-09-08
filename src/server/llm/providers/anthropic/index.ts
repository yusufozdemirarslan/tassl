// The Anthropic fallback (docs/tech/11-llm-integration.md §1.3, INT-008, D-103).
//
// A second provider so that a MiMo outage is a slower run rather than a paused one. It is reached
// only through `guardrails/fallback.ts`, and only when all three of these hold: `LLM_FALLBACK_PROVIDER
// =anthropic`, `ANTHROPIC_API_KEY` is set, and the primary's circuit is open. Nothing selects it
// directly, and `LLM_PROVIDER=anthropic` is the one other way it runs — a deployment that wants it as
// its only model, which is the same code path.
//
// It is the plainest adapter in the tree, and that is deliberate: `structuredViaPrompt` is the shared
// structured path (§1.2), no tool calling is exposed here either, and the model is
// `env.LLM_FALLBACK_MODEL` (`claude-sonnet-5`, D-103) rather than a name written into this file — a
// fallback whose model id is a literal is a fallback that cannot be moved without a deploy.
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, streamText } from 'ai'
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

let client: ReturnType<typeof createAnthropic> | null = null

/** Built lazily, so a deployment that never falls back never constructs a client (§1.3). */
function model() {
  client ??= createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return client(env.LLM_FALLBACK_MODEL)
}

/** Test seam: the next call builds a fresh client, so a changed key is picked up. */
export const resetAnthropicClient = (): void => {
  client = null
}

const temperatureOf = (req: CompleteRequest): number => req.temperature ?? 0.7
const maxOutputTokensOf = (req: CompleteRequest): number =>
  req.maxOutputTokens ?? env.LLM_MAX_OUTPUT_TOKENS
const timeoutOf = (req: CompleteRequest): number => req.timeoutMs ?? env.LLM_TIMEOUT_MS

/** Retries belong to `guardrails/retries.ts` alone; see the note in the MiMo adapter (D-652). */
const CALL_SETTINGS = { maxRetries: 0 } as const

export const anthropicProvider: LlmProvider = {
  name: PROVIDER_NAME,

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const timeoutMs = timeoutOf(req)
    const signal = AbortSignal.timeout(timeoutMs)
    const { instructions, rest } = splitInstructions(req.messages)
    const result = await withTimeout(signal, timeoutMs, PROVIDER_NAME, () =>
      generateText({
        ...CALL_SETTINGS,
        model: model(),
        ...(instructions === undefined ? {} : { instructions }),
        messages: rest,
        maxOutputTokens: maxOutputTokensOf(req),
        temperature: temperatureOf(req),
        abortSignal: signal,
      }),
    )
    return {
      text: result.text,
      usage: usageOf(result.usage, messagesText(req.messages), result.text),
      model: env.LLM_FALLBACK_MODEL,
      provider: PROVIDER_NAME,
    }
  },

  async *stream(req: CompleteRequest): AsyncIterable<StreamChunk> {
    const timeoutMs = timeoutOf(req)
    const signal = AbortSignal.timeout(timeoutMs)
    const { instructions, rest } = splitInstructions(req.messages)
    const stream = streamText({
      ...CALL_SETTINGS,
      model: model(),
      ...(instructions === undefined ? {} : { instructions }),
      messages: rest,
      maxOutputTokens: maxOutputTokensOf(req),
      temperature: temperatureOf(req),
      abortSignal: signal,
    })

    let answer = ''
    for await (const text of timedStream(signal, timeoutMs, PROVIDER_NAME, stream.textStream)) {
      answer += text
      yield { type: 'text', text }
    }

    // `stream.usage` is a `PromiseLike`, not a `Promise`; awaiting it inside the arrow is what
    // makes it one, and what keeps a usage block that never arrives inside the timeout.
    const usage = await withTimeout(signal, timeoutMs, PROVIDER_NAME, async () => stream.usage)
    yield {
      type: 'done',
      usage: usageOf(usage, messagesText(req.messages), answer),
      model: env.LLM_FALLBACK_MODEL,
      provider: PROVIDER_NAME,
    }
  },

  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    return structuredViaPrompt(req, (messages) =>
      anthropicProvider.complete({ ...req, messages, temperature: 0.2 }),
    )
  },
}
