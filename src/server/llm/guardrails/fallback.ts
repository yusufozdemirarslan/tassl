// The second provider (docs/tech/11-llm-integration.md §1.1, §1.3, §3; D-103, INT-008).
//
// §1.1 composes the breaker and the fallback as one link — `circuitBreaker(+fallback)` — because
// they are one rule: while the primary's circuit is open, calls go to the fallback *when it is
// configured*, and fail fast with `LLM_CIRCUIT_OPEN` when it is not. This file is the "when it is
// configured" half, and it is separate from `circuit-breaker.ts` so that the breaker stays a
// statement about one provider's health and knows nothing about there being a second one.
//
// Three conditions, all of them (D-103):
//
//   * `LLM_FALLBACK_PROVIDER=anthropic` — the operator asked for it;
//   * `ANTHROPIC_API_KEY` is set — otherwise the fallback would fail on its first call, turning one
//     outage into two and hiding the first behind the second;
//   * the primary's circuit is open — this is not a load balancer, and a fallback that answered
//     ordinary failures would double the bill and halve the signal.
//
// **`LLM_CIRCUIT_OPEN` and nothing else** triggers it. A timeout, a 500 or a validation failure goes
// back to the caller as it always did: those are the failures the retries and the breaker are there
// to weigh, and re-asking a second vendor on each of them would spend two providers' latency on one
// student's stopped clock before anything degraded.
//
// A stream falls back only before its first chunk, for the reason `retries.ts` gives: a student who
// has read half an answer must not be handed the beginning of another one.
import { isAppError } from '@/lib/errors'
import { env } from '@/server/config'
import { getLogger } from '@/server/http/request-context'
import type {
  CompleteRequest,
  LlmProvider,
  StreamChunk,
  StructuredRequest,
} from '@/server/llm/provider'

/** D-103's three conditions, minus the circuit — which is the failure this wrapper reacts to. */
export const fallbackConfigured = (): boolean =>
  env.LLM_FALLBACK_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY !== ''

const isCircuitOpen = (error: unknown): boolean =>
  isAppError(error) && error.code === 'LLM_CIRCUIT_OPEN'

/**
 * `+fallback` in the chain of §1.1.
 *
 * `secondary` is a factory rather than a provider: building an Anthropic client on a deployment that
 * never falls back would be a client for a service with no key, constructed on every cold start of
 * every function. It is called at most once, on the first call that needs it.
 */
export function withFallback(
  primary: LlmProvider,
  secondary: () => LlmProvider,
  configured: () => boolean = fallbackConfigured,
): LlmProvider {
  // Not named `use`: `react-hooks/rules-of-hooks` reads any function called `use` as the React hook
  // of that name, wherever it lives.
  const takeOver = (): LlmProvider => {
    const provider = secondary()
    getLogger().warn(
      { primary: primary.name, fallback: provider.name },
      'llm primary circuit open: using the fallback provider',
    )
    return provider
  }

  return {
    name: primary.name,

    async complete(req: CompleteRequest) {
      try {
        return await primary.complete(req)
      } catch (error) {
        if (!isCircuitOpen(error) || !configured()) throw error
        return takeOver().complete(req)
      }
    },

    async *stream(req: CompleteRequest): AsyncIterable<StreamChunk> {
      let yielded = false
      try {
        for await (const chunk of primary.stream(req)) {
          yielded = true
          yield chunk
        }
        return
      } catch (error) {
        if (yielded || !isCircuitOpen(error) || !configured()) throw error
      }
      yield* takeOver().stream(req)
    },

    async structured<T>(req: StructuredRequest<T>) {
      try {
        return await primary.structured<T>(req)
      } catch (error) {
        if (!isCircuitOpen(error) || !configured()) throw error
        return takeOver().structured<T>(req)
      }
    },
  }
}
