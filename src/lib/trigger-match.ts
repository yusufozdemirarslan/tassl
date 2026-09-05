// Trigger matching, the rule (docs/tech/10-backend-spec-modules.md §7, D-030, D-263).
//
// A claim reaches a student because the author said it should: every claim carries
// `trigger_phrases[]`, the wordings that raise it. This file is the one place that decides whether a
// request contains one of them, and it lives in `src/lib` for a boundary reason rather than a
// taxonomic one.
//
// Two callers need the identical answer and cannot import each other. `src/server/modules/assistant/
// triggers.ts` is the deterministic matcher; `src/server/llm/providers/mock/templates.ts` is the
// mock's answer to `trigger-classify@1`, which §1.4 requires to be *the deterministic matcher's
// result* so that `TRIGGER_MATCHING=llm_first` changes the path and not the outcome. `src/server/llm`
// may not import a module (04 §2), so before D-263 the rule was written twice — and the two copies
// disagreed on both of the cases where it is possible to disagree. `src/lib` is what both may reach,
// the same answer D-075 gave `wordLimit`.
//
// Two rules, both from D-030, and a claim matches when either holds:
//
//   *Phrase.* The normalized phrase appears in the normalized request as a whole run of tokens.
//   "premium payback" matches "What's the *premium payback*, exactly?" and "Prémium paybáck?".
//
//   *Token set.* Every token of the phrase appears somewhere in the request, in any order. "payback
//   period" matches "what payback are we betting on over the period the board cares about", which is
//   the same question asked by someone who does not know the author's phrasing.
//
// Both compare whole tokens (D-260). The phrase branch is anchored at token boundaries, so "survey"
// does not match "surveyors" and "payback period" does not match "prepayback periodic" — a claim
// surfaced by a fragment of an unrelated word is not evidence the student asked for, and it would
// land in their stance matrix as though they had.

/** The two fields matching reads. A candidate is a claim; anything else on it is ignored here. */
export type TriggerPhraseCandidate = { id: string; triggerPhrases: readonly string[] }

/**
 * NFKD, marks dropped, lower-cased, apostrophes deleted, everything else non-alphanumeric folded to
 * a single space (10 §7).
 *
 * Apostrophes go before the punctuation pass rather than with it, so "what's" is the one token
 * "whats" instead of the two tokens "what" and "s" — a phrase's token set would otherwise gain a
 * stray token from every possessive in the request.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['‘’´`]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export const tokensOf = (text: string): string[] => normalize(text).split(' ').filter(Boolean)

/**
 * A padded copy, so `includes(' phrase ')` is a token-boundary test rather than a substring test.
 * Cheap, and it keeps the boundary rule in one place instead of in a regex built per phrase.
 */
const padded = (normalized: string): string => ` ${normalized} `

/** A request normalized once, in the two shapes the two rules ask for. */
export type PreparedRequest = { padded: string; tokens: ReadonlySet<string> }

export function prepareRequest(request: string): PreparedRequest {
  const normalized = normalize(request)
  return { padded: padded(normalized), tokens: new Set(normalized.split(' ').filter(Boolean)) }
}

/** D-030's two rules, over one phrase. */
export function phraseMatches(request: PreparedRequest, phrase: string): boolean {
  const phraseTokens = tokensOf(phrase)
  if (phraseTokens.length === 0) return false
  if (request.padded.includes(padded(phraseTokens.join(' ')))) return true
  return phraseTokens.every((token) => request.tokens.has(token))
}

/**
 * The ids of every candidate one of whose phrases matches, in candidate order.
 *
 * A candidate with no phrases matches nothing: an author who wrote no phrase has said the claim has
 * no wording that raises it on its own. Falling back to some other field — a description, say — would
 * raise it on a word the author never nominated, which is a row in the stance matrix the student is
 * answerable for without having asked for it.
 */
export function matchTriggerPhrases(
  request: string,
  candidates: readonly TriggerPhraseCandidate[],
): string[] {
  const normalized = normalize(request)
  if (normalized === '') return []
  const prepared = prepareRequest(request)

  return candidates
    .filter((candidate) =>
      candidate.triggerPhrases.some((phrase) => phraseMatches(prepared, phrase)),
    )
    .map((candidate) => candidate.id)
}
