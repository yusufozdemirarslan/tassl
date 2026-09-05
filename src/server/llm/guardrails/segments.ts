// An assistant reply, cut into the parts the guards may touch and the parts they may not
// (docs/tech/11-llm-integration.md §3, FR-051, FR-052, FR-056, D-264).
//
// A reply is two kinds of writing interleaved. The connective sentences are the model's own: they
// carry no stance, they are never scored, and both guards read them. The claim texts are the
// author's: `assistant-reply@1` tells the model to copy each one "exactly as given, character for
// character" behind a `[[claim:<id>]]` marker, the workspace turns that marker into a card with a
// stance control, and the student stances the words in it. Editing those words would put text nobody
// authored into a claim object — the numeric guard would flag a figure the author sourced, and the
// defect-word filter would redact a word the author chose.
//
// That last one is not hypothetical, and it is why this file exists. A claim segment used to carry
// an id and no text, so the authored text — which follows its marker in the reply — landed in a
// `text` segment and was filtered like prose. A package imported from another institution (FR-186)
// is ordinary business writing: "the defect rate on the narrow-web line fell to 2.1 percent",
// "professional services revenue is rated stable", "inventory levels in the developing markets". All
// three came back redacted, with the delegation flagged `filtered`. The filter exists to stop the
// model naming a claim's evidence status, not to censor the package.
//
// So the claim's text is carried *in the claim segment*, and the guards' "claim segments pass
// through untouched" becomes a property of the data rather than a promise about a caller.
//
// HOW THE CUT IS MADE
//
// The segmenter is given the claims that were surfaced, and after a marker it consumes the following
// text only when it is that claim's authored text, verbatim. Nothing else becomes a claim segment.
// The alternative — treating everything after a marker as claim text, to the end of the paragraph —
// would need no claim list and would be a hole in the numeric guard: a model that appended a
// sentence of its own to a claim would have it carried through unread. A model that paraphrases a
// claim instead of copying it leaves prose here, which is guarded, and fails
// `claim_text_verbatim` in the evals — which is the signal we want, not a silent pass.
import { CLAIM_MARKER_PATTERN, claimMarker } from '@/server/llm/prompts/assistant-reply'

/**
 * A segment of an assistant reply.
 *
 * `text` is the model's own prose: guarded, and rewritten when a guard fires. `claim` is one
 * authored claim object placed by its marker: never read by a guard, never rewritten, and it carries
 * the author's text so that "never rewritten" has something to be true of.
 */
export type GuardSegment =
  { type: 'text'; text: string } | { type: 'claim'; claimId: string; text: string }

/** A surfaced claim, as the segmenter needs it: the marker's id and the text it must carry. */
export type SegmentClaim = { id: string; text: string }

/** The whitespace between a marker and the claim text the prompt asks to follow it. */
const leadingSpace = (text: string): number => text.length - text.trimStart().length

/**
 * Cut a reply into segments (§3).
 *
 * `claims` are the ones the trigger matcher surfaced — the same list `assistant-reply@1` was given.
 * A marker for an id that is not among them yields a claim segment with no text and consumes
 * nothing: an invented id must not be able to turn the model's next sentence into unguarded content.
 */
export function segmentReply(reply: string, claims: readonly SegmentClaim[]): GuardSegment[] {
  const authored = new Map(claims.map((claim) => [claim.id, claim.text]))
  const segments: GuardSegment[] = []
  let cursor = 0

  for (const match of reply.matchAll(CLAIM_MARKER_PATTERN)) {
    if (match.index > cursor) {
      segments.push({ type: 'text', text: reply.slice(cursor, match.index) })
    }
    const claimId = match[1] ?? ''
    cursor = match.index + match[0].length

    const text = authored.get(claimId) ?? ''
    const rest = reply.slice(cursor)
    const gap = leadingSpace(rest)
    if (text !== '' && rest.slice(gap).startsWith(text)) cursor += gap + text.length

    segments.push({ type: 'claim', claimId, text })
  }

  if (cursor < reply.length) segments.push({ type: 'text', text: reply.slice(cursor) })
  return segments
}

/** The model's own writing, which is all either guard ever reads. */
export const proseOf = (segments: readonly GuardSegment[]): string[] =>
  segments.filter((segment) => segment.type === 'text').map((segment) => segment.text)

/**
 * The reply as it is shown and stored, after the guards have run over it.
 *
 * A claim segment renders as its marker and the authored text, one space between them — the shape
 * `assistant-reply@1`'s example fixes and the mock emits, so a reply that went through the guards
 * unchanged comes back out unchanged. A model that separated the two with a newline has that
 * flattened to a space; §3 already contemplates rebuilding a reply whose markers do not line up.
 */
export const renderSegments = (segments: readonly GuardSegment[]): string =>
  segments
    .map((segment) =>
      segment.type === 'text' ? segment.text : `${claimMarker(segment.claimId)} ${segment.text}`,
    )
    .join('')
