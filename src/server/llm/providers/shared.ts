// What the two network adapters have in common (docs/tech/11-llm-integration.md §1.2, §1.3).
//
// The mock answers from a pure function; a network adapter answers from a socket, and three things
// about that have to be the same in both adapters or the guardrails above them cannot read what
// happened:
//
//   1. **A timeout is a timeout all the way up.** `AbortSignal.timeout` fires a `TimeoutError`, but
//      an SDK is free to catch it and re-throw something of its own. `calls.ts` decides the
//      `llm_calls.outcome` from `error.name`, and `retries.ts` decides whether to try again from the
//      same place, so an abort that arrives under another name is a timeout nothing can see. Both
//      adapters run their call through `withTimeout`, which asks the signal rather than the error.
//   2. **An HTTP status survives the SDK.** Retries happen on 429 and 5xx and never on a 4xx (§3),
//      and the status lives on an SDK error object whose class this file deliberately does not
//      import: `@ai-sdk/provider` is a transitive dependency, and a `instanceof` against a package
//      the lockfile may resolve twice is a check that silently stops matching. The status is read
//      structurally instead, off whichever of `statusCode`/`status` the thrown object carries.
//   3. **Usage is never absent.** Budgets sum tokens (D-065) and a provider that reports none would
//      make a call free. Where the response carries no usage the request and the answer are
//      estimated at §1.4's four characters per token — the same estimate the mock reports, so the
//      budget can be exercised without a key.
import { AppError, isAppError } from '@/lib/errors'
import type { LlmProviderName, LlmUsage } from '@/server/llm/provider'
import { estimateTokens } from '@/server/llm/provider'

/**
 * The prompt, in the shape AI SDK 7 takes it (D-657).
 *
 * `LlmMessage` is §1's own type and it carries the system message in the array, because that is what
 * a chat-completions body looks like and what `structuredViaPrompt` appends its JSON instruction to.
 * The SDK refuses a system message inside `messages` — `AI_InvalidPromptError`, "use the
 * instructions option instead" — and offers `allowSystemInMessages: true` as the way round it. The
 * split below is taken instead of the flag: `instructions` is the option the SDK steers callers to,
 * the flag is the compatibility hatch beside a `system` option already marked deprecated, and the
 * body that goes on the wire is identical either way (the SDK renders `instructions` as the leading
 * system message).
 *
 * Every system message is joined rather than only the first, so a prompt that grew a second one
 * would carry it rather than lose it silently.
 */
export function splitInstructions(messages: readonly { role: string; content: string }[]): {
  instructions: string | undefined
  rest: { role: 'user' | 'assistant'; content: string }[]
} {
  const system = messages.filter((message) => message.role === 'system')
  return {
    instructions:
      system.length === 0 ? undefined : system.map((message) => message.content).join('\n\n'),
    rest: messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: message.content,
      })),
  }
}

/** The name `calls.outcomeOf` reads to log `timeout`, and `retries` reads to try again. */
export const TIMEOUT_ERROR_NAME = 'TimeoutError'

export function timeoutError(timeoutMs: number, provider: LlmProviderName): Error {
  const error = new Error(`The ${provider} provider did not answer within ${timeoutMs} ms.`)
  error.name = TIMEOUT_ERROR_NAME
  return error
}

/** The upstream HTTP status an SDK error carries, read structurally rather than by class. */
export function statusOf(error: unknown): number | null {
  if (error === null || typeof error !== 'object') return null
  const bag = error as { statusCode?: unknown; status?: unknown }
  const value = typeof bag.statusCode === 'number' ? bag.statusCode : bag.status
  return typeof value === 'number' ? value : null
}

/** `APICallError.isRetryable`, when the SDK decided before we did. */
export function sdkRetryable(error: unknown): boolean | null {
  if (error === null || typeof error !== 'object') return null
  const { isRetryable } = error as { isRetryable?: unknown }
  return typeof isRetryable === 'boolean' ? isRetryable : null
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Everything a network adapter can throw, in the two shapes the wrappers above it read.
 *
 * A timeout keeps its own name and is not wrapped — `outcomeOf` writes `timeout` on the row from it,
 * and burying it inside an `AppError` would make every abort read as a provider error. Anything else
 * becomes `LLM_PROVIDER_ERROR` carrying the upstream status, which is what the retry rule and the
 * breaker are written in terms of. An `AppError` that arrived from below (the structured path's
 * `LLM_OUTPUT_INVALID`, a budget refusal) passes through untouched: it is already the right thing.
 */
export function asProviderError(error: unknown, provider: LlmProviderName): unknown {
  if (isAppError(error)) return error
  if (error instanceof Error && error.name === TIMEOUT_ERROR_NAME) return error
  const status = statusOf(error)
  return new AppError('LLM_PROVIDER_ERROR', messageOf(error), {
    details: {
      provider,
      status,
      // Under the SDK's own key, because `retries.isRetryable` reads the details bag with the same
      // structural helper it reads the raw SDK error with. Two names for one flag is a flag that
      // stops being read the day the status is absent.
      isRetryable: sdkRetryable(error),
    },
  })
}

/**
 * Runs `call` under `signal` and turns an abort into a `TimeoutError` whatever the SDK threw.
 *
 * The signal is asked, not the error: `AbortSignal.timeout` aborts the fetch, the SDK notices the
 * abort somewhere inside its own retry loop, and what comes out is whatever that layer decided to
 * throw. `signal.aborted` is the fact.
 */
export async function withTimeout<T>(
  signal: AbortSignal,
  timeoutMs: number,
  provider: LlmProviderName,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (signal.aborted) throw timeoutError(timeoutMs, provider)
    throw asProviderError(error, provider)
  }
}

/**
 * The same mapping over a stream, chunk by chunk.
 *
 * Buffering the stream and mapping the whole of it would be one line shorter and would cost the
 * product NFR-008: the assistant streams to a student under a clock, and a reply held until its last
 * token is a reply that arrives at the end rather than as it is written. So the source is iterated
 * and each chunk is yielded as it comes; only the failure is translated.
 */
export async function* timedStream(
  signal: AbortSignal,
  timeoutMs: number,
  provider: LlmProviderName,
  source: AsyncIterable<string>,
): AsyncGenerator<string> {
  const iterator = source[Symbol.asyncIterator]()
  for (;;) {
    let step: IteratorResult<string>
    try {
      step = await iterator.next()
    } catch (error) {
      if (signal.aborted) throw timeoutError(timeoutMs, provider)
      throw asProviderError(error, provider)
    }
    if (step.done === true) return
    yield step.value
  }
}

/**
 * §1.4's estimate, for a provider that reported no usage; never zero for a call that happened.
 *
 * The SDK's own usage type declares both counts `number | undefined` — a provider is free to answer
 * without them — which is exactly the case this exists for.
 */
export function usageOf(
  reported: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined,
  promptText: string,
  answerText: string,
): LlmUsage {
  return {
    inputTokens: reported?.inputTokens ?? estimateTokens(promptText),
    outputTokens: reported?.outputTokens ?? estimateTokens(answerText),
  }
}
