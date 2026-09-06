// The follow-up rule (docs/tech/DECISIONS.md D-031 and D-090; FR-123, FR-125;
// 10-backend-spec-modules.md §9).
//
// FR-123 asks for one authored follow-up per question, "asked when the typed answer names no
// source, number, or reason". D-031 makes that deterministic, and the reason it is deterministic is
// PRD §7.12: the defense is the one stage of the run with no AI assistance in it, so the thing that
// decides whether a student is pressed a second time cannot be a model. It is three tests anyone can
// run on their own answer:
//
//   * **no number** — no digit anywhere in it;
//   * **no source** — no run of two or more consecutive words that also appears, consecutively, in
//     the title of a document in the Evidence Room. Two words, not one: "the" and "review" are in
//     half the titles in any room, and a rule that fired on a single token would count "I reviewed
//     it" as naming a document;
//   * **no reason** — none of `because`, `since`, `so that`, `given`, `as the`.
//
// All three must be absent. An answer that names any one of them has said something the follow-up
// exists to ask for, and pressing anyway would make the follow-up a thing that happens rather than a
// thing that means something.
//
// D-090 adds the one case none of the three catches, because it passes all of them: the brief read
// back aloud. It quotes the figures and the reasoning the student already filed, so it has digits
// and reason markers and often a document title — and it is the least informative answer in the
// interview. So a normalized answer that is contained in the normalized brief earns the follow-up
// whatever the three tests say.
//
// Nothing here reads or writes anything, and nothing here is authored content: it takes the answer,
// the room's titles and the filed brief, and answers which rule fired.

/** D-031's markers. Lower-cased and matched on word boundaries against the normalized answer. */
export const REASON_MARKERS = ['because', 'since', 'so that', 'given', 'as the'] as const

/** D-031: a title is "named" by a shared run of at least this many consecutive words. */
export const TITLE_TOKEN_RUN = 2

/** Which rule asked for the follow-up. Recorded in the tests and in the log, never shown. */
export type FollowUpReason = 'no_source_number_or_reason' | 'verbatim_brief'

export type FollowUpContext = {
  /** Every document title in the Evidence Room (FR-022's room, not only what was opened). */
  documentTitles: readonly string[]
  /** The filed brief as D-090 reads it: the recommendation and the rationale, joined. */
  brief: string
}

/**
 * Words, lower-cased, with everything that is not a letter or a digit treated as a space.
 *
 * The same normalization `selection.ts` uses, and for the same reason: a rule a student cannot
 * predict is a rule an instructor cannot explain. Digits are kept as tokens here because the title
 * test has to match "Q3 2026 cohort table" against an answer that spells it the same way.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
}

/** The normalized single-space form D-090 compares (`"  The  memo. "` → `"the memo"`). */
export function normalizeText(text: string): string {
  return tokenize(text).join(' ')
}

/** Every run of `size` consecutive tokens in `tokens`, as space-joined strings. */
function runs(tokens: readonly string[], size: number): Set<string> {
  const out = new Set<string>()
  for (let index = 0; index + size <= tokens.length; index += 1) {
    out.add(tokens.slice(index, index + size).join(' '))
  }
  return out
}

/** D-031: the answer contains a number. */
export function namesNumber(answer: string): boolean {
  return /\d/.test(answer)
}

/**
 * D-031: the answer shares at least two consecutive words with a document's title.
 *
 * A one-word title can never be named under this rule, which is the deliberate cost of the
 * two-token floor: an author who titles a document "Memo" has written a title no answer can be
 * distinguished from ordinary prose by.
 */
export function namesDocument(answer: string, titles: readonly string[]): boolean {
  const inAnswer = runs(tokenize(answer), TITLE_TOKEN_RUN)
  if (inAnswer.size === 0) return false
  return titles.some((title) => {
    for (const run of runs(tokenize(title), TITLE_TOKEN_RUN)) {
      if (inAnswer.has(run)) return true
    }
    return false
  })
}

/**
 * D-031: the answer gives a reason.
 *
 * Matched on the normalized token stream, so "Because—" and "because" are one thing, and a marker
 * is only found on a word boundary: "givens" does not contain `given` for this rule, and neither
 * does "sincerely" contain `since`.
 */
export function namesReason(answer: string): boolean {
  const normalized = normalizeText(answer)
  if (normalized === '') return false
  const padded = ` ${normalized} `
  return REASON_MARKERS.some((marker) => padded.includes(` ${marker} `))
}

/**
 * D-090: the answer is the brief, read back.
 *
 * A substring test on the normalized forms, as D-090 writes it, so an answer that quotes one
 * sentence of the brief counts as much as one that quotes all of it. An empty answer is excluded:
 * the empty string is a substring of everything, and an empty answer has already earned its
 * follow-up under D-031 for the honest reason — it names no source, no number and no reason.
 */
export function readsBackTheBrief(answer: string, brief: string): boolean {
  const normalized = normalizeText(answer)
  if (normalized === '') return false
  return normalizeText(brief).includes(normalized)
}

/**
 * Whether this answer earns the question's authored follow-up, and which rule asked for it.
 *
 * D-031 is tested first because it is the rule FR-123 states; D-090 is the override that catches the
 * answer D-031 cannot see. `null` means the answer named a source, a number or a reason, and was not
 * the brief read back — which is FR-123's "no follow-up is asked", and the Ownership band's
 * Professional condition (PRD Appendix A) reads exactly that outcome.
 */
export function followUpReasonFor(answer: string, context: FollowUpContext): FollowUpReason | null {
  const named =
    namesNumber(answer) || namesDocument(answer, context.documentTitles) || namesReason(answer)
  if (!named) return 'no_source_number_or_reason'
  if (readsBackTheBrief(answer, context.brief)) return 'verbatim_brief'
  return null
}
