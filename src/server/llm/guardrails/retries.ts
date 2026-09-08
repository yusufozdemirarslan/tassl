// Retries (docs/tech/11-llm-integration.md §1.1, §3).
//
// Two retries, one second then three, on the four failures that are the provider's rather than ours:
// a network error, a 429, a 5xx, and a timeout. No retry on a 4xx that is not 429 (the request was
// wrong and will be wrong again), on `LLM_OUTPUT_INVALID` (the structured path has already spent its
// one repair, §1.2), on `LLM_BUDGET_EXCEEDED` (the ceiling does not move in three seconds) or on
// `LLM_CIRCUIT_OPEN` (retrying an open circuit is the thing the circuit exists to stop).
//
// **This is the only retry loop over a model call in the product**, and it is placed where §1.1 puts
// it: below the breaker, so the breaker counts one failure for one call rather than one per attempt,
// and above the timeout, so each attempt gets a whole `LLM_TIMEOUT_MS` rather than a third of one.
// The SDK's own `maxRetries` is set to zero in both adapters and `scoring/reads.ts` deliberately
// keeps no loop of its own (D-399, D-652).
//
// **A stream is retried only before its first chunk.** Once a token has reached the student, a retry
// would either repeat what they have read or splice a second answer onto the first. So the wrapper
// tries again while nothing has been yielded and gives up the moment something has — which is
// exactly the case that matters, because a provider that is down refuses the connection rather than
// dying halfway.
import { isAppError } from '@/lib/errors'
import { getLogger } from '@/server/http/request-context'
import type {
  CompleteRequest,
  LlmProvider,
  StreamChunk,
  StructuredRequest,
} from '@/server/llm/provider'
import { sdkRetryable, statusOf, TIMEOUT_ERROR_NAME } from '@/server/llm/providers/shared'

/** §3: two retries, so three attempts in all. */
export const RETRY_ATTEMPTS = 2
/** §3: one second, then three. */
export const RETRY_BACKOFF_MS: readonly number[] = [1000, 3000]

/** The error codes a retry cannot help; everything else is judged on its transport. */
const NEVER_RETRY = new Set(['LLM_OUTPUT_INVALID', 'LLM_BUDGET_EXCEEDED', 'LLM_CIRCUIT_OPEN'])

/**
 * Whether this failure is worth trying again.
 *
 * The order is the order the information is trustworthy in. An `AppError` we raised says what it is.
 * A timeout says so by name. A status says so by number — 429 and every 5xx, nothing else. An SDK
 * that already classified the error is believed next. What is left has no status at all, which on
 * `fetch` means the connection never completed: a DNS failure, a refused socket, a dropped TLS
 * handshake — the network case §3 names first.
 */
export function isRetryable(error: unknown): boolean {
  if (isAppError(error)) {
    if (NEVER_RETRY.has(error.code)) return false
    const status = statusOf(error.opts.details)
    if (status !== null) return status === 429 || status >= 500
    const flagged = sdkRetryable(error.opts.details)
    if (flagged !== null) return flagged
    return error.code === 'LLM_PROVIDER_ERROR'
  }
  if (
    error instanceof Error &&
    (error.name === TIMEOUT_ERROR_NAME || error.name === 'AbortError')
  ) {
    return true
  }
  const status = statusOf(error)
  if (status !== null) return status === 429 || status >= 500
  const flagged = sdkRetryable(error)
  if (flagged !== null) return flagged
  return error instanceof Error
}

/** Injected so a test can run the schedule without waiting seven seconds for it. */
export type Sleep = (ms: number) => Promise<void>

const realSleep: Sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export type RetryOptions = { sleep?: Sleep; attempts?: number; backoffMs?: readonly number[] }

/**
 * Runs `call`, retrying a retryable failure on §3's schedule.
 *
 * The last failure is thrown, not the first: what the caller wants to know is how the call ended,
 * and the earlier attempts are on the log line beside it.
 */
export async function withRetry<T>(
  call: () => Promise<T>,
  label: string,
  options: RetryOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? realSleep
  const attempts = options.attempts ?? RETRY_ATTEMPTS
  const backoff = options.backoffMs ?? RETRY_BACKOFF_MS

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call()
    } catch (error) {
      if (attempt >= attempts || !isRetryable(error)) throw error
      const waitMs = backoff[attempt] ?? backoff.at(-1) ?? 0
      getLogger().warn(
        { err: error, call: label, attempt: attempt + 1, waitMs },
        'llm call failed; retrying',
      )
      await sleep(waitMs)
    }
  }
}

/** `retries` in the chain of §1.1. */
export function withRetries(provider: LlmProvider, options: RetryOptions = {}): LlmProvider {
  return {
    name: provider.name,

    complete(req: CompleteRequest) {
      return withRetry(() => provider.complete(req), `${req.promptName}:complete`, options)
    },

    async *stream(req: CompleteRequest): AsyncIterable<StreamChunk> {
      const attempts = options.attempts ?? RETRY_ATTEMPTS
      const sleep = options.sleep ?? realSleep
      const backoff = options.backoffMs ?? RETRY_BACKOFF_MS

      for (let attempt = 0; ; attempt += 1) {
        // Reset per attempt: the guard is "has the *consumer* seen anything", and a failed attempt
        // that yielded nothing leaves the consumer where it was.
        let yielded = false
        try {
          for await (const chunk of provider.stream(req)) {
            yielded = true
            yield chunk
          }
          return
        } catch (error) {
          if (yielded || attempt >= attempts || !isRetryable(error)) throw error
          const waitMs = backoff[attempt] ?? backoff.at(-1) ?? 0
          getLogger().warn(
            { err: error, call: `${req.promptName}:stream`, attempt: attempt + 1, waitMs },
            'llm stream failed before its first chunk; retrying',
          )
          await sleep(waitMs)
        }
      }
    },

    structured<T>(req: StructuredRequest<T>) {
      return withRetry(() => provider.structured<T>(req), `${req.promptName}:structured`, options)
    },
  }
}
