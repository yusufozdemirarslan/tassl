// The circuit breaker (docs/tech/11-llm-integration.md §1.1, §3; D-118).
//
// When a provider is down, the useful thing is to stop asking. Every call that goes out into an
// outage costs a student `LLM_TIMEOUT_MS` of a stopped clock and three attempts of it, and a scoring
// job five reads' worth in parallel. The breaker turns the second failure and the fiftieth into the
// same thing: one fast refusal, `LLM_CIRCUIT_OPEN`, which `fallback.ts` may answer from the second
// provider and which every feature already degrades on (§3).
//
// D-118's parameters, exactly:
//
//   * Per provider, in memory per function instance. No shared state, so no new dependency and no
//     new failure mode; the cost is that ten instances discover an outage ten times, which is ten
//     calls rather than ten thousand.
//   * Opens after **5 consecutive failures**, or after **≥ 50 percent failures over the last 60 s
//     with at least 5 calls**. The first rule catches a hard outage in five calls; the second catches
//     a provider that is half up, which is the shape that otherwise never trips anything.
//   * Stays open **60 s**, then allows **one half-open probe**. A probe that succeeds closes the
//     circuit; a probe that fails opens it for another 60 s.
//
// **What counts as a failure is narrower than "the call threw".** `LLM_OUTPUT_INVALID` is the model
// answering with JSON that did not validate — the provider is up, the prompt or the schema is the
// problem, and opening a circuit on it would take the assistant down over a wording change.
// `LLM_BUDGET_EXCEEDED` never reaches here (budgets sit above the breaker in the chain) and
// `LLM_CIRCUIT_OPEN` is this file's own refusal. Everything else — a socket, a status, a timeout —
// is the transport, and is what the breaker is about.
import { AppError, isAppError } from '@/lib/errors'
import { getLogger } from '@/server/http/request-context'
import { alertOps, countOps } from '@/server/logging/ops-events'
import type {
  CompleteRequest,
  LlmProvider,
  LlmProviderName,
  StreamChunk,
  StructuredRequest,
} from '@/server/llm/provider'

/** D-118's four numbers, exported so the tests assert the decision rather than a copy of it. */
export const CONSECUTIVE_FAILURES_TO_OPEN = 5
export const WINDOW_MS = 60_000
export const WINDOW_MIN_CALLS = 5
export const WINDOW_FAILURE_RATIO = 0.5
export const OPEN_MS = 60_000

export type BreakerState = 'closed' | 'open' | 'half_open'

/** The clock, injected, so a test can move sixty seconds without waiting for them. */
export type Clock = () => number

/** A call the provider answered are the model's own outcomes; only transport failures count. */
export function countsAsFailure(error: unknown): boolean {
  if (!isAppError(error)) return true
  return (
    error.code !== 'LLM_OUTPUT_INVALID' &&
    error.code !== 'LLM_BUDGET_EXCEEDED' &&
    error.code !== 'LLM_CIRCUIT_OPEN'
  )
}

export function circuitOpen(provider: LlmProviderName, msUntilProbe: number): never {
  throw new AppError('LLM_CIRCUIT_OPEN', undefined, {
    details: { provider, retryAfterMs: Math.max(0, msUntilProbe) },
  })
}

type Outcome = { at: number; ok: boolean }

