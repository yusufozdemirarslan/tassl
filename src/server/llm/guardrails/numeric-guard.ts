// The numeric guard (docs/tech/11-llm-integration.md §3, AI-002, D-068).
//
// FR-052: the assistant may not introduce a consequential claim of its own. The sharpest form of
// that is a number — a payback, a margin, a retention rate — asserted in connective prose where no
// claim object and no document put one. A student reading it has no source to interrogate, and a
// figure with no provenance is exactly what the run is meant to teach them to catch.
//
// So every number in the assistant's own text is checked against the numbers it was allowed to see:
// the surfaced claim texts, their carried values, the request the student typed, and the documents
// the student has opened. In `flag` mode (the default) an unsupported number stays on screen with a
// marker, and the delegation event records it — which is the honest behaviour, because the student's
// job is to notice, and because over-blocking would break the assistant's ability to quote. In
// `block` mode the figure itself is taken out and only the marker is left.
//
// THE MARKER IS IN THE PROSE, NOT BESIDE IT (D-281)
//
// D-068 asks for two different things about one flagged figure, addressed to two different readers:
// the delegation event records it for the faculty seat, *and* it is "rendered with a subtle marker"
// for the student. The first is `unverified`, which travels as structured data and is reviewer-only
// (D-269). The second cannot travel that way — a student's `DelegationView` carries no
// `unverifiedNumbers` list and their trace payload gates the same field `after_scored` — so the
// marker travels where the reply itself travels: inside the text, in the shape `[[claim:<id>]]`
// already uses. `renderSegments` keeps it in `response_text`, so the Delegation Log and the replay
// show the reply the student saw rather than a cleaner one.
//
// Marking a figure is not a hint about defect status (FR-056). It says where a number came from,
// never whether it is right, and a defective claim's figures are *sourced* — they are in the claim's
// own text, which no guard reads (`segments.ts`) — so the marker cannot tell a defective claim from
// a sound one. What it does say is the thing FR-025 makes the student answerable for: a figure that
// matches no claim and no document is the assistant's assumption, and defending it is theirs.
//
// "Same number" is a question about value, not spelling: `1,200`, `1200`, `$1,200`, `1200.00` and
// `1200%` all normalise to `1200`. Currency symbols and percent signs are not part of the number,
// because a source that says "eleven percent" and a reply that says "11 percent" are the same
// assertion, and a guard that disagreed would flag every quotation.
import { env } from '@/server/config'
import type { GuardSegment } from '@/server/llm/guardrails/segments'

export type NumericGuardMode = 'flag' | 'block'

/** One flagged number, in the shape `delegation.unverified_numbers` carries (trace schema §10). */
export type UnverifiedNumber = { value: string; context: string }

export type NumericGuardResult = {
  /** The segments as they should be shown: unchanged in `flag` mode, rewritten in `block` mode. */
  segments: GuardSegment[]
  unverified: UnverifiedNumber[]
  mode: NumericGuardMode
}

/**
 * The marker an unsourced figure is wrapped in, in the shape `assistant-reply@1` fixes for a claim.
 *
 * The payload is the figure exactly as the model spelled it, so `1,200` stays `1,200` and the
 * sentence reads as it was written. An **empty** payload is `block` mode: the digits are gone from
 * the reply, and the workspace draws the withheld label in their place. The one word of display copy
 * therefore stays in `en-US.ts` where every UI string lives, and this file writes no English at all.
 */
export const figureMarker = (figure: string): string => `[[figure:${figure}]]`

/**
 * Global, so `matchAll` and `String.split` walk every marker; `[^\]]` keeps one marker from spanning
 * two; `*` rather than `+` because `block` mode's payload is empty. Restated in
 * `assistant-panel.tsx`, which cannot import from `src/server` (the `boundaries` policy).
 */
export const FIGURE_MARKER_PATTERN = /\[\[figure:([^\]]*)\]\]/g

/** How much prose is kept around a flagged number so the replay reads as a sentence. */
const CONTEXT_RADIUS = 60

/**
 * A number as it appears in prose: an optional grouped integer part and an optional decimal part.
 * The grouped alternative comes first so `1,200` matches whole rather than as `1` then `200`.
 */
const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g

