// Sentence counting for the one rule that needs it: `COUNTERFACTUAL_SENTENCES`, "the debrief
// counterfactual has exactly 3 sentences" (docs/tech/10-backend-spec-modules.md §4, 06 §3.3, PRD
// §7.14). The confirmation workspace shows the same count while an author types, which is why this
// lives in `src/lib` beside `countWords` and imports nothing.
//
// Counting sentences exactly is not decidable from punctuation alone, so this is a heuristic and is
// documented as one. It is tuned for the English business prose a counterfactual is written in, and
// it is deliberately conservative: it would rather join two sentences than invent a boundary inside
// "0.5 pts" or "e.g.", because the rule it feeds refuses a package until the author agrees with it.

/**
 * A run of terminal punctuation with any closing quote or bracket, standing at the end of a word.
 * The lookahead is what makes "0.5" safe: the dot inside a decimal is followed by a digit, so it is
 * never a candidate in the first place.
 */
const CANDIDATE = /[.!?…]+["'’”»)\]]*(?=\s|$)/g

/** The word a candidate sits on, dots included, so "e.g" and "U.S" arrive whole. */
const PRECEDING_WORD = /([\p{L}\p{N}][\p{L}\p{N}.]*)$/u

/** A single letter before the dot is an initial ("J. R. R. Tolkien"), never a sentence end. */
const INITIAL = /^\p{L}$/u

/** What the next sentence may open with: a capital, a digit, or an opening quote or bracket. */
const OPENS_A_SENTENCE = /^["'‘“«(\[]*[\p{Lu}\p{N}]/u

/** Anything a reader would call text, used to decide whether a trailing fragment is a sentence. */
const HAS_CONTENT = /[\p{L}\p{N}]/u

/**
 * Abbreviations whose dot is part of the word. The list is fixed and English: an abbreviation that
 * is not on it, followed by a capitalized word, is counted as a sentence end. "no." and "max." are
 * left off on purpose — a sentence ending in those words is likelier here than the abbreviation.
 */
const ABBREVIATIONS = new Set([
  'e.g',
  'i.e',
  'etc',
  'vs',
  'cf',
  'al',
  'viz',
  'approx',
  'est',
  'fig',
  'dept',
  'inc',
  'ltd',
  'co',
  'corp',
  'univ',
  'dr',
  'mr',
  'mrs',
  'ms',
  'prof',
  'sr',
  'jr',
  'st',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
  'a.m',
  'p.m',
  'u.s',
  'u.k',
  'e.u',
])

/** A list number or a roman numeral: "1", "12", "iv", "A" — numbering when it opens a line. */
const LIST_MARKER = /^(?:\d{1,3}|[ivxlcdm]{1,6}|[A-Za-z])$/i

/**
 * True when the marker just matched opens an item rather than sitting inside a sentence: it is the
 * first thing in the text, the first thing on its line, or the first thing after the sentence
 * before it. That last case is what lets a one-line list ("1. … 2. … 3. …") read as three items,
 * while a figure inside prose ("the deck lists 3. That figure is stale.") stays an ordinary end.
 */
function opensAnItem(before: string): boolean {
  const marker = PRECEDING_WORD.exec(before)?.[1] ?? ''
  const head = before.slice(0, before.length - marker.length)
  return head === '' || OPENS_AN_ITEM.test(head)
}

/** Start of text, start of a line, or straight after a sentence terminator and its space. */
const OPENS_AN_ITEM = /(?:^|[\r\n]|[.!?\u2026]["')\]]*\s)[ \t]*$/

/** A candidate is a real boundary unless the word before it, or the text after it, says otherwise. */
function endsASentence(before: string, after: string): boolean {
  const word = PRECEDING_WORD.exec(before)?.[1]
  if (word !== undefined) {
    if (ABBREVIATIONS.has(word.toLowerCase())) return false
    if (INITIAL.test(word)) return false
    // "1." and "iii." at the head of a line are numbering, not the end of a sentence. Without this
    // an author who writes a three-part counterfactual as a numbered list is counted at six and
    // told the text does not have three sentences, which is not something they can act on.
    if (LIST_MARKER.test(word) && opensAnItem(before)) return false
  }

  // The last terminator in the text closes the last sentence; there is nothing after it to judge.
  if (after === '') return true

  return OPENS_A_SENTENCE.test(after)
}

/**
 * How many sentences the text contains.
 *
 * The heuristic: a sentence ends at `.`, `!`, `?` or `…` (with any closing quote) that is followed
 * by whitespace or the end of the text, unless the word before it is a known abbreviation or a
 * single-letter initial, or the text after it does not open like a new sentence. Text after the
 * last boundary counts as one more sentence, so "One. Two. Three" is three, not two.
 *
 * Its limits, stated plainly:
 * - Punctuation is required. Three lines with no full stops are one sentence, not three.
 * - A sentence that begins with a lowercase word ("iPhone sales fell.") is joined to the one before
 *   it, because that test is what keeps unlisted abbreviations from splitting a sentence.
 * - An abbreviation outside `ABBREVIATIONS` followed by a capital ("Blvd. Sales rose") over-counts.
 * - Semicolons, colons, and dashes never split, however long the clause.
 * - A terminator with no space after it does not split: "Payback slips.Churn rises." is one
 *   sentence, because the space is the only signal that separates it from a decimal or a filename.
 * - Numbering at the head of a line ("1.", "iii.") is not a boundary, so a numbered list of three
 *   points counts as three sentences rather than six.
 * - It reads English. A language that does not mark sentences this way is counted as one sentence.
 *
 * Callers holding free text should pass it through `stripMarkup` from `./words` first; this
 * function only trims, so that the count is not thrown by a leading or trailing newline.
 */
export function countSentences(text: string): number {
  const prose = text.trim()
  if (prose === '') return 0

  let sentences = 0
  let lastBoundary = 0

  for (const match of prose.matchAll(CANDIDATE)) {
    const end = match.index + match[0].length
    if (!endsASentence(prose.slice(0, match.index), prose.slice(end).trimStart())) continue
    sentences += 1
    lastBoundary = end
  }

  // A final fragment with no terminator is still a sentence someone wrote.
  if (HAS_CONTENT.test(prose.slice(lastBoundary))) sentences += 1

  return sentences
}
