// Module `authoring` — authored-element string checks (AI-005; docs/tech/10-backend-spec-modules.md
// §4 rule `READINESS_SPLIT` and §5; 12-security.md §"A readiness item names a defect").
//
// A Readiness Check item must not hand the student the defect: no item stem may repeat eight or
// more consecutive words of any consequential claim. The check is pure — no database, no provider,
// no clock — because two callers need it at different moments: `scenarios/validate.ts` runs it over
// a stored version at confirmation (Phase 5), and the `gen-readiness-items` generation step runs it
// over model output before any element row exists (Phase 12, 11-llm-integration.md §2.1). Callers
// that hold unsaved elements pass the element key as `id`; the result only ever echoes ids back.
import { stripMarkup } from '@/lib/words'

/** Eight or more consecutive shared words is an echo (10 §4 `READINESS_SPLIT`, AI-005). */
export const CLAIM_ECHO_WORD_RUN = 8

/** What the check reads from a readiness item; a `readiness_items` row satisfies it. */
export type CheckedReadinessItem = { id: string; stem: string }

/** What the check reads from a claim; a `scenario_claims` row satisfies it. */
export type CheckedClaim = { id: string; text: string }

/** One offending item and the claim it echoes, so the caller can report both element ids. */
export type ClaimEcho = {
  itemId: string
  claimId: string
  /** The shared run, normalised, so the author sees which words to rewrite. */
  phrase: string
}

export type ClaimEchoCheck = { ok: boolean; echoes: ClaimEcho[] }

/**
 * The words two texts are compared by: markup stripped (10 §5 `stripMarkup`), compatibility-folded
 * and lower-cased, apostrophes dropped so "student's" and "students" are one word, and every other
 * non-alphanumeric character treated as a separator. This is the same shape of normalisation the
 * trigger matcher uses (10 §7) and it is what makes the rule bite: "Premium payback is 11 months,
 * per the deck" must still be caught by a claim reading "premium payback is 11 months per the deck".
 * Compatibility decomposition also folds accents and ligatures, so an author cannot dodge the check
 * by retyping a word with a different code point. The combining marks it leaves behind are deleted
 * rather than treated as separators: a mark inside a word would otherwise split "résumé" into two
 * words and move the eight-word boundary for every text that contains an accent.
 */
export function normalizeWords(text: string): string[] {
  return stripMarkup(text)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['‘’´`]/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
}

/** Every window of `CLAIM_ECHO_WORD_RUN` consecutive words, in order; shorter texts yield none. */
function wordRuns(words: readonly string[]): string[] {
  const runs: string[] = []
  for (let start = 0; start + CLAIM_ECHO_WORD_RUN <= words.length; start += 1) {
    runs.push(words.slice(start, start + CLAIM_ECHO_WORD_RUN).join(' '))
  }
  return runs
}

/**
 * AI-005: no readiness item stem may contain eight or more consecutive words of any claim text.
 *
 * Reports at most one echo per item — the first run its stem repeats, attributed to the first claim
 * (in the given order) that contains that run — because the author's fix is to rewrite the one
 * stem, and the caller reports one element id per offence. A claim shorter than eight words cannot
 * be echoed under the rule as written, and neither can it be reported.
 */
export function noItemNamesAClaim(
  items: readonly CheckedReadinessItem[],
  claims: readonly CheckedClaim[],
): ClaimEchoCheck {
  const claimIdByRun = new Map<string, string>()
  for (const claim of claims) {
    for (const run of wordRuns(normalizeWords(claim.text))) {
      if (!claimIdByRun.has(run)) claimIdByRun.set(run, claim.id)
    }
  }

  const echoes: ClaimEcho[] = []
  if (claimIdByRun.size > 0) {
    for (const item of items) {
      for (const run of wordRuns(normalizeWords(item.stem))) {
        const claimId = claimIdByRun.get(run)
        if (claimId === undefined) continue
        echoes.push({ itemId: item.id, claimId, phrase: run })
        break
      }
    }
  }

  return { ok: echoes.length === 0, echoes }
}
