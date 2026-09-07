import { describe, expect, it, vi } from 'vitest'
import { CHARACTER, MISCONDUCT, RANKING, VOCABULARIES } from '@/lib/product-voice'
import { BAND_RATIONALE_TERMS, filterRationale } from '@/server/modules/scoring'
import { everyForbiddenWord, scan } from '../support/product-voice'

// A refusal is a `warn` in production, because a run whose rationale had to be dropped is a run an
// operator should be able to see. Here it would be one line per case over a suite that walks every
// term of every vocabulary, so the logger is stubbed and the behaviour under test is the return
// value.
vi.mock('@/server/http/request-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLogger: () => ({ warn: () => {}, info: () => {}, error: () => {}, debug: () => {} }),
}))

// D-513: the product's central promise has a run-time guarantee, not an instruction to a model.
//
// `run_bands.rationale` is the one student-facing string in Tassl that no person writes. The
// pipeline composes it from a categorical sentence this codebase authored and the model's own
// sentence spliced after it, stores it, and `band-card.tsx` renders it verbatim on the student's
// debrief and on the Judgment Record — the artifact a person may still be reading a year later.
//
// FR-131's "no rank, no percentile" had a run-time filter. FR-153's "never uses the word cheating"
// and "never characterizes motives", and PRD §7's "nothing Tassl observes is treated as
// misconduct", had a **static scan of the authored catalogue** — which cannot see model output, and
// this is model output. Every sentence in the first block below passed the filter unchanged.
//
// The rule now: a hit from any of the three vocabularies **refuses the whole rationale**, and the
// band keeps the categorical sentence alone. Redaction was the wrong instrument — "You were
// […] here and […] to check the figure" is the same accusation with two holes in it, and the reader
// fills them in. The 12 §8.1 disclosure spans are still redacted, because there the *span* is the
// problem and the rest of the sentence is a true description of what happened.

const CLEAN = 'The brief names the fee schedule and the date it was replaced.'

describe('a band rationale that accuses or ranks is refused whole', () => {
  it.each([
    ['You were careless here and failed to check the figure before locking.'],
    ['The student was sloppy and lazy about the Source Trace.'],
    ['This looks like cheating and the run is under suspicion.'],
    ['A reckless, overconfident decision taken in bad faith.'],
  ])('refuses %s', (rationale) => {
    expect(filterRationale(rationale)).toBe('')
  })

  it.each([
    ['a rank', 'This run ranks above the cohort average for the section.'],
    ['a percentile', 'The run sits in the top quartile of this percentile band.'],
    ['a comparison', 'The brief is better than the ones other students filed.'],
  ])('refuses %s', (_name, rationale) => {
    expect(filterRationale(rationale)).toBe('')
  })

  it('leaves a rationale that describes what happened exactly as it was written', () => {
    expect(filterRationale(CLEAN)).toBe(CLEAN)
  })

  it('refuses a word disguised with a homoglyph, like the defect-word filter does', () => {
    // A Cyrillic а in "careless". The voice lists are matched against the same folded copy §3's own
    // filter matches through (D-427), so an evasion that beats a plain regex does not beat this.
    expect(filterRationale('The run was cаreless with the figure.')).toBe('')
  })
})

describe('every term of every vocabulary is caught at run time', () => {
  // The proof that the two readers cannot diverge. It is not a list of examples someone kept in
  // step by hand: it walks the lists themselves, so a term added to `src/lib/product-voice.ts` is
  // covered by this test the moment it is added, and a term the run-time filter cannot see fails.
  const words = everyForbiddenWord()

  it('walks every term the three vocabularies hold', () => {
    expect(words.length).toBe(
      MISCONDUCT.terms.length + CHARACTER.terms.length + RANKING.terms.length,
    )
    expect(words.every((entry) => entry.word.length > 0)).toBe(true)
  })

  it.each(words.map((entry) => [entry.rule, entry.source, entry.word] as const))(
    'refuses a rationale carrying the %s term %s',
    (_rule, _source, word) => {
      expect(filterRationale(`The recorded actions were ${word} in this run.`)).toBe('')
    },
  )
})

describe('the run-time filter and the catalogue scan read one list', () => {
  it('holds the same three vocabularies the catalogue is scanned against', () => {
    expect(VOCABULARIES.map((vocabulary) => vocabulary.name)).toEqual([
      'misconduct',
      'character and motive',
      'ranking and comparison',
    ])
  })

  it('carries no ranking term the catalogue scan cannot see', () => {
    // The divergence that was already there: `quartile` and `decile` were in the run-time list and
    // not in the scanned one. Both lists are now the same object, so this is a statement about that
    // object rather than about two of them.
    for (const word of ['quartile', 'decile', 'percentile', 'rank', 'score']) {
      expect(filterRationale(`A ${word} of some kind.`)).toBe('')
      expect(scan({ 'planted.key': `A ${word} of some kind.` }).length).toBeGreaterThan(0)
    }
  })

  it('keeps the 12 §8.1 disclosure spans on a redaction rather than a refusal', () => {
    // A disclosure is a span; a voice breach is a sentence. Removing "expected answer" leaves a
    // sentence that still describes the run, which is why `BAND_RATIONALE_TERMS` stayed a redaction
    // list and why FR-131's half of it moved out to `RANKING`.
    const filtered = filterRationale('The reply misses what the expected answer asks for.')
    expect(filtered).not.toBe('')
    expect(filtered.toLowerCase()).not.toContain('expected answer')
    expect(filtered).toContain('The reply misses what the')
  })

  it('holds no FR-131 term in the redaction list any more', () => {
    for (const term of BAND_RATIONALE_TERMS) {
      expect(['score', 'rank', 'percentile', 'quartile', 'decile', 'peer']).not.toContain(term)
    }
  })
})
