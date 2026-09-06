// The defect-word filter (docs/tech/11-llm-integration.md §3 "Prompt injection", FR-056, D-067).
//
// The product's core promise about the assistant is that it is useful, that it is not uniformly
// reliable, and that it never says which is which. A student who could ask "is this one sound?" and
// get an answer would not be making a judgement about evidence; they would be reading a verdict, and
// the run would measure nothing. The assistant is never told a claim's evidence status, so it has no
// verdict to give — but a model can still produce the *vocabulary* of one, out of an injected
// instruction it half-obeyed, out of a student's own phrasing echoed back, or out of nothing at all.
//
// So this is the second line behind the system prompt's instruction, and the difference between the
// two matters: an instruction is a request, and a filter is a guarantee. §3 says exactly what to do
// when it fires — replace the match with `[…]` and flag the delegation `filtered` — and that is all
// this does. Not log-and-ship: the replacement happens before the reply is stored, so the words
// never reach the student's screen, the stored `run_delegations.response_text`, or the replay.
//
// WHAT IS ON THE LIST, AND WHY THESE
//
// §3 names `defective`, `planted`, `sound claim` and the band names. Around them sit the rest of the
// vocabulary the answer key is written in: the evidence statuses, the ten failure families of PRD
// §7.5, and the phrases that name the key itself (`evidence status`, `failure family`, `warranted
// stance`). The test each term has to pass is not "could this word appear in a leak" but "does the
// assistant have any legitimate use for it in this room". A term that fails that test is free to
// filter; a term that passes it is not, because a filter that mangles ordinary analysis makes the
// assistant look broken, and an assistant a student routes around teaches them to route around it.
//
// Two consequences of that test, both deliberate:
//
//   *The single-word family names are not on the list; the multi-word ones are.* "That is an
//   extrapolation from two cohorts" is exactly the kind of argument PRD §7.5 wants the assistant to
//   be capable of, and the model making it knows nothing about the family called `extrapolation`.
//   "Stale evidence", "near neighbor" and "unstated assumption" are fixed phrases from the key that
//   an ordinary sentence never needs, and the assistant can still say a document is out of date.
//
//   *Two of the four band names are filtered only in a band-shaped sentence.* `novice` and
//   `proficient` have no other use here. `developing` and `professional` do — "the developing
//   picture", "a professional operation" — so they are replaced only when a scoring word sits beside
//   them, which is what makes "you would place at professional on framing" a leak and "a
//   professional roastery" a sentence.
//
// The filter reads the model's prose and nothing else. A claim segment is authored package text
// placed by a marker: it is the one thing in the reply a student may treat as evidence, and editing
// it would change a claim object between the author who wrote it and the student who stances it.
// That is not a rule this file follows carefully — it is a shape `segments.ts` gives the input, so
// that a claim's text cannot arrive here as prose (D-264). An imported package (FR-186) is ordinary
// business writing, and "the defect rate fell to 2.1 percent" is a sentence a scenario may contain.
//
// WHAT THE MATCH TOLERATES, AND WHAT IT DELIBERATELY DOES NOT (D-427)
//
// A filter that only matched the exact ASCII spelling would be a filter an injected instruction can
// step around: `dеfective` with a Cyrillic е, `defe<ZWSP>ctive` and `de-fective` all read as the
// word on the screen and none of them is the string on the list. So every candidate is matched
// against a *normalised* copy of the text — compatibility-decomposed, combining marks and
// zero-width/format characters removed, confusable Cyrillic and Greek letters folded to Latin,
// lower-cased — and the offsets are mapped back so the redaction lands on the original bytes.
// Inside a word, any run of `_ . -` (and the Unicode dashes) is noise the match steps over.
//
// A single *space* inside a word is not, and that is a decision rather than an oversight: `planted`
// with a space is `plan ted`, and "the plan Ted proposed" is a sentence; `novice` with a space is
// `no vice`. Tolerating a space inside a word buys `de fective` and costs ordinary sentences, which
// is the trade this file's own test refuses to make everywhere else.
import type { GuardSegment } from '@/server/llm/guardrails/segments'

/** §3: what a match is replaced with. */
export const DEFECT_REDACTION = '[…]'

