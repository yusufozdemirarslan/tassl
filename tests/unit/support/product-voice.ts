// The product's voice, as a scan (FR-153, FR-131, PRD §7 standing rules; D-450, D-457).
//
// Three word lists and one matcher, shared by the two catalogues that are held to them: the
// student's debrief (`tests/unit/debrief/assembly.test.ts`) and the reviewer's replay
// (`tests/unit/lib/review-voice.test.ts`). It lives here rather than inside either suite because a
// second copy would be a second set of forbidden words, and the copy that fell behind would be the
// one nobody was reading.
//
// The lists are matched on **word boundaries**, never as substrings, because the substrings collide
// with ordinary English these catalogues are entitled to use: "means" and "meaning" are not the
// noun "mean", "default" is not "fault", "appeared" is not "peer", "frank" is not "rank", and
// "unscoreable" is not "score". The variants each term admits are written out, so "cheating" is
// caught by the entry for "cheat".

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
 * FR-131: "no composite judgment score, rank, percentile, or validated trait claim". Nothing on this
 * surface compares one run with another or with a cohort, and the word "score" does not appear —
 * what the run holds is seven bands, and what the course does with them is arithmetic.
 */
export const RANKING: Vocabulary = {
  name: 'ranking and comparison',
  terms: [
    'score(?:s|d|r|rs)?',
    'scoring',
    'rank(?:s|ed|ing|ings)?',
    'percentile(?:s)?',
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

const matcherFor = (vocabulary: Vocabulary): RegExp =>
  new RegExp(`\\b(?:${vocabulary.terms.join('|')})\\b`, 'gi')

/** Every key and value of a namespace, as `path → text` pairs to scan; keys are scanned too. */
function namespaceStrings(catalogue: Record<string, string>): { path: string; text: string }[] {
  return Object.entries(catalogue).flatMap(([key, value]) => [
    { path: `${key} (key)`, text: key.replace(/[.]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2') },
    { path: key, text: value },
  ])
}

export function scan(
  catalogue: Record<string, string>,
): { path: string; word: string; rule: string }[] {
  const findings: { path: string; word: string; rule: string }[] = []
  for (const { path, text } of namespaceStrings(catalogue)) {
    for (const vocabulary of VOCABULARIES) {
      for (const hit of text.match(matcherFor(vocabulary)) ?? []) {
        findings.push({ path, word: hit, rule: vocabulary.name })
      }
    }
  }
  return findings
}
