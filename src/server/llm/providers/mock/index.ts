// The mock provider (docs/tech/11-llm-integration.md §1.4, D-029, D-063).
//
// Not a stub. `FEATURE_AI=false` is the default in every environment until Phase 14, so this is the
// assistant a student meets in the walkthrough, the reader that drafts five of the seven bands, and
// the author that generates a whole scenario package. The product invariant — "the app must be fully
// usable with no API key" — is this file keeping its promises.
//
// One request in, one answer out, and the answer is a pure function of the request — of the *call*,
// meaning the messages a real provider would have been sent (D-265). Its wording comes from those
// and nothing else; its content comes from `promptInput`, read through a schema per prompt family
// that declares every key the mock uses and strips the rest, so a field no prompt renders can reach
// neither. Those two rules together are what make the mock blind to a claim's evidence status by
// construction rather than by care.
//
// `complete` is the single entry point: `stream` chunks what `complete` produced, and `structured` runs the same
// `structuredViaPrompt` every network adapter runs, over `complete`. That means the mock exercises
// the JSON extraction and Zod validation path for real rather than short-circuiting it, which is
// what makes a schema mistake fail in CI instead of on the first day with a key.
import { AppError } from '@/lib/errors'
import { env } from '@/server/config'
import type {
  CompleteRequest,
  CompleteResult,
  LlmProvider,
  StreamChunk,
  StructuredRequest,
  StructuredResult,
} from '@/server/llm/provider'
import { MOCK_MODEL, estimateTokens, messagesText } from '@/server/llm/provider'
import { rotate, seedOf } from '@/server/llm/providers/mock/deterministic'
import { generationReply, isGenerationPrompt } from '@/server/llm/providers/mock/generation'
import { isBandReadPrompt, readBand } from '@/server/llm/providers/mock/readers'
import {
  AssistantReplyMockInput,
  TriggerClassifyMockInput,
  buildAssistantReply,
  chunkForStream,
  classifyTriggers,
} from '@/server/llm/providers/mock/templates'
import { structuredViaPrompt } from '@/server/llm/structured'

export const ASSISTANT_REPLY_PROMPT = 'assistant-reply'
export const TRIGGER_CLASSIFY_PROMPT = 'trigger-classify'

/**
 * The answer to a prompt this file does not know. It is deliberately plain, digit-free and useless
 * as content: a new prompt must teach the mock how to answer it, and a plausible-looking improvised
 * answer would hide that it never did.
 */
const UNKNOWN_PROMPT_REPLIES: readonly string[] = [
  'The mock provider has no scripted answer for this prompt.',
  'No mock behaviour is defined for this prompt yet.',
  'This prompt is not one the mock provider knows how to answer.',
]

/**
 * The seed: the call a real provider would have received, and nothing else (D-265).
 *
 * `messages` plus the sampling parameters is exactly what goes on the wire, so the mock's wording is
 * a pure function of the prompt the model would have read. Everything else about a `CompleteRequest`
 * is routing metadata, and two of those exclusions are load-bearing:
 *
 *   - `context` carries the request id, new on every call. Seeding on it would make the same
 *     delegation asked twice read differently — the failure §1.4's "deterministic" exists to prevent.
 *   - `promptInput` is the *caller's* object, and only the part of it the renderer wrote into
 *     `messages` is something the student could ever see. Seeding on it opened a covert channel:
 *     `surfaceClaims` loads claim rows carrying `evidenceStatus`, `failureFamily` and `planted`, and
 *     a caller that handed those to the prompt input — even as keys no prompt renders and no mock
 *     schema reads — moved the reply's wording with the run's variant. Identical prompt, different
 *     sentence, per defect: the invariant "the assistant never reveals defect status" broken by the
 *     double that is supposed to be blind, with the rendered prompt and the call digest both
 *     unchanged, so no test downstream could see it.
 *
 * `MockCall` is the enforcement, not the comment: `promptInput` is not a property of the parameter,
 * so putting it back is a type error rather than an edit nobody notices.
 */
export type MockCall = Pick<CompleteRequest, 'messages' | 'temperature' | 'maxOutputTokens'>

export const mockSeed = (call: MockCall): number =>
  seedOf({
    messages: call.messages,
    temperature: call.temperature,
    maxOutputTokens: call.maxOutputTokens,
  })

/** The text the mock answers with; `stream` and `structured` both go through it. */
export function renderMock(req: CompleteRequest): string {
  const seed = mockSeed(req)
  const input = req.promptInput ?? {}

  if (req.promptName === ASSISTANT_REPLY_PROMPT) {
    return buildAssistantReply(AssistantReplyMockInput.parse(input), seed)
  }
  if (req.promptName === TRIGGER_CLASSIFY_PROMPT) {
    return JSON.stringify({
      matched_claim_ids: classifyTriggers(TriggerClassifyMockInput.parse(input)),
    })
  }
  if (isBandReadPrompt(req.promptName)) {
    return JSON.stringify(readBand(req.promptName, input))
  }
  if (isGenerationPrompt(req.promptName)) {
    return JSON.stringify(generationReply(req.promptName, input))
  }
  return rotate(UNKNOWN_PROMPT_REPLIES, seed)
}

/** §1.4: four characters to a token, on the way in and on the way out. */
const usageFor = (req: CompleteRequest, text: string) => ({
  inputTokens: estimateTokens(messagesText(req.messages)),
  outputTokens: estimateTokens(text),
})

/**
 * The one failure this provider can be asked for: `MOCK_FAIL_READS=true` makes every `band-read-*`
 * call throw `LLM_PROVIDER_ERROR`.
 *
 * 11 §3's degradation ladder and FR-140's held run are the hardest paths in the scoring pipeline to
 * reach honestly — a provider that cannot be down leaves them untested until the day one is — so
 * the double is asked to be down. It is read from `process.env` on every call rather than from the
 * parsed `env`, because the parsed environment is frozen at import and a test that flips a switch
 * between two cases would be reading the value the file was loaded with (D-401). It is refused
 * outside development and test, so the variable can never be a production kill switch: `FEATURE_AI`
 * is the only one of those (§6).
 */
const readsForcedToFail = (): boolean =>
  process.env.MOCK_FAIL_READS === 'true' &&
  env.APP_ENV !== 'production' &&
  env.APP_ENV !== 'preview'

async function complete(req: CompleteRequest): Promise<CompleteResult> {
  if (isBandReadPrompt(req.promptName) && readsForcedToFail()) {
    throw new AppError(
      'LLM_PROVIDER_ERROR',
      'The mock provider is failing band reads on purpose.',
      {
        details: { prompt: req.promptName },
      },
    )
  }
  const text = renderMock(req)
  return { text, usage: usageFor(req, text), model: MOCK_MODEL, provider: 'mock' }
}

export const mockProvider: LlmProvider = {
  name: 'mock',

  complete,

  async *stream(req: CompleteRequest): AsyncIterable<StreamChunk> {
    const result = await complete(req)
    for (const chunk of chunkForStream(result.text)) {
      yield { type: 'text', text: chunk }
    }
    yield {
      type: 'done',
      usage: result.usage,
      model: result.model,
      provider: result.provider,
    }
  },

  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    return structuredViaPrompt(req, (messages) => complete({ ...req, messages, temperature: 0.2 }))
  },
}