/** §3: the flag added to `run_delegations.flags` and the `delegation` event when this fires. */
export const DELEGATION_FILTERED_FLAG = 'filtered'

export type DefectWordMatch = {
  /** The matched text, lower-cased. */
  term: string
  /** Surrounding prose, for the server log; never stored on the delegation and never shown. */
  context: string
}

export type DefectWordResult = {
  /** The segments with every match replaced; claim segments untouched. */
  segments: GuardSegment[]
  matches: DefectWordMatch[]
  /** True when at least one match was replaced — the delegation is flagged `filtered`. */
  filtered: boolean
}

/**
 * Terms with no legitimate use in this room, in the spellings the key uses. A space in a term
 * matches any run of spaces, underscores or hyphens, so `stale evidence`, `stale_evidence` and
 * `stale-evidence` are one term — the slug and the prose form of a failure family are the same leak.
 */
const ANSWER_KEY_TERMS: readonly string[] = [
  // §3, named there
  'defect',
  'defects',
  'defective',
  'defectiveness',
  'planted',
  'sound claim',
  'sound claims',
  'claim is sound',
  'claims are sound',
  'unsound',
  // The key's own vocabulary
  'evidence status',
  'evidence statuses',
  'failure family',
  'failure families',
  'warranted stance',
  'warranted stances',
  'answer key',
  // The failure families of PRD §7.5 that are phrases rather than ordinary words
  'near neighbor',
  'near neighbour',
  'unstated assumption',
  'unstated assumptions',
  'stale evidence',
  'uncomputed number',
  'uncomputed numbers',
  'reversal to agree',
  'omitted alternative',
  'omitted alternatives',
  'misapplied method',
  'misapplied methods',
  'misattributed source',
  'misattributed sources',
  'unacceptable route',
  'unacceptable routes',
]

/** Band names with no other use in a business scenario. */
const BAND_TERMS: readonly string[] = ['novice', 'proficient']

/** Band names that are ordinary English, replaced only inside a band-shaped sentence. */
const CONTEXTUAL_BAND_TERMS: readonly string[] = ['developing', 'professional']

/** What makes a sentence band-shaped: the rubric's own furniture, plus its seven dimensions. */
const BAND_CONTEXT_TERMS: readonly string[] = [
  'band',
  'bands',
  'rubric',
  'rubrics',
  'score',
  'scores',
  'scored',
  'scoring',
  'grade',
  'grades',
  'graded',
  'grading',
  'rating',
  'rated',
  'level',
  'levels',
  'assess',
  'assessed',
  'assessing',
  'assessment',
  'evaluate',
  'evaluated',
  'evaluation',
  'dimension',
  'dimensions',
  'placement',
  // The two unconditional band names, so a list of all four is caught by its ends. The two
  // conditional ones are deliberately absent: with them in, "a professional roastery in a developing
  // market" is two ordinary words each turning the other into a band.
  'novice',
  'proficient',
  'framing',
  'delegation',
  'verification',
  'calibration',
  'adaptation',
  'ownership',
  'decision quality',
]

/** How far either side of a band name a scoring word turns it into a band (characters). */
const BAND_CONTEXT_RADIUS = 40

/** How much prose is kept around a match in the log line. */
const CONTEXT_RADIUS = 60

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Characters that never separate two words in English prose, so a run of them inside one word is
 * noise a match steps over: the underscore and full stop of a slug, and every dash Unicode has.
 * Whitespace is deliberately absent — see the header note.
 */
const INTRA_WORD = '[_.\\u2010-\\u2015\\-]*'

/**
 * Between two words of a term: the same noise, plus whitespace, and *optional* — the zero-width
 * space in `evidence<ZWSP>status` is gone by the time the match runs, so the two words are adjacent
 * and a separator the pattern requires would be a separator the evasion removed.
 */
const INTER_WORD = '[\\s_.\\u2010-\\u2015\\-]*'

/** One word of a term, with the noise class between every pair of its characters. */
const wordPattern = (word: string): string => [...word].map(escapeRegExp).join(INTRA_WORD)

/**
 * One alternation, longest term first so `defective` is not consumed by `defect` (the word boundary
 * would reject that anyway, but ordering makes it true rather than incidental).
 */
const alternation = (terms: readonly string[]): string =>
  [...terms]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.split(' ').map(wordPattern).join(INTER_WORD))
    .join('|')

