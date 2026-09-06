// The mock's band readers (docs/tech/11-llm-integration.md §1.4, the `band-read-*` row; D-063).
//
// Five of the seven bands have an AI-assisted read (AI-003): Framing, Delegation, Decision Quality,
// Adaptation and Ownership. The other two — Verification and Calibration — are counted from the
// trace and never ask a model anything. On the mock, "the read" is the heuristic below: a small,
// stated, deterministic function of the same input the real prompt gets, returning the same
// `{ band, quotes, rationale }` shape the real prompt returns.
//
// What this is and is not. It is not a scoring rule: `scoring/reads.ts` (Phase 10) decides how much
// weight a read carries, and the categorical facts of a run outrank it everywhere the rubric says
// so. It is a stand-in that has to be *defensible in the direction it moves* — a frame with three
// substantive assumptions must not read below one with three empty ones, an unjustified reversal must
// not read above a held position with a reason — so that a walkthrough on the mock produces bands an
// instructor could recognise, and so the fixed placements of FR-139 are reachable without a key.
//
// Every threshold is a named constant with the reasoning next to it. Phase 10 tunes them against the
// eval suite; nothing outside this file reads them.
import { z } from 'zod'

export const MOCK_BANDS = ['novice', 'developing', 'proficient', 'professional'] as const
export type MockBand = (typeof MOCK_BANDS)[number]

export type BandQuote = { field: string; text: string }
export type BandRead = { band: MockBand; quotes: BandQuote[]; rationale: string }
export type DecisionQualityRead = BandRead & {
  matchedPositionKey: string | null
  ignoredEvidence?: string
}

/** The five prompts this file answers; anything else is not a band read. */
export const BAND_READ_PROMPTS = [
  'band-read-framing',
  'band-read-delegation',
  'band-read-decision-quality',
  'band-read-adaptation',
  'band-read-ownership',
] as const
export type BandReadPrompt = (typeof BAND_READ_PROMPTS)[number]

export const isBandReadPrompt = (name: string): name is BandReadPrompt =>
  (BAND_READ_PROMPTS as readonly string[]).includes(name)

// ---------------------------------------------------------------------------------------------
// Text helpers (local on purpose: `src/server/llm` may not import a module's internals)
// ---------------------------------------------------------------------------------------------

/**
 * Words that carry no topic. Overlap between two texts is meant to say "these are about the same
 * thing"; without a stop list every pair of English sentences overlaps on "the" and "of" and every
 * read lands in the same band.
 */
const STOP_WORDS = new Set([
  'a',
  'the',
  'and',
  'or',
  'but',
  'if',
  'then',
  'than',
  'that',
  'this',
  'these',
  'those',
  'of',
  'to',
  'in',
  'on',
  'at',
  'for',
  'with',
  'without',
  'from',
  'by',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'it',
  'its',
  'we',
  'i',
  'you',
  'they',
  'he',
  'she',
  'our',
  'their',
  'my',
  'your',
  'his',
  'her',
  'not',
  'no',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'will',
  'would',
  'should',
  'could',
  'can',
  'may',
  'might',
  'must',
  'so',
  'because',
  'about',
  'into',
  'over',
  'under',
  'more',
  'most',
  'less',
  'least',
  'very',
  'just',
  'also',
  'only',
  'any',
  'all',
  'some',
  'one',
  'two',
  'there',
  'here',
  'what',
  'which',
  'who',
  'whom',
  'when',
  'where',
  'how',
  'why',
  'while',
  'after',
  'before',
  'up',
  'down',
  'out',
])

export function tokens(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
}

export const contentWords = (text: string): Set<string> => new Set(tokens(text))

/** How many distinct content words two texts share. */
export function overlap(left: string, right: string): number {
  const rightWords = contentWords(right)
  let shared = 0
  for (const word of contentWords(left)) if (rightWords.has(word)) shared += 1
  return shared
}

export const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length

