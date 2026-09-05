// The provider registry (docs/tech/11-llm-integration.md §1.1, D-029).
//
// `getProvider()` is the only way anything in the application reaches a model. It answers with the
// provider named by `effectiveLlmProvider()` — which is `mock` whenever `FEATURE_AI=false`,
// whatever `LLM_PROVIDER` says — wrapped in the chain §1.1 fixes:
//
//     logging(llm_calls) ← budgets ← circuitBreaker(+fallback) ← retries ← timeout ← concreteProvider
//
// Today the chain is `logging ← mock`. The middle four wrappers are guardrails around a *network*
// call: a budget the mock never spends, a breaker for a service that cannot be down, retries for
// errors that cannot happen, a timeout on work that is synchronous. They land in Phase 14 with the
// adapters they protect (`phase-14` step 14.3), and this file composes them there. Writing four
// no-op wrappers now would be four untested layers standing between a student and an answer.
//
// Switching providers is environment only. There is no argument, no injection point and no
// per-call override: `FEATURE_AI=false` plus a redeploy is the kill switch (§6), and it works
// because nothing anywhere can ask for a provider by name.
import { AppError } from '@/lib/errors'
import { effectiveLlmProvider } from '@/server/config'
import { withCallLogging } from '@/server/llm/calls'
import type { LlmProvider, LlmProviderName } from '@/server/llm/provider'
import { mockProvider } from '@/server/llm/providers/mock'

/**
 * The stand-in for an adapter that has not been written yet.
 *
 * It throws when the registry asks for it, not when a student asks it a question. Failing at
 * selection is the difference between "this deployment is misconfigured", which an operator sees on
 * the first request and can fix, and a run that reaches the working period before discovering that
 * its assistant does not exist.
 */
export const providerNotInstalled = (name: LlmProviderName): never => {
  throw new AppError('LLM_PROVIDER_ERROR', 'provider not installed', {
    details: { provider: name },
  })
}

/** Phase 14 replaces the two throwing entries with the adapters of §1.2 and §1.3. */
const FACTORIES: Record<LlmProviderName, () => LlmProvider> = {
  mock: () => mockProvider,
  'openai-compatible': () => providerNotInstalled('openai-compatible'),
  anthropic: () => providerNotInstalled('anthropic'),
}

/**
 * One wrapped instance per provider name, for the life of the process.
 *
 * The wrapper holds no per-call state, so sharing it is safe; caching it keeps the identity stable,
 * which is what lets Phase 14's circuit breaker keep its counts per provider without a registry of
 * its own.
 */
const wrapped = new Map<LlmProviderName, LlmProvider>()

export function getProvider(): LlmProvider {
  const name = effectiveLlmProvider()
  const cached = wrapped.get(name)
  if (cached) return cached

  const provider = withCallLogging(FACTORIES[name]())
  wrapped.set(name, provider)
  return provider
}
