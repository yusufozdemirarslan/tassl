// The MiMo adapter (docs/tech/11-llm-integration.md §1.2, AI-002, INT-007, D-028, D-103).
//
// MiMo-V2.5-Pro speaks the OpenAI chat-completions API at
// `https://token-plan-sgp.xiaomimimo.com/v1`, with three departures from it that this file exists to
// absorb, so that nothing above `LlmProvider` knows which model answered:
//
//   * **`thinking`.** The body carries `thinking: { type: 'enabled' | 'disabled' }`, which is not an
//     OpenAI field and which no SDK will put there. Reasoning is off unless `LLM_REASONING=on`,
//     because in thinking mode MiMo refuses a custom `temperature` — and `structuredViaPrompt` calls
//     at 0.2 and the assistant at 0.7 (§1.2), so a package that turned it on globally would change
//     every call's sampling as a side effect.
//   * **No JSON-schema enforcement.** `response_format: { type: 'json_object' }` is supported and
//     `json_schema` is not, so a `json_schema` the SDK put there is downgraded rather than sent to be
//     refused. Nothing depends on either: `structuredViaPrompt` describes the schema in the system
//     message and validates with Zod (§1.2).
//   * **Two auth headers.** The official examples send `api-key`; the OpenAI SDK sends
//     `Authorization: Bearer`. Both are accepted, and sending both costs one header and removes a
//     class of "which one does this deployment want" incident.
//
// Both departures are made in a custom `fetch` rather than through `transformRequestBody`, exactly as
// §1.2 writes it. The reason is a test rather than a preference: `tests/integration/llm/
// no-pii-outbound.test.ts` proves that nothing a student wrote leaves the process unredacted, and it
// can only prove that about the bytes actually sent. A body rewritten after the last hook is a body
// no test saw.
//
// **No native tool calling.** MiMo's endpoint supports it and Tassl never asks: a model that can call
// a function is a model that can be talked into calling one, and every structured answer here is a
// JSON object validated by Zod.
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
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

const PROVIDER_NAME = 'openai-compatible' as const

/**
 * The two body rewrites of §1.2, as a pure function so a test can read them without a socket.
 *
 * A body that is not an object, or that does not parse, is returned untouched: this is a transport
 * hook, and an adapter that threw here would turn a shape it did not expect into a failed
 * delegation rather than a request the provider can refuse for itself.
 */
export function mimoRequestBody(raw: string, reasoning: 'on' | 'off'): string {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return raw
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return raw

  const bag = body as Record<string, unknown>
  bag.thinking = { type: reasoning === 'on' ? 'enabled' : 'disabled' }

  const format = bag.response_format
  if (format !== null && typeof format === 'object') {
    if ((format as { type?: unknown }).type === 'json_schema') {
      bag.response_format = { type: 'json_object' }
    }
  }
  return JSON.stringify(bag)
}

/** Injects the provider-specific body fields without relying on SDK passthrough (§1.2). */
const fetchWithBody: typeof fetch = async (url, init) => {
  if (init?.body !== undefined && typeof init.body === 'string') {
    return fetch(url, { ...init, body: mimoRequestBody(init.body, env.LLM_REASONING) })
  }
  return fetch(url, init)
}

/**
 * One provider instance for the life of the process.
 *
 * It is built lazily rather than at import, so that a deployment on the mock never constructs a
 * client for a service it will not call, and so that the `FEATURE_AI=false` path stays free of the
 * SDK entirely — including in a test file that imports this module to check its body rewrite.
 */
let client: ReturnType<typeof createOpenAICompatible> | null = null

function model() {
  client ??= createOpenAICompatible({
    name: 'mimo',
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    headers: { 'api-key': env.LLM_API_KEY },
    // The usage block on the last streaming chunk; without it a streamed reply would cost the
    // budget an estimate rather than what it actually spent (D-065).
    includeUsage: true,
    fetch: fetchWithBody,
  })
  return client.chatModel(env.LLM_MODEL)
}

/** Test seam: the next call builds a fresh client, so a changed base URL or key is picked up. */
export const resetOpenAiCompatibleClient = (): void => {
  client = null
}

const temperatureOf = (req: CompleteRequest): number => req.temperature ?? 0.7
const maxOutputTokensOf = (req: CompleteRequest): number =>
  req.maxOutputTokens ?? env.LLM_MAX_OUTPUT_TOKENS
const timeoutOf = (req: CompleteRequest): number => req.timeoutMs ?? env.LLM_TIMEOUT_MS

/**
 * `maxRetries: 0` on every call, and it is load-bearing.
 *
 * The AI SDK retries twice by default with its own backoff. Left on, every 5xx would be tried three
 * times inside one call before `guardrails/retries.ts` tried it twice more — nine requests where §3
 * asks for three, a `latency_ms` that is the sum of a retry schedule nothing declared, and a circuit
 * breaker counting one failure where nine happened. Retries belong to one file (D-652).
 */
const CALL_SETTINGS = { maxRetries: 0 } as const

export const openAiCompatibleProvider: LlmProvider = {
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
      model: env.LLM_MODEL,
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

    // Chunks are yielded as they arrive (NFR-008), and `answer` accumulates only so that output
    // tokens can be estimated when the provider sent no usage block.
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
      model: env.LLM_MODEL,
      provider: PROVIDER_NAME,
    }
  },

  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    return structuredViaPrompt(req, (messages) =>
      openAiCompatibleProvider.complete({ ...req, messages, temperature: 0.2 }),
    )
  },
}