/** The first sentence, for the `quotes` field; never more than a readable line of it. */
export function firstSentence(text: string, max = 240): string {
  const prose = text.replace(/\s+/g, ' ').trim()
  if (prose === '') return ''
  const end = prose.search(/[.!?](?:\s|$)/)
  const sentence = end === -1 ? prose : prose.slice(0, end + 1)
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`
}

const REASON_MARKERS = /\b(because|since|therefore|so that|which is why|given that|as a result)\b/i
const DOCUMENT_WORDS =
  /\b(memo|deck|review|report|note|schedule|dashboard|minutes|brief|document|email|slide)\b/i
const DIGIT = /\d/

// ---------------------------------------------------------------------------------------------
// Inputs (§2.1)
//
// Every schema below names the keys its reader may look at and strips the rest (D-266). The prompt's
// own input is wider — the rubric descriptors, for one, which a heuristic cannot read — and that is
// fine; what matters is the other direction. A key the mock never declared cannot reach a band, so a
// caller assembling a read out of claim rows, with `evidenceStatus`, `failureFamily` and `planted`
// in its hand, cannot move a band with one by accident. `z.object` strips; `z.looseObject` would
// keep them, and `tests/unit/llm/mock.test.ts` fails on any input schema here that accepts a key it
// did not declare.
// ---------------------------------------------------------------------------------------------

const FrameInput = z.object({
  decision: z.string().default(''),
  assumptions: z.array(z.string()).default([]),
  position: z.string().default(''),
  confidence: z.number().nullish(),
})

export const FramingInput = z.object({
  frame: FrameInput.prefault({}),
  answerSpace: z.string().default(''),
  documentsRead: z.array(z.string()).default([]),
})

export const DelegationInput = z.object({
  delegations: z
    .array(
      z.object({
        request: z.string().default(''),
        why: z.string().nullish(),
        usedClaimCount: z.number().default(0),
      }),
    )
    .default([]),
  reasonForNotDelegating: z.string().nullish(),
  defenseAnswers: z.array(z.string()).default([]),
})

export const DecisionQualityInput = z.object({
  recommendation: z.string().default(''),
  rationale: z.string().default(''),
  assumptions: z.array(z.string()).default([]),
  answerSpace: z
    .object({
      positions: z
        .array(
          z.object({
            key: z.string().default(''),
            kind: z.string().default('defensible'),
            summary: z.string().default(''),
            ignoredEvidence: z.string().nullish(),
            isMinimumCommitment: z.boolean().default(false),
          }),
        )
        .default([]),
    })
    .prefault({}),
  superseded: z
    .array(z.object({ claimText: z.string().default(''), documentTitle: z.string().default('') }))
    .default([]),
})

export const AdaptationInput = z.object({
  frame: FrameInput.prefault({}),
  turnText: z.string().default(''),
  warrantsChange: z.boolean().default(false),
  proportionateResponse: z.string().default(''),
  response: z.string().default(''),
  justification: z.string().default(''),
})

export const OwnershipInput = z.object({
  qa: z
    .array(
      z.object({
        question: z.string().default(''),
        expectedAnswerNotes: z.string().default(''),
        answer: z.string().default(''),
        followUp: z.string().nullish(),
        followUpAnswer: z.string().nullish(),
      }),
    )
    .default([]),
  /**
   * Titles the answers could cite; absent, the read falls back to the document vocabulary.
   *
   * The one key in this file §2.1's input table does not list, and §1.4's own description of this
   * heuristic — "a digit, a document title, or a reason marker" — is what asks for it. Declared in
   * the mock ahead of the prompt so the fallback is stated rather than silent; D-266 puts
   * `documentTitles` in `band-read-ownership@1`'s input when Phase 10 writes it, and until then no
   * caller can supply it, because nothing renders it.
   */
  documentTitles: z.array(z.string()).default([]),
})

// ---------------------------------------------------------------------------------------------
// Framing (rubric A.1): does the frame name a real decision, real assumptions, and a real position?
// ---------------------------------------------------------------------------------------------

/** A decision worth the name is a sentence; an assumption is a clause; a position is a paragraph. */
const FRAMING = {
  professional: { decision: 12, assumption: 8, position: 25, overlap: 4 },
  proficient: { decision: 8, assumption: 5, position: 15, overlap: 2 },
  developing: { decision: 4, assumption: 2, position: 6, overlap: 0 },
} as const

export function readFraming(raw: unknown): BandRead {
  const input = FramingInput.parse(raw)
  const decision = words(input.frame.decision)
  const assumption =
    input.frame.assumptions.length === 0 ? 0 : Math.min(...input.frame.assumptions.map(words))
  const position = words(input.frame.position)
  const answerSpaceOverlap = overlap(
    `${input.frame.position} ${input.frame.decision}`,
    input.answerSpace,
  )

  const meets = (level: (typeof FRAMING)[keyof typeof FRAMING]): boolean =>
    decision >= level.decision &&
    assumption >= level.assumption &&
    position >= level.position &&
    answerSpaceOverlap >= level.overlap

  const band: MockBand = meets(FRAMING.professional)
    ? 'professional'
    : meets(FRAMING.proficient)
      ? 'proficient'
      : meets(FRAMING.developing)
        ? 'developing'
        : 'novice'

  const strongest: BandQuote =
    position >= decision
      ? { field: 'position', text: firstSentence(input.frame.position) }
      : { field: 'decision', text: firstSentence(input.frame.decision) }

  return {
    band,
    quotes: strongest.text === '' ? [] : [strongest],
    rationale: `The decision runs ${decision} words, the thinnest assumption ${assumption}, and the position ${position}; the position shares ${answerSpaceOverlap} content words with the answer space, and ${input.documentsRead.length} documents had been read.`,
  }
}

// ---------------------------------------------------------------------------------------------
// Delegation (rubric A.2): were requests purposeful, and is there a reason for each reliance?
// ---------------------------------------------------------------------------------------------

/** A why line is a reason once it is a clause; one word ("useful") is a label, not a reason. */
const WHY_MIN_WORDS = 3
const REASON_FOR_NOT_DELEGATING_MIN_WORDS = 5
const DELEGATION_WHY_SHARE = { professional: 0.8, proficient: 0.5 } as const

export function readDelegation(raw: unknown): BandRead {
  const input = DelegationInput.parse(raw)
  const reason = input.reasonForNotDelegating ?? ''

  if (input.delegations.length === 0) {
    const stated = words(reason) >= REASON_FOR_NOT_DELEGATING_MIN_WORDS
    return {
      band: stated ? 'proficient' : 'novice',
      quotes: stated ? [{ field: 'reasonForNotDelegating', text: firstSentence(reason) }] : [],
      rationale: stated
        ? 'No delegation was made, and the run states why it was not needed.'
        : 'No delegation was made and no reason was given for working without one.',
    }
  }

  const withWhy = input.delegations.filter((d) => words(d.why ?? '') >= WHY_MIN_WORDS)
  const share = withWhy.length / input.delegations.length
  const usedTotal = input.delegations.reduce((sum, d) => sum + d.usedClaimCount, 0)

  const band: MockBand =
    share >= DELEGATION_WHY_SHARE.professional && usedTotal > 0
      ? 'professional'
      : share >= DELEGATION_WHY_SHARE.proficient
        ? 'proficient'
        : share > 0
          ? 'developing'
          : 'novice'

  const quoted = withWhy[0] ?? input.delegations[0]
  return {
    band,
    quotes:
      quoted === undefined
        ? []
        : [
            withWhy.length > 0
              ? { field: 'why', text: firstSentence(quoted.why ?? '') }
              : { field: 'request', text: firstSentence(quoted.request) },
          ],
    rationale: `${withWhy.length} of ${input.delegations.length} delegations carry a why line, and ${usedTotal} claims were marked used.`,
  }
}

// ---------------------------------------------------------------------------------------------
// Decision Quality (rubric A.5): is the recommendation inside the answer space, and defended?
// ---------------------------------------------------------------------------------------------

/** Below this, the recommendation and a position are not talking about the same thing. */
const POSITION_MATCH_MIN_OVERLAP = 2
const DEFENDED_RATIONALE_WORDS = 25
/** A recommendation that repeats this much of a superseded claim is resting on it. */
const SUPERSEDED_ECHO_MIN_OVERLAP = 3

export function readDecisionQuality(raw: unknown): DecisionQualityRead {
  const input = DecisionQualityInput.parse(raw)
  const stated = `${input.recommendation} ${input.rationale}`

  const scored = input.answerSpace.positions
    .map((position) => ({ position, score: overlap(stated, position.summary) }))
    .sort((left, right) => right.score - left.score)
  const best = scored[0]
  const matched = best !== undefined && best.score >= POSITION_MATCH_MIN_OVERLAP ? best : undefined

  const leaning = input.superseded.filter(
    (entry) => overlap(stated, entry.claimText) >= SUPERSEDED_ECHO_MIN_OVERLAP,
  )
  const defended = words(input.rationale) >= DEFENDED_RATIONALE_WORDS

  let band: MockBand
  if (matched === undefined) band = 'novice'
  else if (matched.position.kind === 'evidence_inconsistent') band = 'novice'
  else if (leaning.length > 0) band = 'developing'
  else if (matched.position.isMinimumCommitment) band = 'proficient'
  else band = defended ? 'professional' : 'proficient'

  const ignoredEvidence = matched?.position.ignoredEvidence ?? null

  const read: DecisionQualityRead = {
    band,
    matchedPositionKey: matched?.position.key ?? null,
    quotes:
      firstSentence(input.recommendation) === ''
        ? []
        : [{ field: 'recommendation', text: firstSentence(input.recommendation) }],
    rationale:
      matched === undefined
        ? 'The recommendation matches no position in the authored answer space.'
        : `The recommendation matches the ${matched.position.kind} position ${matched.position.key}; the rationale runs ${words(input.rationale)} words and rests on ${leaning.length} superseded claims.`,
  }
  return ignoredEvidence === null || ignoredEvidence === '' ? read : { ...read, ignoredEvidence }
}

// ---------------------------------------------------------------------------------------------
// Adaptation (rubric A.6): was the response proportionate, and is the change reasoned?
// ---------------------------------------------------------------------------------------------

/** Two shared content words is the point where a justification is engaging with the text. */
const ADAPTATION_MENTION_MIN_OVERLAP = 2

export function readAdaptation(raw: unknown): BandRead {
  const input = AdaptationInput.parse(raw)
  const mentionsTurn =
    overlap(input.justification, input.turnText) >= ADAPTATION_MENTION_MIN_OVERLAP
  const mentionsAssumption =
    overlap(input.justification, input.frame.assumptions.join(' ')) >=
    ADAPTATION_MENTION_MIN_OVERLAP
  const proportionate = input.response === input.proportionateResponse

  const band: MockBand = proportionate
    ? mentionsTurn && mentionsAssumption
      ? 'professional'
      : mentionsTurn || mentionsAssumption
        ? 'proficient'
        : 'developing'
    : mentionsTurn
      ? 'developing'
      : 'novice'

  return {
    band,
    quotes:
      firstSentence(input.justification) === ''
        ? []
        : [{ field: 'justification', text: firstSentence(input.justification) }],
    // The rationale is shown to the student in the debrief (D-396), so it says what the *response*
    // did and never what the Turn warranted: `proportionateResponse` is a 12 §8.1 field that may
    // not reach a student payload in any state, and naming its value here would put it there. The
    // scoring module's filter would redact the sentence; a stand-in that has to be redacted is a
    // stand-in that is wrong (D-426).
    rationale: `The response was ${input.response}${proportionate ? '' : ', which is out of step with what the message brought'}; the justification ${mentionsTurn ? 'engages with' : 'does not engage with'} the message and ${mentionsAssumption ? 'names' : 'does not name'} a frame assumption.`,
  }
}

// ---------------------------------------------------------------------------------------------
// Ownership (rubric A.7): can the run be defended in its own words, with sources?
// ---------------------------------------------------------------------------------------------

const OWNERSHIP_GROUNDED_SHARE = { professional: 0.8, proficient: 0.5 } as const

export function readOwnership(raw: unknown): BandRead {
  const input = OwnershipInput.parse(raw)
  if (input.qa.length === 0) {
    return {
      band: 'novice',
      quotes: [],
      rationale: 'No defense answers were given.',
    }
  }

  const titles = input.documentTitles.filter((title) => title.trim() !== '')
  const citesTitle = (answer: string): boolean =>
    titles.length > 0
      ? titles.some((title) => overlap(answer, title) >= 1)
      : DOCUMENT_WORDS.test(answer)

  const grounded = input.qa.filter((entry) => {
    const answer = `${entry.answer} ${entry.followUpAnswer ?? ''}`
    return DIGIT.test(answer) || citesTitle(answer) || REASON_MARKERS.test(answer)
  })
  const share = grounded.length / input.qa.length

  const band: MockBand =
    share >= OWNERSHIP_GROUNDED_SHARE.professional
      ? 'professional'
      : share >= OWNERSHIP_GROUNDED_SHARE.proficient
        ? 'proficient'
        : share > 0
          ? 'developing'
          : 'novice'

  const quoted = grounded[0] ?? input.qa[0]
  return {
    band,
    quotes:
      quoted === undefined || firstSentence(quoted.answer) === ''
        ? []
        : [{ field: 'answer', text: firstSentence(quoted.answer) }],
    rationale: `${grounded.length} of ${input.qa.length} answers carry a figure, a source, or a stated reason.`,
  }
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/** The reading for one `band-read-*` prompt, as the object the provider serialises to JSON. */
export function readBand(prompt: BandReadPrompt, input: unknown): BandRead | DecisionQualityRead {
  switch (prompt) {
    case 'band-read-framing':
      return readFraming(input)
    case 'band-read-delegation':
      return readDelegation(input)
    case 'band-read-decision-quality':
      return readDecisionQuality(input)
    case 'band-read-adaptation':
      return readAdaptation(input)
    case 'band-read-ownership':
      return readOwnership(input)
  }
}