/**
 * One provider's breaker. Held by the registry for the life of the process, one per provider name,
 * which is why `registry.ts` caches its wrapped providers by name (D-118, and the note already in
 * that file).
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed'
  private consecutiveFailures = 0
  private openedAt = 0
  private probeInFlight = false
  private readonly outcomes: Outcome[] = []

  constructor(
    private readonly provider: LlmProviderName,
    private readonly now: Clock = Date.now,
  ) {}

  currentState(): BreakerState {
    return this.state
  }

  /** Milliseconds until the next half-open probe is allowed; zero when the circuit is not open. */
  msUntilProbe(): number {
    return this.state === 'open' ? Math.max(0, this.openedAt + OPEN_MS - this.now()) : 0
  }

  /**
   * Refuses the call, or admits it. Called before every attempt.
   *
   * The half-open probe is one call, not one at a time per feature: `probeInFlight` is cleared by
   * whichever of `succeeded`/`failed` the probe reaches, so a second caller arriving while the probe
   * is out is refused rather than making the outage's first recovery attempt twice.
   */
  admit(): void {
    if (this.state === 'closed') return
    if (this.state === 'open') {
      const remaining = this.msUntilProbe()
      if (remaining > 0) circuitOpen(this.provider, remaining)
      this.state = 'half_open'
      this.probeInFlight = true
      getLogger().warn({ provider: this.provider }, 'llm circuit half-open: probing')
      return
    }
    if (this.probeInFlight) circuitOpen(this.provider, OPEN_MS)
    this.probeInFlight = true
  }

  succeeded(): void {
    this.probeInFlight = false
    this.consecutiveFailures = 0
    this.record(true)
    if (this.state !== 'closed') {
      this.state = 'closed'
      this.outcomes.length = 0
      getLogger().info({ provider: this.provider }, 'llm circuit closed')
    }
  }

  failed(error: unknown): void {
    this.probeInFlight = false
    if (!countsAsFailure(error)) {
      // Not a transport failure, so it neither opens the circuit nor counts towards the ratio — but
      // it does break a run of consecutive failures, because the provider demonstrably answered.
      this.consecutiveFailures = 0
      this.record(true)
      return
    }
    this.consecutiveFailures += 1
    this.record(false)

    if (this.state === 'half_open') {
      this.open('probe_failed')
      return
    }
    if (this.consecutiveFailures >= CONSECUTIVE_FAILURES_TO_OPEN) {
      this.open('consecutive_failures')
      return
    }
    const recent = this.recent()
    if (recent.length >= WINDOW_MIN_CALLS) {
      const failures = recent.filter((outcome) => !outcome.ok).length
      if (failures / recent.length >= WINDOW_FAILURE_RATIO) this.open('failure_ratio')
    }
  }

  private open(reason: string): void {
    this.state = 'open'
    this.openedAt = this.now()
    this.probeInFlight = false
    this.outcomes.length = 0
    // §3: every open raises an alert. `circuit_open` is the alert name 13 §7 has a rule for, and the
    // counter beside it is the panel of 13 §6.
    alertOps('circuit_open', { provider: this.provider, reason })
    countOps('ops_llm_circuit_opened', { provider: this.provider, reason })
  }

  private record(ok: boolean): void {
    const at = this.now()
    this.outcomes.push({ at, ok })
    // Trim to the window on write, so the array cannot grow past a minute of traffic.
    while (this.outcomes.length > 0 && (this.outcomes[0]?.at ?? at) <= at - WINDOW_MS) {
      this.outcomes.shift()
    }
  }

  private recent(): Outcome[] {
    const cutoff = this.now() - WINDOW_MS
    return this.outcomes.filter((outcome) => outcome.at > cutoff)
  }
}

/**
 * `circuitBreaker` in the chain of §1.1.
 *
 * A stream is judged the way `complete` is — completed, or threw — and the breaker is told after the
 * iteration rather than before, so a stream that failed on its last chunk still counts as the
 * failure it was.
 */
export function withCircuitBreaker(provider: LlmProvider, breaker: CircuitBreaker): LlmProvider {
  return {
    name: provider.name,

    async complete(req: CompleteRequest) {
      breaker.admit()
      try {
        const result = await provider.complete(req)
        breaker.succeeded()
        return result
      } catch (error) {
        breaker.failed(error)
        throw error
      }
    },

    async *stream(req: CompleteRequest): AsyncIterable<StreamChunk> {
      breaker.admit()
      try {
        yield* provider.stream(req)
      } catch (error) {
        breaker.failed(error)
        throw error
      }
      breaker.succeeded()
    },

    async structured<T>(req: StructuredRequest<T>) {
      breaker.admit()
      try {
        const result = await provider.structured<T>(req)
        breaker.succeeded()
        return result
      } catch (error) {
        breaker.failed(error)
        throw error
      }
    },
  }
}
