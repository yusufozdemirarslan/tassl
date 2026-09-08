// Step 14.2 — the circuit breaker and the fallback (docs/tech/11-llm-integration.md §1.1, §3;
// D-118, D-103).
//
// D-118's parameters are numbers, and numbers are what a test can hold still. The clock is injected,
// so "stays open 60 s" is asserted by moving sixty seconds rather than by waiting them, and the
// suite runs in milliseconds.
//
// The last block is the fallback, which is tested here rather than in a file of its own because it
// is only reachable through an open circuit: §1.1 composes the two as one link, and a fallback test
// that faked `LLM_CIRCUIT_OPEN` by hand would be testing a string rather than the rule.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError, isAppError } from '@/lib/errors'
import {
  CONSECUTIVE_FAILURES_TO_OPEN,
  CircuitBreaker,
  OPEN_MS,
  WINDOW_MIN_CALLS,
  countsAsFailure,
  withCircuitBreaker,
} from '@/server/llm/guardrails/circuit-breaker'
import { withFallback } from '@/server/llm/guardrails/fallback'
import type { CompleteResult, LlmProvider, LlmProviderName } from '@/server/llm/provider'

let now = 1_700_000_000_000
const clock = (): number => now
const advance = (ms: number): void => {
  now += ms
}

beforeEach(() => {
  now = 1_700_000_000_000
})

const providerError = (): AppError =>
  new AppError('LLM_PROVIDER_ERROR', 'mimo is down', { details: { status: 503 } })

/** A provider that answers or throws on command, and counts how often it was asked. */
function scripted(
  name: LlmProviderName,
  script: () => CompleteResult | Error,
): LlmProvider & {
  calls: () => number
} {
  let calls = 0
  const answer = (): CompleteResult => {
    calls += 1
    const outcome = script()
    if (outcome instanceof Error) throw outcome
    return outcome
  }
  return {
    name,
    calls: () => calls,
    complete: async () => Promise.resolve(answer()),
    async *stream() {
      const result = await Promise.resolve(answer())
      yield { type: 'text' as const, text: result.text }
      yield {
        type: 'done' as const,
        usage: result.usage,
        model: result.model,
        provider: result.provider,
      }
    },
    structured: async () =>
      Promise.resolve({
        value: {} as never,
        repaired: false,
        raw: '{}',
        usage: { inputTokens: 1, outputTokens: 1 },
        model: 'm',
        provider: name,
      }),
  }
}

const ok = (name: LlmProviderName): CompleteResult => ({
  text: `answered by ${name}`,
  usage: { inputTokens: 1, outputTokens: 1 },
  model: 'm',
  provider: name,
})

const request = () => ({
  feature: 'assistant' as const,
  promptName: 'assistant-reply',
  promptVersion: 1,
  messages: [{ role: 'user' as const, content: 'hello' }],
  context: { requestId: 'req-breaker-unit' },
})

describe('what counts as a failure', () => {
  it('counts a transport failure', () => {
    expect(countsAsFailure(providerError())).toBe(true)
    expect(countsAsFailure(new Error('socket hang up'))).toBe(true)
  })

  it('does not count the model answering with JSON that failed validation', () => {
    // The provider is up; a prompt or a schema is the problem, and taking the assistant down over a
    // wording change would be the breaker doing harm.
    expect(countsAsFailure(new AppError('LLM_OUTPUT_INVALID', 'bad json'))).toBe(false)
  })

  it('does not count a budget refusal or its own open circuit', () => {
    expect(countsAsFailure(new AppError('LLM_BUDGET_EXCEEDED'))).toBe(false)
    expect(countsAsFailure(new AppError('LLM_CIRCUIT_OPEN'))).toBe(false)
  })
})

describe('opening', () => {
  it('opens after exactly five consecutive failures, and not before', () => {
    const breaker = new CircuitBreaker('openai-compatible', clock)
    for (let attempt = 0; attempt < CONSECUTIVE_FAILURES_TO_OPEN - 1; attempt += 1) {
      breaker.admit()
      breaker.failed(providerError())
      expect(breaker.currentState()).toBe('closed')
    }
    breaker.admit()
    breaker.failed(providerError())
    expect(breaker.currentState()).toBe('open')
  })

  it('opens at half failures over sixty seconds once five calls have been made', () => {
    const breaker = new CircuitBreaker('openai-compatible', clock)
    // Alternating, so the consecutive rule never fires: fail, succeed, fail, succeed, fail.
    for (const failed of [true, false, true, false, true]) {
      breaker.admit()
      if (failed) breaker.failed(providerError())
      else breaker.succeeded()
      advance(1000)
    }
    expect(breaker.currentState()).toBe('open')
  })

  it('does not open on a bad ratio with fewer than five calls in the window', () => {
    const breaker = new CircuitBreaker('openai-compatible', clock)
    for (const failed of [true, false, true]) {
      breaker.admit()
      if (failed) breaker.failed(providerError())
      else breaker.succeeded()
      advance(1000)
    }
    expect(breaker.currentState()).toBe('closed')
    expect(WINDOW_MIN_CALLS).toBe(5)
  })

  it('forgets outcomes older than the window, so yesterday’s outage does not trip today', () => {
    const breaker = new CircuitBreaker('openai-compatible', clock)
    for (const failed of [true, false, true]) {
      breaker.admit()
      if (failed) breaker.failed(providerError())
      else breaker.succeeded()
    }
    advance(61_000)
    for (const failed of [false, true]) {
      breaker.admit()
      if (failed) breaker.failed(providerError())
      else breaker.succeeded()
    }
    expect(breaker.currentState()).toBe('closed')
  })
})

