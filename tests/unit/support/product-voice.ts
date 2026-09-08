// The catalogue half of the product's voice (FR-153, FR-131, PRD §7 standing rules; D-450, D-457,
// D-468, D-513).
//
// The three vocabularies live in `src/lib/product-voice.ts`, because the run-time band-rationale
// filter is held to the same lists and a second copy would be a second set of forbidden words — the
// copy that fell behind being the one nobody was reading, which is what had already happened
// (`quartile` and `decile` were in the run-time list and not in this one). This module is the part
// only a test needs: walking a message catalogue, and materialising a term so a test can prove the
// filter catches it.

import { VOCABULARIES, voiceHits, type Vocabulary } from '@/lib/product-voice'

export {
  CHARACTER,
  MISCONDUCT,
  RANKING,
  VOCABULARIES,
  matcherFor,
  voiceHits,
  type Vocabulary,
  type VoiceHit,
} from '@/lib/product-voice'

/** Every key and value of a namespace, as `path → text` pairs to scan; keys are scanned too. */
function namespaceStrings(catalogue: Record<string, string>): { path: string; text: string }[] {
  return Object.entries(catalogue).flatMap(([key, value]) => [
    { path: `${key} (key)`, text: key.replace(/[.]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2') },
    { path: key, text: value },
  ])
}

/**
 * Every forbidden word in a namespace, as `path → word → rule`.
 *
 * `vocabularies` narrows the reading, never the list: `tests/unit/copy/never-accuses.test.ts` asks
 * this same walker about the four words FR-006 names, and gets them from `MISCONDUCT`'s own entries
 * rather than from a second list that could disagree with it.
 */
export function scan(
  catalogue: Record<string, string>,
  vocabularies: readonly Vocabulary[] = VOCABULARIES,
): { path: string; word: string; rule: string }[] {
  return namespaceStrings(catalogue).flatMap(({ path, text }) =>
    voiceHits(text, vocabularies).map((hit) => ({ path, ...hit })),
  )
}

/** Every namespace module under `src/lib/i18n/messages`, so one added later is scanned too. */
export function everyCatalogue(
  modules: Record<string, Record<string, unknown>>,
): { file: string; catalogue: Record<string, string> }[] {
  return Object.entries(modules)
    .flatMap(([file, module]) =>
      Object.values(module)
        .filter(
          (value): value is Record<string, string> =>
            typeof value === 'object' &&
            value !== null &&
            Object.values(value).every((entry) => typeof entry === 'string'),
        )
        .map((catalogue) => ({ file: file.slice(file.lastIndexOf('/') + 1), catalogue })),
    )
    .sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * One concrete word a vocabulary entry forbids, from its regex source.
 *
 * The entries are patterns — `cheat(?:s|ed|ing|er|ers)?`, `compared (?:to|with)` — and a test that
 * proves the run-time filter catches *every* entry needs a real word per entry rather than a list
 * of examples someone kept in step by hand. Taking the first alternative of each group gives one:
 * `cheats`, `compared to`, `plagiarism`, `arrogant`.
 */
export const sampleTermOf = (term: string): string =>
  term.replace(/\((?:\?:)?([^)]*)\)\??/g, (_match, alternatives: string) =>
    (alternatives.split('|')[0] ?? '').trim(),
  )

/** Every term of every vocabulary, materialised, with the rule that forbids it. */
export const everyForbiddenWord = (
  vocabularies: readonly Vocabulary[] = VOCABULARIES,
): { rule: string; source: string; word: string }[] =>
  vocabularies.flatMap((vocabulary) =>
    vocabulary.terms.map((term) => ({
      rule: vocabulary.name,
      source: term,
      word: sampleTermOf(term),
    })),
  )
