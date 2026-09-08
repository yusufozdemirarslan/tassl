// The mock's assistant reply (docs/tech/11-llm-integration.md §1.4, the `assistant-reply` row).
//
// The shape §1.4 fixes: one connective sentence per surfaced claim from a fixed template set chosen
// by `hash(request) % templates.length`, the claim texts verbatim between `[[claim:<id>]]` markers,
// and a closing sentence. §1.4's "request" is read as the rendered call — the messages a real
// provider would have been sent — and never as the caller's input object (D-265).
//
// Three properties every sentence in this file is written to keep, because the mock is the assistant
// the walkthrough and the evals meet:
//
//   *No digits.* §1.4 requires the mock never to emit a number that is not in the claims or the
//   request. Claim text is copied verbatim, so the only place a stray figure could enter is the
//   connective prose — and the cheapest way to guarantee it never does is for the templates to
//   contain no digit at all. `tests/unit/llm/mock.test.ts` pins that.
//
//   *No defect status.* FR-056 and the product invariant: the assistant never tells a student
//   whether a claim is sound. Nothing here hedges on one claim and not another, praises one, or
//   warns about one — the connective sentences are interchangeable by construction, so which claim
//   a student got a warm sentence for carries no information.
//
//   *An invitation to check.* The closing sentences point at the Evidence Room and the interrogation
//   actions, which is the one thing the assistant may always say, and say about everything equally.
import { z } from 'zod'
import { matchTriggerPhrases } from '@/lib/trigger-match'
import { rotate } from '@/server/llm/providers/mock/deterministic'

/**
 * What the mock reads out of `assistant-reply@5`'s input (§2.1). Every key the reply is built from
 * is named here and everything else is stripped, not ignored (D-266): the delegation service loads
 * claim rows that carry `evidenceStatus`, `failureFamily` and `planted` beside the id and the text,
 * and a claim object that still carried them into this file would put the answer key inside the
 * function that writes the student's reply. It cannot: `z.object` drops them at the boundary, and
 * the reply's wording is keyed by the rendered prompt rather than by this object anyway (D-265).
 */
export const AssistantReplyMockInput = z.object({
  worldSummary: z.string().default(''),
  openedDocuments: z
    .array(z.object({ title: z.string().default(''), excerpt: z.string().default('') }))
    .default([]),
  request: z.string().default(''),
  claims: z.array(z.object({ id: z.string().min(1), text: z.string() })).default([]),
  turnContext: z.string().nullish(),
})
export type AssistantReplyMockInput = z.infer<typeof AssistantReplyMockInput>

/** The marker §2.1 fixes: exactly one per surfaced claim, and the claim text follows it. */
export const claimMarker = (claimId: string): string => `[[claim:${claimId}]]`

export const CLAIM_MARKER_PATTERN = /\[\[claim:([^\]]+)\]\]/g

/** One per surfaced claim, rotated so a reply with several claims does not repeat itself. */
export const LEAD_INS: readonly string[] = [
  'Here is what the room already says on that.',
  'The material in front of you speaks to this directly.',
  'One thing on file bears on it.',
  'This is what the evidence states.',
  'There is a stated position on that.',
  'The documents you have carry this.',
  'Something in the room addresses it.',
  'Here is the relevant line from the material.',
]

export const CLOSINGS: readonly string[] = [
  'You can open the underlying document or run a check on any of these before you rely on them.',
  'Treat each of these as something to test rather than something settled.',
  'If you want the provenance of any of them, the interrogation actions are there.',
  'What you do with these is your call; the sources are in the Evidence Room.',
]

/** Added, without naming the Turn's content, when the request arrives inside the Turn window. */
export const TURN_NOTE =
  'The message that just arrived does not change what these documents say; it changes what you have to do about them.'

/**
 * What the mock answers when nothing matched. Not a refusal — a refusal is the content-policy path
 * of §3, which the service phrases — but the honest answer of an assistant that has been handed no
 * claim objects: it says so and says what would help, with no digits and no hint about the room's
 * contents beyond what a student can already see.
 */