describe('while open', () => {
  const openIt = (): CircuitBreaker => {
    const breaker = new CircuitBreaker('openai-compatible', clock)
    for (let attempt = 0; attempt < CONSECUTIVE_FAILURES_TO_OPEN; attempt += 1) {
      breaker.admit()
      breaker.failed(providerError())
    }
    return breaker
  }

  it('refuses fast with LLM_CIRCUIT_OPEN and says when to come back', () => {
    const breaker = openIt()
    let thrown: unknown
    try {
      breaker.admit()
    } catch (error) {
      thrown = error
    }
    expect(isAppError(thrown) && thrown.code).toBe('LLM_CIRCUIT_OPEN')
    expect(
      isAppError(thrown) && (thrown.opts.details as { retryAfterMs: number }).retryAfterMs,
    ).toBe(OPEN_MS)
    // 503: the request was fine and the component is not.
    expect(isAppError(thrown) && thrown.status).toBe(503)
  })

  it('allows exactly one probe after sixty seconds, and refuses a second caller', () => {
    const breaker = openIt()
    advance(OPEN_MS)

    expect(() => {
      breaker.admit()
    }).not.toThrow()
    expect(breaker.currentState()).toBe('half_open')
    expect(() => {
      breaker.admit()
    }).toThrow()
  })

  it('closes when the probe succeeds', () => {
    const breaker = openIt()
    advance(OPEN_MS)
    breaker.admit()
    breaker.succeeded()
    expect(breaker.currentState()).toBe('closed')
    expect(() => {
      breaker.admit()
    }).not.toThrow()
  })

  it('re-opens for another sixty seconds when the probe fails', () => {
    const breaker = openIt()
    advance(OPEN_MS)
    breaker.admit()
    breaker.failed(providerError())
    expect(breaker.currentState()).toBe('open')
    expect(() => {
      breaker.admit()
    }).toThrow()
  })
})

describe('the wrapper', () => {
  it('stops asking a provider that is down, after five calls', async () => {
    const provider = scripted('openai-compatible', () => providerError())
    const wrapped = withCircuitBreaker(provider, new CircuitBreaker('openai-compatible', clock))

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await wrapped.complete(request()).catch(() => null)
    }
    expect(provider.calls()).toBe(CONSECUTIVE_FAILURES_TO_OPEN)
  })

  it('counts a stream that failed, and lets a stream that finished close the circuit', async () => {
    let fail = true
    const provider = scripted('openai-compatible', () =>
      fail ? providerError() : ok('openai-compatible'),
    )
    const breaker = new CircuitBreaker('openai-compatible', clock)
    const wrapped = withCircuitBreaker(provider, breaker)

    const drain = async (): Promise<void> => {
      for await (const _chunk of wrapped.stream(request())) void _chunk
    }
    for (let attempt = 0; attempt < CONSECUTIVE_FAILURES_TO_OPEN; attempt += 1) {
      await drain().catch(() => null)
    }
    expect(breaker.currentState()).toBe('open')

    fail = false
    advance(OPEN_MS)
    await drain()
    expect(breaker.currentState()).toBe('closed')
  })
})

describe('the fallback', () => {
  const downPrimary = () => {
    const primary = scripted('openai-compatible', () => providerError())
    const breaker = new CircuitBreaker('openai-compatible', clock)
    return { primary, guarded: withCircuitBreaker(primary, breaker), breaker }
  }

  const openTheCircuit = async (guarded: LlmProvider): Promise<void> => {
    for (let attempt = 0; attempt < CONSECUTIVE_FAILURES_TO_OPEN; attempt += 1) {
      await guarded.complete(request()).catch(() => null)
    }
  }

  it('answers from the second provider once the circuit is open and it is configured', async () => {
    const { guarded } = downPrimary()
    const secondary = scripted('anthropic', () => ok('anthropic'))
    const chain = withFallback(
      guarded,
      () => secondary,
      () => true,
    )

    await openTheCircuit(chain)
    const result = await chain.complete(request())

    expect(result.text).toBe('answered by anthropic')
    // The result names who answered, which is what `calls.ts` writes on the row (D-103).
    expect(result.provider).toBe('anthropic')
  })

  it('fails fast with LLM_CIRCUIT_OPEN when no fallback is configured', async () => {
    const { guarded } = downPrimary()
    const secondary = scripted('anthropic', () => ok('anthropic'))
    const chain = withFallback(
      guarded,
      () => secondary,
      () => false,
    )

    await openTheCircuit(chain)
    const error = await chain.complete(request()).catch((thrown: unknown) => thrown)

    expect(isAppError(error) && error.code).toBe('LLM_CIRCUIT_OPEN')
    expect(secondary.calls()).toBe(0)
  })

  it('does not fall back on an ordinary failure, only on an open circuit', async () => {
    const primary = scripted('openai-compatible', () => providerError())
    const secondary = scripted('anthropic', () => ok('anthropic'))
    const chain = withFallback(
      primary,
      () => secondary,
      () => true,
    )

    await chain.complete(request()).catch(() => null)
    expect(secondary.calls()).toBe(0)
  })

  it('never builds the second client on a deployment that never falls back', async () => {
    const build = vi.fn(() => scripted('anthropic', () => ok('anthropic')))
    const primary = scripted('openai-compatible', () => ok('openai-compatible'))
    const chain = withFallback(primary, build, () => true)

    await chain.complete(request())
    expect(build).not.toHaveBeenCalled()
  })
})
