// The provider abstraction every LLM-backed feature calls through (docs/tech/11-llm-integration.md
// §1). Three implementations satisfy it: the deterministic `mock` (default everywhere until Phase
// 14, D-029/D-063), the `openai-compatible` MiMo adapter, and the `anthropic` fallback.
//
// Nothing above this file knows which one it holds. A service asks the registry for a provider,
// hands it a `CompleteRequest`, and reads text, a stream, or a validated object back; the
// difference between a mock reply and a network call is the registry's business alone. That is what
// makes `FEATURE_AI=false` a complete product rather than a degraded one.
//
// `embed()` is deliberately absent: the PRD needs no retrieval, and an interface method with no
// caller is a promise the mock would have to keep.
import type { ZodType } from 'zod'

export const LLM_PROVIDER_NAMES = ['mock', 'openai-compatible', 'anthropic'] as const
export type LlmProviderName = (typeof LLM_PROVIDER_NAMES)[number]

/** `llm_calls.feature` (06 §3.6 DATA-049); the enum the database column carries. */
export const LLM_FEATURES = [
  'assistant',
  'band_read',
  'generation',
  'trigger_classify',
  'eval',
] as const
export type LlmFeature = (typeof LLM_FEATURES)[number]

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type LlmUsage = { inputTokens: number; outputTokens: number }

/**
 * The ids a call is logged against. `requestId` is always present — every call happens inside a
 * request or a job that has one — and the rest are the subjects the `llm_calls` row points at.
 * D-066: never a name, never an email, never anything a prompt could carry into a third party.
 */
export type LlmCallContext = {
  userId?: string
  runId?: string
  packageVersionId?: string
  requestId: string
}

export type CompleteRequest = {
  feature: LlmFeature
  /** Prompt file name, kebab-case (`assistant-reply`); logged with `promptVersion` per call. */
  promptName: string
  promptVersion: number
  messages: LlmMessage[]
  /** Defaults to `env.LLM_MAX_OUTPUT_TOKENS`. */
  maxOutputTokens?: number
  /** Defaults to 0.2 for structured calls and 0.7 for free text. */
  temperature?: number
  /** Defaults to `env.LLM_TIMEOUT_MS`. */
  timeoutMs?: number
  /**
   * The prompt's validated input object, the one `promptDef.user(input)` rendered `messages` from.
   *
   * §1 does not name this field, and a network adapter never reads it — a model sees `messages` and
   * nothing else, so passing it changes no request on the wire. The mock reads it, and the
   * alternative was worse: a mock that recovers `{ id, text }` claim pairs and per-field word counts
   * by parsing its own rendered prompt would tie every prompt in the library to a text format
   * nothing declares, and a wording change in Phase 10 would silently change what the default
   * provider answers. Handing the double the same object the renderer got keeps the mock honest
   * about its inputs and keeps the prompts free to be written for a reader (D-063).
   *
   * It is `unknown` on purpose: the mock parses it with its own schema per prompt family and says
   * so when it cannot, rather than trusting a shape nobody checked.
   */
  promptInput?: unknown
  context: LlmCallContext
}

export type CompleteResult = {
  text: string
  usage: LlmUsage
  model: string
  provider: string
}

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'done'; usage: LlmUsage; model: string; provider: string }

export type StructuredRequest<T> = CompleteRequest & { schema: ZodType<T>; schemaName: string }

export type StructuredResult<T> = {
  value: T
  /** True when the first output failed validation and the one repair call succeeded (§1.2). */
  repaired: boolean
  raw: string
  usage: LlmUsage
  model: string
  provider: string
}

export interface LlmProvider {
  readonly name: LlmProviderName
  complete(req: CompleteRequest): Promise<CompleteResult>
  stream(req: CompleteRequest): AsyncIterable<StreamChunk>
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>
}

/**
 * §1.4: usage on the mock, and the estimate any adapter falls back to when a response reports none.
 * Four characters per token is the rough English ratio; it only has to be stable and non-zero, so
 * budgets and the cost estimate have something to sum (D-065).
 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

export const messagesText = (messages: readonly LlmMessage[]): string =>
  messages.map((message) => message.content).join('\n')

/** The mock's `llm_calls.model`; a real name, so a row can never be mistaken for a paid call. */
export const MOCK_MODEL = 'mock-v1'

/**
 * The model a provider serves when the call itself never got far enough to report one — the failure
 * paths of the logging wrapper. Reading it from the environment is what keeps a failed call's row
 * pointing at the model that would have answered it.
 */
export const defaultModelFor = (name: LlmProviderName, env: LlmModelEnv): string => {
  if (name === 'mock') return MOCK_MODEL
  return name === 'anthropic' ? env.LLM_FALLBACK_MODEL : env.LLM_MODEL
}

/** Structural, so this file stays free of `@/server/config` and can be read from a test. */
export type LlmModelEnv = { LLM_MODEL: string; LLM_FALLBACK_MODEL: string }
