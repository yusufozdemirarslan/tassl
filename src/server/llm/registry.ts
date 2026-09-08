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
// Switching providers is environment only. There is no argument, no injection point and no
// per-call override: `FEATURE_AI=false` plus a redeploy is the kill switch (§6), and it works
// because nothing anywhere can ask for a provider by name.
import { effectiveLlmProvider } from '@/server/config'
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

export function getProvider(): LlmProvider {
  const name = effectiveLlmProvider()
  const cached = wrapped.get(name)
  if (cached) return cached

  const provider = withCallLogging(name === 'mock' ? mockProvider : networkChain(name))
  wrapped.set(name, provider)
  return provider
}

/**
 * Test seam: drops the cached chains and every breaker's state.
 *
 * Nothing in the application calls it. The breaker is in-memory per process by design (D-118), so a
 * suite that opens a circuit in one test would otherwise carry it into the next.
 */
export function resetProviderRegistry(): void {
  wrapped.clear()
  breakers.clear()
}
