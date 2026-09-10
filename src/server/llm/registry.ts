// The provider registry (docs/tech/11-llm-integration.md §1.1, D-029).
//
// `getProvider()` is the only way anything in the application reaches a model. It answers with the
// provider named by `effectiveLlmProvider()` — which is `mock` whenever `FEATURE_AI=false`,
// whatever `LLM_PROVIDER` says — wrapped in the chain §1.1 fixes:
//
//     logging(llm_calls) ← budgets ← circuitBreaker(+fallback) ← retries ← timeout ← concreteProvider
//
// The order is the whole design and each adjacency is load-bearing. Logging is outermost, so one
// call is one row whatever happened underneath it. Budgets are next, so a refused call is refused
// before the network and is still recorded. The breaker is above the retries, so it counts one
// failure per call rather than one per attempt. The retries are above the timeout, so each attempt
// gets a whole `LLM_TIMEOUT_MS` — and the timeout itself lives inside the adapters, where §1.2 puts
// it as `AbortSignal.timeout` on the SDK call, because an abort signal is not something a wrapper
// can add to a call it does not make (D-653).
//
// **The mock is wrapped in logging alone, and that is the point** (D-651). The four middle wrappers
// are guardrails around a *network* call: a budget the mock never spends, a breaker for a service
// that cannot be down, retries for errors that cannot happen. Putting them around a pure function
// would make `FEATURE_AI=false` do a database read per delegation and refuse a walkthrough that had
// spent nothing — which is exactly the "nothing changes" the product invariant promises.
//
// Switching providers happens in two places and nowhere else (§6, D-691). There is no argument,
// no injection point and no per-call override: nothing anywhere can ask for a provider by name.
// The environment picks the *chain* — `FEATURE_AI=false` plus a redeploy is the first kill switch,
// and it is unconditional — and, only when the environment names a network provider, the
// `ai_mode` row of `app_settings` picks *which of two cached chains answers each call*
// (`ai-mode.ts`). That second layer is the switching provider below: it carries the network
// provider's name, and its three methods read the row and delegate — to the network chain when the
// row is absent or `live`, to the mock chain when it says `mock`. Per call, uncached, so the next
// request after an admin flips the switch is the one it applies to. With the flag off the mock is
// handed out directly and the row is never read, which is what keeps the invariant above true.
import { effectiveLlmProvider } from '@/server/config'
import { readAiMode } from '@/server/llm/ai-mode'
import { withCallLogging } from '@/server/llm/calls'
import { withBudgets } from '@/server/llm/guardrails/budgets'
import { CircuitBreaker, withCircuitBreaker } from '@/server/llm/guardrails/circuit-breaker'
import { withFallback } from '@/server/llm/guardrails/fallback'
import { withRetries } from '@/server/llm/guardrails/retries'
import type { LlmProvider, LlmProviderName } from '@/server/llm/provider'
import { anthropicProvider } from '@/server/llm/providers/anthropic'
import { mockProvider } from '@/server/llm/providers/mock'
import { openAiCompatibleProvider } from '@/server/llm/providers/openai-compatible'

/** The concrete adapters, before any wrapper. */
const ADAPTERS: Record<LlmProviderName, () => LlmProvider> = {
  mock: () => mockProvider,
  'openai-compatible': () => openAiCompatibleProvider,
  anthropic: () => anthropicProvider,
}

/**
 * One breaker per provider name, for the life of the process (D-118).
 *
 * It is keyed here rather than held inside the wrapper so that the health of a provider survives the
 * chain being rebuilt, and so that the primary and the fallback keep separate counts.
 */
const breakers = new Map<LlmProviderName, CircuitBreaker>()

const breakerFor = (name: LlmProviderName): CircuitBreaker => {
  const existing = breakers.get(name)
  if (existing) return existing
  const created = new CircuitBreaker(name)
  breakers.set(name, created)
  return created
}

/**
 * The fallback, itself wrapped in the guardrails a network call needs.
 *
 * Its own breaker, its own retries: a fallback that is also down must fail fast rather than become a
 * second unbounded outage behind the first. It is deliberately *not* wrapped in budgets — the budget
 * check has already run, above the breaker, on the call this is answering, and running it twice
 * would charge one call against the ceiling once and read it twice.
 */
const fallbackChain = (): LlmProvider =>
  withRetries(withCircuitBreaker(anthropicProvider, breakerFor('anthropic')))

/** §1.1's chain around a network adapter. */
function networkChain(name: LlmProviderName): LlmProvider {
  const guarded = withCircuitBreaker(withRetries(ADAPTERS[name]()), breakerFor(name))
  const withSecond = name === 'anthropic' ? guarded : withFallback(guarded, fallbackChain)
  return withBudgets(withSecond)
}

/**
 * One wrapped instance per provider name, for the life of the process.
 *
 * The wrapper holds no per-call state, so sharing it is safe; caching it keeps the identity stable,
 * which — with the breaker map above — is what lets the circuit breaker keep its counts per provider
 * without a registry of its own.
 */
const wrapped = new Map<LlmProviderName, LlmProvider>()

/** The logging-wrapped chain for one concrete provider name, built once per process. */
function chainFor(name: LlmProviderName): LlmProvider {
  const cached = wrapped.get(name)
  if (cached) return cached
  const provider = withCallLogging(name === 'mock' ? mockProvider : networkChain(name))
  wrapped.set(name, provider)
  return provider
}

/**
 * The switching providers, one per network provider name, for the life of the process.
 *
 * Cached for the same reason the chains are: `getProvider()` hands out one instance, so a caller
 * that holds a provider across two calls holds the same object — and the two chains it switches
 * between are the cached ones above, so the breaker under the network chain keeps its counts across
 * a switch to the mock and back.
 */
const switching = new Map<LlmProviderName, LlmProvider>()

/**
 * §6's second layer: a provider that reads `ai_mode` before every call and answers from the network
 * chain or the mock chain accordingly (D-691).
 *
 * The name is the network provider's, because that is what the environment configured and what an
 * operator reading `getProvider().name` is asking about; which chain actually answered is on the
 * `llm_calls` row, where the logging wrapper inside each chain writes `provider: 'mock'` for a call
 * the scripted assistant served and prices it at nothing (D-651). The read happens inside each
 * method rather than once here so that the switch is honoured per call: `stream` reads it when the
 * stream is first pulled, which is inside the delegation's phase 2, exactly where a call is made.
 */
function switchingProvider(name: LlmProviderName): LlmProvider {
  const cached = switching.get(name)
  if (cached) return cached

  const select = async (): Promise<LlmProvider> =>
    (await readAiMode()) === 'mock' ? chainFor('mock') : chainFor(name)

  const provider: LlmProvider = {
    name,
    async complete(req) {
      return (await select()).complete(req)
    },
    async *stream(req) {
      yield* (await select()).stream(req)
    },
    async structured(req) {
      return (await select()).structured(req)
    },
  }
  switching.set(name, provider)
  return provider
}

export function getProvider(): LlmProvider {
  const name = effectiveLlmProvider()
  // `FEATURE_AI=false` is unconditional: the mock, directly, with no row read on the way (D-029).
  if (name === 'mock') return chainFor('mock')
  return switchingProvider(name)
}

/**
 * Test seam: drops the cached chains, the switching providers and every breaker's state.
 *
 * Nothing in the application calls it. The breaker is in-memory per process by design (D-118), so a
 * suite that opens a circuit in one test would otherwise carry it into the next.
 */
export function resetProviderRegistry(): void {
  wrapped.clear()
  switching.clear()
  breakers.clear()
}
