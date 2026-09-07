// The product's voice, as three word lists and one matcher (FR-153, FR-131, PRD §7 standing rules;
// D-450, D-457, D-468, D-513).
//
// **One list, two readers.** These vocabularies are checked in two places and they are the same
// lists in both, because a rule enforced twice from two copies is a rule enforced once from
// whichever copy someone remembered to update. The two readers are:
//
//   * **the authored catalogue**, scanned key by key by `tests/unit/lib/product-voice.test.ts` over
//     every namespace of `src/lib/i18n/messages` — strings a person wrote, checked at build time;
//   * **the model's own sentence**, at run time. `scoring/reads.ts` runs the band rationale through
//     these lists before it is stored on `run_bands.rationale`, which the student's debrief and the
//     Judgment Record render verbatim. FR-153's "never uses the word cheating" and "never
//     characterizes motives" had only the catalogue scan behind them, and the one student-facing
//     string in the product that no person writes is exactly the one it could not see.
//
// The lists are matched on **word boundaries**, never as substrings, because the substrings collide
// with ordinary English these catalogues are entitled to use: "means" and "meaning" are not the
// noun "mean", "default" is not "fault", "appeared" is not "peer", "frank" is not "rank", and
// "unscoreable" is not "score". The variants each term admits are written out, so "cheating" is
// caught by the entry for "cheat".
//
// This file is in `src/lib` and imports nothing: `src/lib` never imports `src/server`, and the test
// support module re-exports from here rather than the other way round, so the production filter can
// never be the copy that fell behind.

/** One forbidden term, as a regex source matched on word boundaries (see the file header). */
export type Vocabulary = { name: string; terms: readonly string[] }

/**
 * "Nothing Tassl observes is treated as misconduct" (PRD §7 standing rules) and "the debrief never
 * uses the word cheating" (FR-153). There is no sentence on this surface that accuses.
 */
export const MISCONDUCT: Vocabulary = {
  name: 'misconduct',
  terms: [
    'cheat(?:s|ed|ing|er|ers)?',
    'dishonest(?:y|ly)?',
    'misconduct',
    'plagiaris(?:m|e|ed|ing)',
    'plagiariz(?:m|e|ed|ing)',
    'fraud(?:ulent)?',
    'deceit(?:ful)?',
    'deceiv(?:e|ed|ing)',
    'decept(?:ion|ive)',
    'suspicio(?:n|us)',
    'violat(?:e|ed|ion|ions)',
    'guilt(?:y)?',
    'blam(?:e|ed|ing)',
    'fault(?:y)?',
    'caught',
    'breach(?:ed|es)?',
    'excuse(?:s|d)?',
    'accus(?:e|ed|ation|ations)',
  ],
}

/**
 * "Never characterizes motives" and "attributes failures to specific actions and omissions"
 * (FR-153), and PRD §7.13's rule that Tassl describes what happened, never who the person is. The
 * verb "fail" is in the list on purpose: "you failed to check" is exactly the register the rule
 * exists to keep out, and "accepted without running a Source Trace" is what replaces it.
 */
export const CHARACTER: Vocabulary = {
  name: 'character and motive',
  terms: [
    'lazy',
    'laziness',
    'careless(?:ly|ness)?',
    'sloppy',
    'negligen(?:t|ce)',
    'incompeten(?:t|ce)',
    'stupid',
    'fool(?:s|ish)?',
    'naive',
    'gullible',
    'credulous',
    'arrogan(?:t|ce)',
    'complacen(?:t|cy)',
    'reckless(?:ly|ness)?',
    'overconfiden(?:t|ce)',
    'unmotivated',
    'disengaged',
    'rush(?:ed|ing)',
    'attitude',
    'motive(?:s)?',
    'intent(?:ion|ional|ionally)?',
    'deliberate(?:ly)?',
    'wilful(?:ly)?',
    'willful(?:ly)?',
    'character',
    'trait(?:s)?',
    'personality',
    'capable',
    'incapable',
    'fail(?:s|ed|ing|ure|ures)?',
    'weak(?:ly|er|ness)?',
    'poor(?:ly)?',
    'bad(?:ly)?',
    'good',
    'strong(?:ly|er)?',
    'excellent',
    'impressive',
    'disappointing',
  ],
}

/**
 * FR-131: "no composite judgment score, rank, percentile, or validated trait claim". Nothing on
 * these surfaces compares one run with another or with a cohort, and the word "score" does not
 * appear — what the run holds is seven bands, and what the course does with them is arithmetic.
 *
 * `quartile` and `decile` are here because the run-time list carried them and this one did not,
 * which is the divergence a single list exists to make impossible (D-513).
 */
export const RANKING: Vocabulary = {
  name: 'ranking and comparison',
  terms: [
    'score(?:s|d|r|rs)?',
    'scoring',
    'rank(?:s|ed|ing|ings)?',
    'percentile(?:s)?',
    'quartile(?:s)?',
    'decile(?:s)?',
    'average(?:s|d)?',
    'mean',
    'median',
    'cohort(?:s)?',
    'peer(?:s)?',
    'classmate(?:s)?',
    'composite',
    'better than',
    'worse than',
    'compared (?:to|with)',
    'comparison(?:s)?',
    'top of',
    'bottom of',
  ],
}

export const VOCABULARIES: readonly Vocabulary[] = [MISCONDUCT, CHARACTER, RANKING]

/**
 * One vocabulary as a global, case-insensitive, word-boundaried alternation.
 *
 * Compiled once per vocabulary: the run-time filter runs on every band read of every scored run,
 * and the lists are module constants. A `g` regex is safe to share here because `String.match`
 * returns every match and resets `lastIndex`; nothing below uses `exec` or `test`.
 */
const MATCHERS = new WeakMap<Vocabulary, RegExp>()

export function matcherFor(vocabulary: Vocabulary): RegExp {
  const cached = MATCHERS.get(vocabulary)
  if (cached) return cached
  const compiled = new RegExp(`\\b(?:${vocabulary.terms.join('|')})\\b`, 'gi')
  MATCHERS.set(vocabulary, compiled)
  return compiled
}

/** One term the product's voice forbids, and which rule forbids it. */
export type VoiceHit = { word: string; rule: string }

/**
 * Every forbidden term in a piece of text, in no particular order.
 *
 * The caller decides what a hit means: the catalogue scan reports it against the key it was found
 * on, and `scoring.filterRationale` refuses the whole sentence. Neither decides which words are
 * forbidden, which is the point of this file.
 */
export function voiceHits(
  text: string,
  vocabularies: readonly Vocabulary[] = VOCABULARIES,
): VoiceHit[] {
  const hits: VoiceHit[] = []
  for (const vocabulary of vocabularies) {
    for (const word of text.match(matcherFor(vocabulary)) ?? []) {
      hits.push({ word, rule: vocabulary.name })
    }
  }
  return hits
}