/**
 * The canonical form two spellings of the same number share.
 *
 * Done on the string, not through `Number`: a float round-trip turns `0.1` into `0.1` but would also
 * turn a sixteen-digit id into exponent notation, and the guard compares identity, not magnitude.
 * Grouping commas go, leading zeros go (`02` → `2`), trailing zeros in the fraction go (`16.00` →
 * `16`), and an empty integer part becomes `0` (`.5` → `0.5`).
 */
export function normalizeNumber(raw: string): string {
  const [integerPart = '', fractionPart = ''] = raw.replace(/,/g, '').split('.')
  const integer = integerPart.replace(/^0+(?=\d)/, '') || '0'
  const fraction = fractionPart.replace(/0+$/, '')
  return fraction === '' ? integer : `${integer}.${fraction}`
}

/** Every number the text contains, normalised, in reading order (duplicates kept). */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(NUMBER)].map((match) => normalizeNumber(match[0]))
}

/**
 * The allowed set: every number in the texts the assistant was given, plus the exact values the
 * matched claims carry (`scenario_claims.carried_values`, which the claim text may round).
 */
export function allowedNumbers(
  texts: Iterable<string>,
  values: Iterable<number> = [],
): Set<string> {
  const allowed = new Set<string>()
  for (const text of texts) for (const number of numbersIn(text)) allowed.add(number)
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    // The sign is dropped: the extractor never captures one, because a leading `-` in prose is far
    // more often a dash than a minus. Exponent spellings are dropped too — nothing writes `1e+21`
    // in a claim, and `normalizeNumber` would read it as a number it is not.
    const magnitude = Math.abs(value)
    for (const spelling of [String(magnitude), magnitude.toFixed(6)]) {
      if (/^\d+(?:\.\d+)?$/.test(spelling)) allowed.add(normalizeNumber(spelling))
    }
  }
  return allowed
}

const contextAround = (text: string, at: number, length: number): string => {
  const start = Math.max(0, at - CONTEXT_RADIUS)
  const end = Math.min(text.length, at + length + CONTEXT_RADIUS)
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${snippet}${end < text.length ? '…' : ''}`
}

/**
 * Checks the model's prose against the allowed set (§3, D-068, D-281).
 *
 * Claim segments are skipped: they carry authored package text placed by a marker (`segments.ts`),
 * which is the one thing in the reply the assistant is allowed to quote, figures and all. That is
 * also what keeps a marker out of authored text (D-264) — the package's own words are never scanned,
 * so nothing can be wrapped inside them.
 *
 * **Both modes mark; they differ in what is left inside the marker.** `flag` keeps the figure and
 * puts a marker round it, so the student reads the sentence the assistant wrote and can see which
 * number in it came from nowhere. `block` keeps the marker and drops the figure. The whole numeric
 * literal goes, not just the unsupported digits, so the sentence never reads as a different figure
 * than the one that was withheld. Replacement runs right to left so earlier offsets stay valid, and
 * the flagged list is returned in reading order.
 *
 * **A marker the model wrote itself is taken apart first.** `[[figure:` is four characters any
 * provider can emit — quoting a document, echoing an earlier reply — and a reply that arrived
 * carrying one would either nest markers or hand a student a mark this guard never made. Unwrapping
 * it to its own contents leaves the number in the prose, where it is checked like any other, so
 * every marker in a stored reply is this function's.
 */
export function numericGuard(
  segments: readonly GuardSegment[],
  allowed: ReadonlySet<string>,
  mode: NumericGuardMode = env.ASSISTANT_NUMERIC_GUARD,
): NumericGuardResult {
  const unverified: UnverifiedNumber[] = []

  const guarded = segments.map((segment): GuardSegment => {
    if (segment.type !== 'text') return segment

    const prose = segment.text.replace(FIGURE_MARKER_PATTERN, '$1')
    const offenders = [...prose.matchAll(NUMBER)].filter(
      (match) => !allowed.has(normalizeNumber(match[0])),
    )
    if (offenders.length === 0) {
      return prose === segment.text ? segment : { type: 'text', text: prose }
    }

    for (const match of offenders) {
      unverified.push({
        value: normalizeNumber(match[0]),
        context: contextAround(prose, match.index, match[0].length),
      })
    }

    let text = prose
    for (const match of [...offenders].reverse()) {
      const marked = figureMarker(mode === 'block' ? '' : match[0])
      text = `${text.slice(0, match.index)}${marked}${text.slice(match.index + match[0].length)}`
    }
    return { type: 'text', text }
  })

  return { segments: guarded, unverified, mode }
}
