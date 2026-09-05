// Trigger matching: which claim objects a delegation surfaces (docs/tech/10-backend-spec-modules.md
// §7, 11-llm-integration.md §2.1, FR-051, AI-004, D-030).
//
// A claim reaches a student because the author said it should: every claim carries
// `trigger_phrases[]`, the wordings that raise it, and `trigger_description`, the sentence saying
// when it belongs in front of someone. Matching those is the deterministic path, and it is the whole
// mechanism with no API key — `FEATURE_AI=false` is the default in every environment until Phase 14,
// so the walkthrough, the E2E suite and the evals all run on the rule below and nothing else.
//
// The rule itself is `src/lib/trigger-match.ts`, because the mock provider has to give the same
// answer and `src/server/llm` may not import a module (D-263). This file is what wraps it: the
// candidate shape the service builds, and the order of the two passes.
//
// AI-004 is the fallback for the third case: a request the author anticipated in meaning but not in
// wording. It runs only when a model is available and the deterministic pass found nothing, or when
// `TRIGGER_MATCHING=llm_first` reverses the order. It can never widen the field beyond this run's
// candidates — the ids it returns are intersected with the list it was given — and a failure inside
// it is not a failure of the delegation: the deterministic result, empty or not, stands.
import { flagsFromEnv } from '@/lib/flags'
import { matchTriggerPhrases } from '@/lib/trigger-match'
import { env } from '@/server/config'
import { getLogger } from '@/server/http/request-context'
import type { LlmCallContext } from '@/server/llm/provider'
import { triggerClassifyPrompt } from '@/server/llm/prompts/trigger-classify'
import { getProvider } from '@/server/llm/registry'

// Re-exported so a caller reading trigger matching has one import: the normalizer is part of the
// same rule, and `src/lib` is where it lives rather than where it is used.
export { normalize, tokensOf } from '@/lib/trigger-match'

/** One claim as the matcher sees it: an id and the two authored fields that raise it. */
export type TriggerCandidate = {
  /** `scenario_claims.id`; the id the reply's `[[claim:<id>]]` marker carries. */
  id: string
  triggerPhrases: readonly string[]
  triggerDescription: string
}

/** Which pass produced the match; the service records it and the tests assert on it. */
export type TriggerMatchVia = 'deterministic' | 'classifier' | 'none'

export type TriggerMatch = { claimIds: string[]; via: TriggerMatchVia }

export type TriggerMatchOptions = {
  /** Defaults to `env.TRIGGER_MATCHING`. */
  order?: (typeof env)['TRIGGER_MATCHING']
  /** Defaults to `flags.ai`; false keeps the classifier out of the deterministic-first path. */
  aiEnabled?: boolean
  context: LlmCallContext
}

/**
 * The deterministic pass (D-030), which is `matchTriggerPhrases` and nothing added: the same call
 * the mock's `trigger-classify` answer makes, so the two cannot drift (D-263).
 */
export const matchTriggers = (request: string, candidates: readonly TriggerCandidate[]): string[] =>
  matchTriggerPhrases(request, candidates)

/**
 * AI-004: the classifier reads the descriptions and names the claims the request is about.
 *
 * Never throws. A classifier that fails — a timeout, an exhausted budget, a model that answered with
 * prose — must not fail the delegation it was helping: the student asked the assistant a question,
 * not this router, and the deterministic result is a complete answer on its own.
 */
export async function classifyWithModel(
  request: string,
  candidates: readonly TriggerCandidate[],
  context: LlmCallContext,
): Promise<string[]> {
  if (candidates.length === 0) return []

  try {
    const { messages, input } = triggerClassifyPrompt.render({
      request,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        description: candidate.triggerDescription,
        triggerPhrases: [...candidate.triggerPhrases],
      })),
    })

    const result = await getProvider().structured({
      feature: 'trigger_classify',
      promptName: triggerClassifyPrompt.name,
      promptVersion: triggerClassifyPrompt.version,
      messages,
      promptInput: input,
      temperature: 0.2,
      schema: triggerClassifyPrompt.output,
      schemaName: 'TriggerClassifyOutput',
      context,
    })

    // Intersected with the candidates, in candidate order: an id the model invented, or one from
    // another run's variant, cannot become a claim in front of this student.
    const named = new Set(result.value.matched_claim_ids)
    return candidates
      .filter((candidate) => named.has(candidate.id))
      .map((candidate) => candidate.id)
  } catch (error) {
    getLogger().warn(
      { err: error, prompt: triggerClassifyPrompt.id },
      'trigger classification failed; the deterministic result stands',
    )
    return []
  }
}

/**
 * The order of the two passes (D-030).
 *
 * `deterministic_first` (the default) asks the classifier only when the authored phrases matched
 * nothing and a model is available. `llm_first` asks it first and falls back to the phrases; it runs
 * the classifier whether or not `FEATURE_AI` is on, because on the mock the classifier *is* the
 * deterministic matcher (§1.4) — which is what lets the AI-004 path be exercised end to end with no
 * key, and what makes flipping the switch change latency and cost rather than outcomes.
 */
export async function matchClaims(
  request: string,
  candidates: readonly TriggerCandidate[],
  options: TriggerMatchOptions,
): Promise<TriggerMatch> {
  const order = options.order ?? env.TRIGGER_MATCHING
  const aiEnabled = options.aiEnabled ?? flagsFromEnv(env).ai

  if (order === 'llm_first') {
    const classified = await classifyWithModel(request, candidates, options.context)
    if (classified.length > 0) return { claimIds: classified, via: 'classifier' }
    const deterministic = matchTriggers(request, candidates)
    return deterministic.length > 0
      ? { claimIds: deterministic, via: 'deterministic' }
      : { claimIds: [], via: 'none' }
  }

  const deterministic = matchTriggers(request, candidates)
  if (deterministic.length > 0) return { claimIds: deterministic, via: 'deterministic' }
  if (!aiEnabled) return { claimIds: [], via: 'none' }

  const classified = await classifyWithModel(request, candidates, options.context)
  return classified.length > 0
    ? { claimIds: classified, via: 'classifier' }
    : { claimIds: [], via: 'none' }
}
