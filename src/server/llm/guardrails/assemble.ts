// The reply assembler (docs/tech/11-llm-integration.md §3; FR-051, FR-052, FR-056).
//
// It sits between what a provider said and what a student is handed, and it is the last place the
// product's promises about a delegation are still enforceable: every surfaced claim reaches the
// screen as a stanceable card whatever the model did with its markers, every figure with no source
// is marked, and no word of the answer key survives in the model's own prose.
//
// **Why it lives beside the guards rather than in `assistant/service.ts`** (D-673). It is a pure
// function of three strings-and-sets — no database, no run, no session — and it composes the three
// guardrail files in this directory and nothing else. Keeping it here lets `evals/assistant` assert
// the property that actually matters, which is not what the model wrote but what the student is
// handed: `assistant/service.ts` reaches `@/server/analytics/track`, which imports `server-only`
// and therefore throws under the `tsx` the eval runner is, so an eval that wanted this function had
// to re-implement the rebuild — a second copy of the rule that decides whether a claim reaches a
// student. `authoring/checks.ts` was split out for exactly this reason (10 §5).
import { t } from '@/lib/i18n/t'
import { getLogger } from '@/server/http/request-context'
import { DELEGATION_FILTERED_FLAG, defectWordFilter } from '@/server/llm/guardrails/defect-words'
import { numericGuard, type UnverifiedNumber } from '@/server/llm/guardrails/numeric-guard'
import {
  proseOf,
  renderSegments,
  segmentReply,
  type GuardSegment,
} from '@/server/llm/guardrails/segments'

/** 11 §3: the delegation flags the guards raise. `out_of_scenario` is a reviewer's (FR-055). */
export const DELEGATION_NO_COMMENTARY_FLAG = 'no_commentary'
export const DELEGATION_REBUILT_FLAG = 'rebuilt'

/** The paragraph break between two segments the assembler put next to each other. */
const SEPARATOR = '\n\n'

export const separator = (): GuardSegment => ({ type: 'text', text: SEPARATOR })

export type AuthoredClaim = { id: string; key: string; text: string }

export type AssembledReply = {
  segments: GuardSegment[]
  responseText: string
  flags: string[]
  unverified: UnverifiedNumber[]
}

/**
 * Turns a model reply into what is stored and shown (11 §3), in the order §3 fixes: segment, check
 * the markers, guard the numbers, filter the prose.
 *
 * **The marker check comes first**, because everything after it depends on the cut being right.
 * §3 requires each surfaced claim to be marked exactly once; a reply that does not is rebuilt as
 * "claims first, text after" and flagged `rebuilt`. That is not cosmetic — a claim the model forgot
 * to mark is a claim the student was told about and cannot stance, and a claim marked twice is one
 * card too many. Rebuilding keeps the claim objects intact and demotes the model's prose to what it
 * always was: connective text that carries no stance and is never scored (FR-051).
 *
 * It is also what makes a prompt injection unable to take a claim off the screen (D-672). A
 * document that tells the assistant to describe a claim some particular way — or an "answer key"
 * that tells it to say the claim is defective — can make the model drop the claim from its reply,
 * and one did; it cannot make the claim not surface, because the trigger matcher chose the set
 * before the model saw anything (D-030), and it cannot keep the claim off the screen, because this
 * rebuild puts it back verbatim. The delegation carries `rebuilt`, which is what the reviewer needs
 * to know it happened.
 *
 * **Both guards read text segments only.** A claim segment carries the author's own words (D-264),
 * so the numeric guard cannot flag a figure the author sourced and the filter cannot redact a word
 * the author chose — a package imported from another institution (FR-186) may legitimately say "the
 * defect rate fell to 2.1 percent". It is also what keeps a marker out of authored text: the guard
 * never scans the package's own words, so it can never wrap them.
 *
 * **The numeric guard rewrites the prose in both of its modes** (D-068, D-281). `flag` leaves the
 * figure and puts `[[figure:…]]` round it; `block` leaves the marker and takes the figure out. Either
 * way the mark is in what `renderSegments` returns, so it reaches the student through the stream and
 * the faculty seat through `response_text` and the `delegation` event — one reply, read three times.
 * The `unverified` list beside it is the reviewer's audit of the same figures (D-269).
 *
 * **A reply with no prose left gets 11 §3's content-policy sentence.** A provider that refused, that
 * answered nothing, or whose whole answer was markers leaves the claims on screen with one sentence
 * saying the assistant could not add commentary — never an apology that characterises the request,
 * which would be the assistant commenting on what it was asked (FR-056).
 */
export function assembleReply(
  reply: string,
  claims: readonly AuthoredClaim[],
  allowed: ReadonlySet<string>,
): AssembledReply {
  const flags: string[] = []
  const authored = claims.map((claim) => ({ id: claim.id, text: claim.text }))

  let segments = segmentReply(reply, authored)
  const marked = segments
    .filter((segment) => segment.type === 'claim')
    .map((segment) => segment.claimId)
  if (marked.join(',') !== authored.map((claim) => claim.id).join(',')) {
    const prose = segments.filter((segment) => segment.type === 'text')
    segments = [
      ...authored.flatMap((claim, index): GuardSegment[] => [
        ...(index === 0 ? [] : [separator()]),
        { type: 'claim', claimId: claim.id, text: claim.text },
      ]),
      ...(prose.length === 0 ? [] : [separator(), ...prose]),
    ]
    flags.push(DELEGATION_REBUILT_FLAG)
  }

  const guarded = numericGuard(segments, allowed)
  const filtered = defectWordFilter(guarded.segments)
  if (filtered.filtered) {
    flags.push(DELEGATION_FILTERED_FLAG)
    getLogger().warn(
      { terms: filtered.matches.map((match) => match.term) },
      'assistant reply carried answer-key vocabulary and was redacted',
    )
  }

  let final = filtered.segments
  if (proseOf(final).join('').trim() === '') {
    final = [{ type: 'text', text: t('workspace.assistantNoCommentary') }, ...final]
    flags.push(DELEGATION_NO_COMMENTARY_FLAG)
  }

  return {
    segments: final,
    responseText: renderSegments(final),
    flags,
    unverified: guarded.unverified,
  }
}