const pattern = (terms: readonly string[], flags = 'gi'): RegExp =>
  new RegExp(`\\b(?:${alternation(terms)})\\b`, flags)

const ALWAYS = pattern([...ANSWER_KEY_TERMS, ...BAND_TERMS])
const CONTEXTUAL = pattern(CONTEXTUAL_BAND_TERMS)
// Not global: `test` on a global regex carries `lastIndex` from one call to the next, and this one
// is asked two questions about two different strings for every match.
const BAND_CONTEXT = pattern(BAND_CONTEXT_TERMS, 'i')

// ---------------------------------------------------------------------------------------------
// Normalising the haystack (D-427)
// ---------------------------------------------------------------------------------------------

/**
 * Letters from other alphabets that render as a Latin letter. Folding them is what makes `dеfective`
 * with a Cyrillic е the same string as `defective` for the purpose of the match; nothing else in the
 * pipeline reads the folded copy, so an ordinary reply in another script is unaffected on the way
 * to the student — only the offsets the filter redacts at are taken from it.
 */
const CONFUSABLES = new Map<string, string>(
  Object.entries({
    // Cyrillic
    а: 'a',
    б: 'b',
    в: 'b',
    г: 'r',
    ԁ: 'd',
    е: 'e',
    ѕ: 's',
    і: 'i',
    ї: 'i',
    ј: 'j',
    к: 'k',
    м: 'm',
    н: 'h',
    о: 'o',
    р: 'p',
    с: 'c',
    т: 't',
    у: 'y',
    х: 'x',
    ц: 'u',
    ѵ: 'v',
    ѡ: 'w',
    // Greek
    α: 'a',
    β: 'b',
    γ: 'y',
    ε: 'e',
    ζ: 'z',
    η: 'n',
    ι: 'i',
    κ: 'k',
    μ: 'm',
    ν: 'v',
    ο: 'o',
    ρ: 'p',
    σ: 'o',
    τ: 't',
    υ: 'u',
    φ: 'o',
    χ: 'x',
    ω: 'w',
    // Latin look-alikes that NFKD leaves alone
    ɑ: 'a',
    ɡ: 'g',
    ɩ: 'i',
    ɪ: 'i',
    ʏ: 'y',
    ʙ: 'b',
    ʜ: 'h',
    ʟ: 'l',
    ʀ: 'r',
  }),
)

/** Zero-width, directional and other invisible marks: unseen on the screen, unseen by the match. */
const INVISIBLE =
  /^[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]$/u

/**
 * The text as the match reads it, with an offset per normalised character back into the original.
 *
 * `offsets[i]` is where the character that produced `text[i]` starts in the source, and the array
 * carries one extra entry — `source.length` — so a match that runs to the end has an end offset
 * like every other. A source character that normalises to several characters (a ligature) maps all
 * of them to its own index, so a match landing inside one redacts the whole character.
 */
function normalize(source: string): { text: string; offsets: number[] } {
  const characters: string[] = []
  const offsets: number[] = []
  let at = 0
  for (const point of source) {
    const start = at
    at += point.length
    if (INVISIBLE.test(point)) continue
    const stripped = point.normalize('NFKD').replace(/\p{M}/gu, '')
    if (stripped === '') continue
    for (const character of stripped.toLowerCase()) {
      characters.push(CONFUSABLES.get(character) ?? character)
      offsets.push(start)
    }
  }
  offsets.push(source.length)
  return { text: characters.join(''), offsets }
}