export const NO_CLAIM_REPLIES: readonly string[] = [
  'I cannot find anything in the room that answers that directly. Name the figure or the decision you are testing and I will quote what the documents actually say.',
  'Nothing in the material speaks to that in the terms you used. Try naming a document, a stakeholder, or the number you are trying to justify.',
  'I have nothing on file for that request. The Evidence Room is where the answer would be, and I can read from it if you tell me what you need.',
  'That is outside what this room covers. Ask me about the figures or the positions the documents state and I will answer from those.',
]

/**
 * The reply, assembled from the claims the service matched.
 *
 * The claim text is copied character for character. It is authored package content and the one thing
 * in the reply a student is allowed to treat as evidence, so paraphrasing it — even to fix its
 * punctuation — would put words the author never wrote into a claim object the student then stances.
 */
export function buildAssistantReply(input: AssistantReplyMockInput, seed: number): string {
  if (input.claims.length === 0) return rotate(NO_CLAIM_REPLIES, seed)

  const paragraphs = input.claims.map((claim, index) => {
    const text = claim.text.trim()
    return `${rotate(LEAD_INS, seed, index)} ${claimMarker(claim.id)} ${text}`
  })

  const turnContext = input.turnContext ?? ''
  if (turnContext.trim() !== '') paragraphs.push(TURN_NOTE)
  // A different three bits of the seed than the lead-in used. `CLOSINGS.length` divides
  // `LEAD_INS.length`, so `rotate(CLOSINGS, seed)` was a function of `seed % 8` and the whole reply
  // had eight possible forms — two different questions collided on all of it one time in eight,
  // which is what a prompt edit in step 14.4 turned red in `mock.test.ts`. Shifting gives the two
  // choices independent bits and thirty-two forms (D-665).
  paragraphs.push(rotate(CLOSINGS, seed >>> 3))

  return paragraphs.join('\n\n')
}

// ---------------------------------------------------------------------------------------------
// `trigger-classify@1` (AI-004)
// ---------------------------------------------------------------------------------------------

/**
 * What the mock reads out of `trigger-classify@1`'s input (§2.1).
 *
 * §2.1 gives a candidate a `description`; `triggerPhrases` is carried as well, because §1.4 requires
 * the mock to return *the deterministic matcher's result* and the phrases are what that matcher
 * matches on (10 §7). The `description` is read by a real model and ignored here, for the same
 * reason: a description the mock also matched on would raise claims the deterministic pass does not,
 * and `TRIGGER_MATCHING=llm_first` would then change outcomes rather than the path (D-263).
 */
export const TriggerClassifyMockInput = z.object({
  request: z.string().default(''),
  candidates: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().default(''),
        triggerPhrases: z.array(z.string()).default([]),
      }),
    )
    .default([]),
})
export type TriggerClassifyMockInput = z.infer<typeof TriggerClassifyMockInput>

/**
 * §1.4: the deterministic matcher's result for the same request.
 *
 * Literally it — `src/server/llm` may not import a module, but both this file and
 * `assistant/triggers.ts` may reach `src/lib`, so there is one implementation of D-030 and no second
 * copy free to be more generous than the first (D-263).
 */
export const classifyTriggers = (input: TriggerClassifyMockInput): string[] =>
  matchTriggerPhrases(input.request, input.candidates)

/**
 * The stream the mock yields: paragraph by paragraph, with the marker starting its own chunk.
 *
 * The split is deliberate rather than cosmetic. The workspace renders a claim card where a marker
 * appears (Step 7.4), so a chunk boundary at each marker is what lets the panel show the connective
 * sentence, then the card, then the next sentence, in the order the reply was written — the same
 * order a streaming model would produce them in.
 */
export function chunkForStream(text: string): string[] {
  const chunks: string[] = []
  let cursor = 0
  for (const match of text.matchAll(CLAIM_MARKER_PATTERN)) {
    if (match.index > cursor) chunks.push(text.slice(cursor, match.index))
    chunks.push(match[0])
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) chunks.push(text.slice(cursor))
  return chunks.filter((chunk) => chunk !== '')
}