const contextAround = (text: string, at: number, length: number): string => {
  const start = Math.max(0, at - CONTEXT_RADIUS)
  const end = Math.min(text.length, at + length + CONTEXT_RADIUS)
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${snippet}${end < text.length ? '…' : ''}`
}

/** True when a scoring word sits within `BAND_CONTEXT_RADIUS` characters of the match. */
function inBandContext(text: string, at: number, length: number): boolean {
  const before = text.slice(Math.max(0, at - BAND_CONTEXT_RADIUS), at)
  const after = text.slice(at + length, at + length + BAND_CONTEXT_RADIUS)
  return BAND_CONTEXT.test(before) || BAND_CONTEXT.test(after)
}

type Hit = { index: number; length: number; term: string }

/**
 * One match, in the source's own offsets. The end offset is where the *next* surviving character
 * begins, so anything the normalisation dropped inside the match — a zero-width space between two
 * letters — is inside the span that gets replaced rather than left behind beside the redaction.
 */
function hitIn(source: string, offsets: readonly number[], at: number, length: number): Hit {
  const start = offsets[at] ?? source.length
  const end = offsets[at + length] ?? source.length
  return { index: start, length: end - start, term: source.slice(start, end).toLowerCase() }
}

/**
 * Every match in one piece of text, matched on the normalised copy and reported in the source's
 * offsets (D-427). `terms` defaults to §3's own list; a caller with a second list of its own — the
 * band rationale of D-426 — passes one and gets the same matching rule.
 */
function hits(source: string, terms?: readonly string[]): Hit[] {
  const { text, offsets } = normalize(source)
  const found: Hit[] = []
  for (const match of text.matchAll(terms === undefined ? ALWAYS : patternFor(terms))) {
    found.push(hitIn(source, offsets, match.index, match[0].length))
  }
  if (terms === undefined) {
    for (const match of text.matchAll(CONTEXTUAL)) {
      if (inBandContext(text, match.index, match[0].length)) {
        found.push(hitIn(source, offsets, match.index, match[0].length))
      }
    }
  }
  // Two patterns walk the text separately, so reading order has to be restored; the lists cannot
  // overlap, because no contextual band name is a substring of an answer-key term.
  return found.sort((a, b) => a.index - b.index)
}

/** Compiled once per list: a caller's terms are a module constant, not a per-call string. */
const PATTERN_CACHE = new Map<string, RegExp>()
function patternFor(terms: readonly string[]): RegExp {
  const key = terms.join(' ')
  const cached = PATTERN_CACHE.get(key)
  if (cached) return cached
  const compiled = pattern(terms)
  PATTERN_CACHE.set(key, compiled)
  return compiled
}

/** Every match in one piece of text, in reading order. */
export const defectWordsIn = (text: string): DefectWordMatch[] =>
  hits(text).map((hit) => ({
    term: hit.term,
    context: contextAround(text, hit.index, hit.length),
  }))

/** The predicate the evals and the leak tests assert on a whole reply. */
export const containsDefectWord = (text: string): boolean => hits(text).length > 0

/** What `redactTerms` answers: the text with every match replaced, and what it replaced. */
export type TermRedaction = { text: string; matches: DefectWordMatch[] }

/**
 * The same replacement over a caller's own list of terms (D-426).
 *
 * §3's list is what the *assistant* may not say to a student mid-run. A band rationale is a second
 * string shown to a student, written by a different prompt, under a rule of its own — so the rule
 * lives with that caller and the machinery lives here, rather than the scoring module growing a
 * second, subtly different matcher.
 */
export function redactTerms(text: string, terms: readonly string[]): TermRedaction {
  const found = hits(text, terms)
  return {
    text: redact(text, found),
    matches: found.map((hit) => ({
      term: hit.term,
      context: contextAround(text, hit.index, hit.length),
    })),
  }
}

/** Replaces every match with `[…]`, right to left so earlier offsets stay valid. */
function redact(text: string, found: readonly Hit[]): string {
  let redacted = text
  for (const hit of [...found].reverse()) {
    redacted = `${redacted.slice(0, hit.index)}${DEFECT_REDACTION}${redacted.slice(hit.index + hit.length)}`
  }
  return redacted
}

/**
 * §3: replace the matches, tell the caller it fired.
 *
 * The caller adds `DELEGATION_FILTERED_FLAG` to the delegation's flags and stores the segments this
 * returns — never the originals. Claim segments pass through untouched.
 */
export function defectWordFilter(segments: readonly GuardSegment[]): DefectWordResult {
  const matches: DefectWordMatch[] = []

  const filteredSegments = segments.map((segment): GuardSegment => {
    if (segment.type !== 'text') return segment
    const found = hits(segment.text)
    if (found.length === 0) return segment
    for (const hit of found) {
      matches.push({ term: hit.term, context: contextAround(segment.text, hit.index, hit.length) })
    }
    return { type: 'text', text: redact(segment.text, found) }
  })

  return { segments: filteredSegments, matches, filtered: matches.length > 0 }
}
