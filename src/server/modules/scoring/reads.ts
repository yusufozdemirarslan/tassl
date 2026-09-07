// Step four of the scoring pipeline — the five model reads (10-backend-spec-modules.md §11;
// 11-llm-integration.md §2.1 and §3; AI-003, FR-137, FR-138, D-046, D-395).
//
// Trace → graphs → facts → **reads** → bands → points. Five of the seven dimensions turn on free
// text, so this file assembles what each `band-read-*` prompt is given, asks the provider for a
// structured answer, and turns what comes back into the `BandRead` shape `bands.ts` takes as an
// argument. Verification and Calibration never appear here: PRD §7.13 computes them from the trace.
//
// Four rules run through the whole file, and each is a place this could go wrong quietly.
//
// **The student's own words are data, never instructions.** The material these reads consume is
// exactly where an injected instruction would be typed: the frame, the brief, the Turn
// justification, the defense answers. Every one of them reaches the model inside an `untrusted()`
// block whose delimiters nothing placed in them can close (D-067), under a system message that says
// the block is the material being assessed. That is three of §3's four layers; the fourth is that
// everything coming back is validated by Zod and then narrowed further here.
//
// **A quote is evidence, so it has to be the run's own words.** A model can write any sentence it
// likes into `quotes`, and a band's quotes are read back in the faculty replay as what the placement
// rested on. So a returned quote is kept only when it is actually present in one of the fields this
// file sent, and it is anchored to the trace event that field came from — `run_bands.quotes` carries
// `{ event_seq, text }`, and an unanchored quote is not evidence. Presence is necessary and it is
// not sufficient: a fragment lifted out of the middle of a sentence can say the opposite of the
// sentence, so a quote that leaves a negation behind it is refused (`anchorQuotes`, D-429).
//
// **A rationale is shown to a student, so it goes through two filters.** D-396 forbids a band
// rationale that names an evidence status, a failure family or a planted claim; 12 §8.1 forbids
// three more things the reads are actually *given* — the Turn's `warrantsChange` and
// `proportionateResponse` and the defense bank's `expectedAnswerNotes` — and FR-131 forbids a total,
// a rank or a percentile anywhere. The prompts say all of it, but an instruction is a request and a
// filter is a guarantee (§3), so the model's sentence goes through §3's list, then through
// `BAND_RATIONALE_TERMS`, and is dropped whole if it echoes a span of the answer-key prose it was
// shown (D-426).
//
// **A read that does not come back is not a low band.** Each of the five is asked independently and
// a failure is recorded rather than thrown: `bands.ts` then places what the recorded events still
// support — `basis: 'categorical_only'` — and reports the rest unassessed with reason `read_failed`,
// which is what makes the job hold the run (11 §3, FR-140).
import type { ZodType } from 'zod'
import { isAppError } from '@/lib/errors'
import { voiceHits } from '@/lib/product-voice'
import { getLogger } from '@/server/http/request-context'
import { defectWordFilter, foldForMatch, redactTerms } from '@/server/llm/guardrails/defect-words'
import { QUOTE_MAX_CHARS } from '@/server/llm/prompts/band-read'
import { bandReadAdaptationPrompt } from '@/server/llm/prompts/band-read-adaptation'
import { bandReadDecisionQualityPrompt } from '@/server/llm/prompts/band-read-decision-quality'
import { bandReadDelegationPrompt } from '@/server/llm/prompts/band-read-delegation'
import { bandReadFramingPrompt } from '@/server/llm/prompts/band-read-framing'
import { bandReadOwnershipPrompt } from '@/server/llm/prompts/band-read-ownership'
import type { LlmCallContext, LlmMessage, LlmProvider } from '@/server/llm/provider'
import type { RunEventTypeValue } from '@/server/modules/trace/schema'
import type { BandQuote, BandRead, BandReads, DecisionQualityRead, MatchedPosition } from './bands'
import type { GraphEvent, GraphTurnSpec, RunGraphs } from './graphs'
import { eventsOfType, firstOfType, lastOfType } from './graphs/types'
import type { Band, Dimension, DimensionRubric, Rubric } from './rubric'

// ---------------------------------------------------------------------------------------------
// What a read is asked about
// ---------------------------------------------------------------------------------------------

/** The five dimensions AI-003 reads; the other two are computed (PRD §7.13). */
export const READ_DIMENSIONS = [
  'framing',
  'delegation',
  'decision_quality',
  'adaptation',
  'ownership',
] as const
export type ReadDimension = (typeof READ_DIMENSIONS)[number]

/** One authored position of the answer space (DATA-017), as the reads carry it. */
export type ReadPosition = {
  key: string
  kind: 'defensible' | 'evidence_inconsistent'
  summary: string
  ignoredEvidence: string | null
  isMinimumCommitment: boolean
}

/** One Evidence Room document, with the role bookkeeping the Decision Quality read needs. */
export type ReadDocument = {
  id: string
  title: string
  role: string
  supersededByDocumentId: string | null
}

/** One consequential claim, with the source document that decides whether it was superseded. */
export type ReadClaim = { id: string; text: string; sourceDocumentId: string | null }

/** One question of the defense with its answer, and the trace event the answer was written as. */
export type ReadDefenseEntry = {
  question: string
  expectedAnswerNotes: string
  answer: string
  followUp: string | null
  followUpAnswer: string | null
  /** `run_events.seq` of the `defense_answer` this text was written in; anchors its quotes. */
  answerEventSeq: number | null
}

/** Everything the five reads are built from, beyond the trace and the graphs. */
export type ReadContext = {
  events: readonly GraphEvent[]
  graphs: RunGraphs
  /**
   * `run_delegations.id` for the exchanges a reviewer marked out of scenario (FR-055, D-481).
   *
   * The same set `GraphInput` carries, restated here because a read is built from the trace and the
   * authored standard rather than from a graph input. `scoreRun` passes one value to both.
   */
  flaggedDelegationIds: readonly string[]
  turn: GraphTurnSpec | null
  positions: readonly ReadPosition[]
  documents: readonly ReadDocument[]
  claims: readonly ReadClaim[]
  defense: readonly ReadDefenseEntry[]
  rubric: Rubric
}

/** A field this file sent, and the trace event it came from: the anchor for a quote taken from it. */
export type QuoteSource = { field: string; text: string; eventSeq: number }

export type ReadInputs = Record<ReadDimension, unknown>

export type BuiltReads = {
  inputs: ReadInputs
  sources: Record<ReadDimension, QuoteSource[]>
}

// ---------------------------------------------------------------------------------------------
// Building the inputs (11 §2.1)
// ---------------------------------------------------------------------------------------------

const descriptorsOf = (rubric: Rubric, dimension: Dimension): DimensionRubric =>
  rubric.dimensions[dimension]

const seqOf = (events: readonly GraphEvent[], type: RunEventTypeValue): number | null =>
  firstOfType(events, type)?.seq ?? null

const withText = (sources: QuoteSource[]): QuoteSource[] =>
  sources.filter((source) => source.text.trim() !== '')

/**
 * Every read input, and the quote sources that anchor what comes back.
 *
 * Pure: no provider, no database, no clock. `runBandReads` calls it and so do the unit tests, which
 * is the point — what a model is shown about a student is worth checking without a model.
 */
export function buildReadInputs(context: ReadContext): BuiltReads {
  const { events, graphs, rubric } = context
  const layout = graphs.frame_beside_decision
  const frameSeq = seqOf(events, 'frame_locked')
  const lockSeq = seqOf(events, 'decision_locked')
  const responseEvent = lastOfType(events, 'turn_response_locked')
  const turnSeq = responseEvent?.seq ?? seqOf(events, 'turn_delivered')

  const frame = {
    decision: layout.frame?.decision ?? '',
    assumptions: layout.frame?.assumptions ?? [],
    position: layout.frame?.position ?? '',
    confidence: layout.frame?.confidence ?? null,
  }

  const titleOf = new Map(context.documents.map((document) => [document.id, document.title]))
  const documentsRead = [
    ...new Set(
      eventsOfType(events, 'document_open')
        .filter((event) => event.payload.before_first_delegation)
        .map((event) => titleOf.get(event.payload.document_id) ?? ''),
    ),
  ].filter((title) => title !== '')

  const defenseAnswers = context.defense
    .map((entry) => entry.answer)
    .filter((answer) => answer.trim() !== '')

  // ------------------------------------------------------------------------------------------
  // Framing (A.1)
  //
  // The answer space is the *defensible* positions only. A.1 asks whether the position sits inside
  // the space of defensible answers; the position the author built to be inconsistent with the room
  // is not one of them, and including it would widen the space a frame has to land in.
  // ------------------------------------------------------------------------------------------
  const framingInput = {
    descriptors: descriptorsOf(rubric, 'framing'),
    frame,
    answerSpace: context.positions
      .filter((position) => position.kind === 'defensible')
      .map((position) => position.summary)
      .join('\n'),
    documentsRead,
  }
  const framingSources = withText(
    frameSeq === null
      ? []
      : [
          { field: 'decision', text: frame.decision, eventSeq: frameSeq },
          { field: 'position', text: frame.position, eventSeq: frameSeq },
          ...frame.assumptions.map((text) => ({ field: 'assumption', text, eventSeq: frameSeq })),
        ],
  )

  // ------------------------------------------------------------------------------------------
  // Delegation (A.2)
  //
  // Flagged delegations are excluded (10 §11.3): a reviewer has already said the exchange was out of
  // scenario, and reading it would band the student on material the faculty seat discounted.
  //
  // The mark is `context.flaggedDelegationIds`, read from `run_delegations` (FR-055, D-481) — not
  // the `delegation` event's own `flags`, which carries the *guard's* marks and never a reviewer's,
  // so filtering on it both missed every reviewer mark and silently dropped every rebuilt reply.
  // ------------------------------------------------------------------------------------------
  const flaggedDelegations = new Set(context.flaggedDelegationIds)
  const delegationEvents = eventsOfType(events, 'delegation').filter(
    (event) => !flaggedDelegations.has(event.payload.delegation_id),
  )
  const usedMarks = eventsOfType(events, 'claim_used').filter(
    (event) => event.payload.via === 'log_mark',
  )
  const delegations = delegationEvents.map((event) => ({
    request: event.payload.request_text,
    why: event.payload.why,
    usedClaimCount: usedMarks.filter(
      (mark) => mark.payload.delegation_id === event.payload.delegation_id,
    ).length,
  }))

  // FR-064 and 10 §11.3: with no delegation to read, the read looks for the stated reason, and the
  // place a student states it is the defense — the one part of the run they narrate in their own
  // words. `bands.ts` marks the band `defense_only` on the same condition.
  const reasonForNotDelegating =
    delegations.length === 0 && defenseAnswers.length > 0 ? defenseAnswers.join('\n\n') : null

  const delegationInput = {
    descriptors: descriptorsOf(rubric, 'delegation'),
    delegations,
    reasonForNotDelegating,
    defenseAnswers,
  }
  // The defense answers are in this read's input either way — as `reasonForNotDelegating` when the
  // run made no delegation, and as `defenseAnswers` beside the log when it did — so both are
  // anchorable. The label is the field the answers were actually *sent* as: a quote filed against
  // `reasonForNotDelegating` on a run full of delegations names a field that read never saw.
  const defenseAnswerField =
    reasonForNotDelegating === null ? 'defenseAnswers' : 'reasonForNotDelegating'
  const delegationSources = withText([
    ...delegationEvents.flatMap((event) => [
      { field: 'request', text: event.payload.request_text, eventSeq: event.seq },
      { field: 'why', text: event.payload.why ?? '', eventSeq: event.seq },
    ]),
    ...context.defense.flatMap((entry) =>
      entry.answerEventSeq === null
        ? []
        : [
            {
              field: defenseAnswerField,
              text: entry.answer,
              eventSeq: entry.answerEventSeq,
            },
          ],
    ),
  ])

  // ------------------------------------------------------------------------------------------
  // Decision Quality (A.5)
  // ------------------------------------------------------------------------------------------
  const documentById = new Map(context.documents.map((document) => [document.id, document]))
  const superseded = context.claims.flatMap((claim) => {
    const source =
      claim.sourceDocumentId === null ? undefined : documentById.get(claim.sourceDocumentId)
    if (!source || source.role !== 'superseded') return []
    const replacement =
      source.supersededByDocumentId === null
        ? undefined
        : titleOf.get(source.supersededByDocumentId)
    return [{ claimText: claim.text, documentTitle: replacement ?? source.title }]
  })

  const brief = layout.brief
  const decisionQualityInput = {
    descriptors: descriptorsOf(rubric, 'decision_quality'),
    recommendation: brief?.recommendation ?? '',
    rationale: brief?.rationale ?? '',
    assumptions: brief?.assumptions ?? [],
    answerSpace: { positions: context.positions },
    superseded,
  }
  const decisionQualitySources = withText(
    lockSeq === null || brief === null
      ? []
      : [
          { field: 'recommendation', text: brief.recommendation, eventSeq: lockSeq },
          { field: 'rationale', text: brief.rationale, eventSeq: lockSeq },
          ...brief.assumptions.map((text) => ({ field: 'assumption', text, eventSeq: lockSeq })),
        ],
  )

  // ------------------------------------------------------------------------------------------
  // Adaptation (A.6)
  // ------------------------------------------------------------------------------------------
  const justification = layout.turn?.justification ?? ''
  const adaptationInput = {
    descriptors: descriptorsOf(rubric, 'adaptation'),
    frame,
    turnText: layout.turn?.text ?? '',
    warrantsChange: context.turn?.warrantsChange ?? false,
    proportionateResponse: context.turn?.proportionateResponse ?? 'hold',
    response: layout.turn?.implicit === true ? '' : (layout.turn?.response ?? ''),
    justification,
  }
  const adaptationSources = withText(
    turnSeq === null ? [] : [{ field: 'justification', text: justification, eventSeq: turnSeq }],
  )

  // ------------------------------------------------------------------------------------------
  // Ownership (A.7)
  // ------------------------------------------------------------------------------------------
  const ownershipInput = {
    descriptors: descriptorsOf(rubric, 'ownership'),
    qa: context.defense.map((entry) => ({
      question: entry.question,
      expectedAnswerNotes: entry.expectedAnswerNotes,
      answer: entry.answer,
      followUp: entry.followUp,
      followUpAnswer: entry.followUpAnswer,
    })),
    documentTitles: context.documents.map((document) => document.title),
  }
  const ownershipSources = withText(
    context.defense.flatMap((entry) =>
      entry.answerEventSeq === null
        ? []
        : [
            { field: 'answer', text: entry.answer, eventSeq: entry.answerEventSeq },
            {
              field: 'follow-up answer',
              text: entry.followUpAnswer ?? '',
              eventSeq: entry.answerEventSeq,
            },
          ],
    ),
  )

  return {
    inputs: {
      framing: framingInput,
      delegation: delegationInput,
      decision_quality: decisionQualityInput,
      adaptation: adaptationInput,
      ownership: ownershipInput,
    },
    sources: {
      framing: framingSources,
      delegation: delegationSources,
      decision_quality: decisionQualitySources,
      adaptation: adaptationSources,
      ownership: ownershipSources,
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Reading what comes back
// ---------------------------------------------------------------------------------------------

/** The output shape every band read answers in, before this file narrows it (11 §2.1). */
export type RawBandRead = {
  band: Band
  quotes: { field: string; text: string }[]
  rationale: string
  /** `band-read-decision-quality@1` alone; FR-109's position key, or null for none. */
  matchedPositionKey?: string | null
  ignoredEvidence?: string | undefined
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()
/** The mock cuts a long field with a trailing ellipsis; a real provider may do the same. */
const withoutEllipsis = (text: string): string => text.replace(/[…]+\s*$/u, '').trim()
const forMatch = (text: string): string => collapse(withoutEllipsis(text)).toLowerCase()

/** At most three quotes on a band: a band cites what it rested on, it does not reproduce the run. */
export const MAX_BAND_QUOTES = 3

/**
 * The shortest span that is a quotation rather than a token (D-429). "11 months" is a figure the
 * band can name in its rationale; as a *quote* it is an unfalsifiable citation of three words the
 * student happened to type, and a single character anchors against anything at all.
 */
export const QUOTE_MIN_CHARS = 12
export const QUOTE_MIN_WORDS = 3

/**
 * What, standing between the start of a sentence and the quote, changes what the quote means
 * (D-429). A fragment is kept only when nothing in its own sentence's prefix reverses it.
 */
const NEGATION_BEFORE =
  /\b(?:not|n't|no|never|nobody|nothing|none|neither|nor|hardly|barely|scarcely|without|unless|doubt|doubted|doubts|deny|denied|denies|disagree|disagreed|reject|rejected|refute|refuted|dispute|disputed|question|questioned|cannot|can't|won't|wouldn't|didn't|don't|isn't|aren't|wasn't|weren't|instead|rather)\b/i

/** Where the sentence containing `at` begins. */
function sentenceStartBefore(text: string, at: number): number {
  let start = 0
  for (let index = 0; index < at; index += 1) {
    if (/[.!?;\n]/.test(text[index] ?? '')) start = index + 1
  }
  return start
}

/**
 * The quotes a read may keep: the ones this file can find in the text it actually sent, with the
 * meaning they had there.
 *
 * A model that invented a sentence or paraphrased a field into something the student did not write
 * produces no quote at all rather than a quote nobody can check. The field name is a preference and
 * not a requirement — a real provider labels fields loosely — but presence in a source is absolute.
 *
 * Presence is not enough on its own, which is the narrowing D-429 adds to D-404. `the payback is 11
 * months` is present in `I do not believe the payback is 11 months, because nobody traced it`, and
 * filing it as the band's evidence would put the opposite of the student's sentence under their
 * band. So a fragment that starts inside a sentence is refused when the part of that sentence it
 * leaves behind negates it, and a quote shorter than `QUOTE_MIN_CHARS` or `QUOTE_MIN_WORDS` is
 * refused outright: a token is not a quotation.
 *
 * What anchoring cannot do is refuse an instruction the student typed into their own frame and the
 * model echoed back: it *is* present in the text that was sent, because the student wrote it. That
 * case is held by the `untrusted()` block and the system message around it (11 §3), not here —
 * D-404 said otherwise and is corrected by D-429.
 */
export function anchorQuotes(
  quotes: readonly { field: string; text: string }[],
  sources: readonly QuoteSource[],
): BandQuote[] {
  const kept: BandQuote[] = []
  const seen = new Set<string>()

  for (const quote of quotes) {
    const text = collapse(withoutEllipsis(quote.text)).slice(0, QUOTE_MAX_CHARS)
    if (text.length < QUOTE_MIN_CHARS) continue
    if (text.split(' ').filter((word) => word !== '').length < QUOTE_MIN_WORDS) continue
    const needle = forMatch(text)
    const matches = sources.filter((source) => keepsItsMeaning(source.text, needle))
    const anchor = matches.find((source) => source.field === quote.field) ?? matches[0]
    if (!anchor) continue
    const key = `${String(anchor.eventSeq)}:${text}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push({ event_seq: anchor.eventSeq, text })
    if (kept.length >= MAX_BAND_QUOTES) break
  }
  return kept
}

/** True when `needle` is in `source` and nothing before it in its own sentence reverses it. */
function keepsItsMeaning(source: string, needle: string): boolean {
  const haystack = forMatch(source)
  const at = haystack.indexOf(needle)
  if (at === -1) return false
  const start = sentenceStartBefore(haystack, at)
  return !NEGATION_BEFORE.test(haystack.slice(start, at))
}

/**
 * Spans a band rationale may never **disclose**, on top of §3's list (D-426, D-513).
 *
 * §3's list is what the assistant may not say to a student *during* a run. This is the second list,
 * for the one sentence the scoring pipeline writes and the debrief shows (D-396), and it is built
 * from what the reads are actually given: the Adaptation input carries the Turn's `warrantsChange`
 * and `proportionateResponse` and the Ownership input carries the bank's `expectedAnswerNotes`, and
 * all three are 12 §8.1 fields that may not reach a student payload in any state.
 *
 * The same test each term has to pass is §3's: does the *band read* have a legitimate use for it?
 * "The response went further than the new information warranted" is the sentence D-396 approves, so
 * bare `warranted` is not on the list; `warrants change` and `was proportionate` state the authored
 * answer and are.
 *
 * **FR-131's half of this list has moved** to `RANKING` in `src/lib/product-voice.ts`, which is a
 * superset of it and is shared with the catalogue scan (D-513). What is left here is a disclosure
 * rule rather than a voice rule, and that is why these are redacted where a voice hit refuses the
 * whole sentence: the rest of a sentence that named the answer key is still a true description of
 * what happened, and the rest of a sentence that accused the student is still an accusation.
 */
export const BAND_RATIONALE_TERMS: readonly string[] = [
  // 12 §8.1, Turn internals (FR-114): what the Turn warranted and what response was proportionate.
  'warrants change',
  'warrants a change',
  'warranted change',
  'change was warranted',
  'change is warranted',
  'proportionate response',
  'proportionate responses',
  'disproportionate response',
  'was proportionate',
  'is proportionate',
  'were proportionate',
  // 12 §8.1, the question bank's machinery (FR-123): the notes beside each defense question.
  'expected answer',
  'expected answers',
  'answer notes',
  'model answer',
  'model answers',
]

/** A span of this many words, repeated verbatim, is an echo rather than a coincidence. */
const ECHO_WINDOW_WORDS = 6

const wordsOf = (text: string): string[] =>
  forMatch(text)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word !== '')

/**
 * True when `text` repeats `ECHO_WINDOW_WORDS` consecutive words of any string in `sources`.
 *
 * The list of terms above catches a rationale that *names* the answer key; this catches one that
 * quotes it. `expectedAnswerNotes` is the only prose in any of the five inputs that a student may
 * never read (12 §8.1), and a read that hands it back sentence by sentence would leak it without
 * using a single word from the list.
 */
function echoes(text: string, sources: readonly string[]): boolean {
  const haystack = wordsOf(text)
  if (haystack.length < ECHO_WINDOW_WORDS) return false
  const joined = ` ${haystack.join(' ')} `
  return sources.some((source) => {
    const words = wordsOf(source)
    for (let at = 0; at + ECHO_WINDOW_WORDS <= words.length; at += 1) {
      if (joined.includes(` ${words.slice(at, at + ECHO_WINDOW_WORDS).join(' ')} `)) return true
    }
    return false
  })
}

/**
 * The model's own sentence, made safe to show a student (D-396, D-426, D-513).
 *
 * `run_bands.rationale` is the one student-facing string in the product that no person writes, and
 * it is rendered verbatim by the debrief and by the Judgment Record — the artifact a person may
 * still be reading a year later. Everything below is what stands between a model and that page, and
 * it is four rules applied in order:
 *
 *   1. **§3's defect-word filter** — the run's own defect vocabulary, redacted.
 *   2. **The 12 §8.1 disclosure spans** (`BAND_RATIONALE_TERMS`) — the Turn's warrant and the
 *      question bank's notes, redacted. What is left of the sentence still describes the run.
 *   3. **The product's voice** (`src/lib/product-voice.ts`) — misconduct, character and motive,
 *      ranking and comparison. **Refused whole, not redacted.** "You were [redacted] here and
 *      [redacted] to check the figure" is the same accusation with two holes in it, and a reader
 *      fills them in; a sentence that ranks the student is the wrong sentence and not a right one
 *      with a word missing. The fallback costs nothing that matters, because `bands.ts` composes
 *      the categorical sentence first and splices the read in only when there is one (`join`) —
 *      which is exactly what rule 4 has always done.
 *   4. **The answer-key echo** — a rationale reciting the notes it was shown, refused whole.
 *
 * PRD §7's standing rule that nothing Tassl observes is treated as misconduct is the product's
 * central promise, and an instruction in a prompt is not a guarantee. This is the guarantee.
 */
export function filterRationale(rationale: string, neverEcho: readonly string[] = []): string {
  const result = defectWordFilter([{ type: 'text', text: collapse(rationale) }])
  const segment = result.segments[0]
  const filtered = segment && segment.type === 'text' ? segment.text : ''
  const narrowed = redactTerms(filtered, BAND_RATIONALE_TERMS).text
  // The folded copy is what the voice lists are matched against, so `cаreless` with a Cyrillic а is
  // the word it renders as — the same normalisation §3's own filter matches through (D-427).
  const hits = voiceHits(foldForMatch(narrowed))
  if (hits.length > 0) {
    getLogger().warn(
      { rules: [...new Set(hits.map((hit) => hit.rule))] },
      'band rationale refused: it did not keep the product’s voice',
    )
    return ''
  }
  return echoes(narrowed, neverEcho) ? '' : narrowed
}

/** FR-109's vocabulary, from the position key the read named and the answer space it was given. */
export function matchedPositionOf(
  key: string | null | undefined,
  positions: readonly ReadPosition[],
  recommendation: string,
): MatchedPosition {
  if (key === null || key === undefined || key === '') {
    // A brief with no recommendation at all is `recommendationEmpty`, which `bands.ts` places before
    // it looks at a read; a brief that says something and matches nothing is outside the space.
    return recommendation.trim() === '' ? 'declined' : 'none'
  }
  const position = positions.find((candidate) => candidate.key === key)
  if (!position) return 'none'
  if (position.kind === 'evidence_inconsistent') return 'evidence_inconsistent'
  return position.isMinimumCommitment ? 'minimum_commitment' : 'defensible'
}

/** One read's answer as `bands.ts` takes it: anchored quotes, a filtered rationale, nothing else. */
export function toBandRead(
  raw: RawBandRead,
  sources: readonly QuoteSource[],
  neverEcho: readonly string[] = [],
): BandRead {
  return {
    band: raw.band,
    quotes: anchorQuotes(raw.quotes, sources),
    rationale: filterRationale(raw.rationale, neverEcho),
  }
}

// ---------------------------------------------------------------------------------------------
// Running them
// ---------------------------------------------------------------------------------------------

/** Why a read did not come back, in the vocabulary `ops_run_held` reports (13 §3.7). */
export type ReadFailureReason = 'budget_exceeded' | 'provider_error'

export type ReadFailure = { dimension: ReadDimension; reason: ReadFailureReason; code: string }

export type BandReadsResult = {
  reads: BandReads
  failures: ReadFailure[]
  /** Every read that was asked for and answered. */
  completed: ReadDimension[]
}

/** As much of `Prompt<I, O>` as a read needs; structural, so the five prompts satisfy it as written. */
type BandReadPrompt<I, O extends RawBandRead> = {
  name: string
  version: number
  output: ZodType<O>
  render(rawInput: unknown): { messages: LlmMessage[]; input: I }
}

type ReadOutcome<O extends RawBandRead> =
  { dimension: ReadDimension; value: O } | { dimension: ReadDimension; failure: ReadFailure }

/**
 * One read. Never throws.
 *
 * No retry loop lives here. §11 says "failure after retries" and §1.1 says where the retries are: in
 * the provider chain, between the circuit breaker and the timeout, wrapping the network call they
 * exist for. A second one here would double every real failure's latency to arrive at the same
 * answer, and would make "how many times did we ask" two numbers in two files (D-399).
 */
async function readOne<I, O extends RawBandRead>(
  dimension: ReadDimension,
  prompt: BandReadPrompt<I, O>,
  rawInput: unknown,
  provider: LlmProvider,
  context: LlmCallContext,
): Promise<ReadOutcome<O>> {
  try {
    const { messages, input } = prompt.render(rawInput)
    const result = await provider.structured<O>({
      feature: 'band_read',
      promptName: prompt.name,
      promptVersion: prompt.version,
      messages,
      promptInput: input,
      temperature: 0.2,
      schema: prompt.output,
      schemaName: `${prompt.name}-output`,
      context,
    })
    return { dimension, value: result.value }
  } catch (error) {
    const code = isAppError(error) ? error.code : 'INTERNAL_ERROR'
    const reason: ReadFailureReason =
      code === 'LLM_BUDGET_EXCEEDED' ? 'budget_exceeded' : 'provider_error'
    getLogger().warn(
      { err: error, dimension, prompt: `${prompt.name}@${String(prompt.version)}` },
      'band read failed',
    )
    return { dimension, failure: { dimension, reason, code } }
  }
}

/**
 * The five reads, asked together.
 *
 * In parallel because they are independent and the pipeline has five seconds on the mock and three
 * minutes on a real provider (NFR-001, D-047). One read failing must not take the other four with
 * it — 11 §3's ladder degrades a dimension at a time — which is why `readOne` returns its failure
 * rather than throwing it.
 *
 * The provider is a parameter rather than a call to the registry, so the mapping and the degradation
 * can be exercised against a stub without a database behind the call log.
 */
export async function runBandReads(
  context: ReadContext,
  provider: LlmProvider,
  callContext: LlmCallContext,
): Promise<BandReadsResult> {
  const { inputs, sources } = buildReadInputs(context)

  // The one piece of prose in any of the five inputs that a student may never read (12 §8.1,
  // FR-123). Every read is held to it, not only Ownership: a prompt that grows the field later is
  // covered without anyone having to remember this line (D-426).
  const neverEcho = context.defense
    .map((entry) => entry.expectedAnswerNotes)
    .filter((notes) => notes.trim() !== '')

  const [framing, delegation, decisionQuality, adaptation, ownership] = await Promise.all([
    readOne('framing', bandReadFramingPrompt, inputs.framing, provider, callContext),
    readOne('delegation', bandReadDelegationPrompt, inputs.delegation, provider, callContext),
    readOne(
      'decision_quality',
      bandReadDecisionQualityPrompt,
      inputs.decision_quality,
      provider,
      callContext,
    ),
    readOne('adaptation', bandReadAdaptationPrompt, inputs.adaptation, provider, callContext),
    readOne('ownership', bandReadOwnershipPrompt, inputs.ownership, provider, callContext),
  ])

  const reads: BandReads = {}
  const failures: ReadFailure[] = []
  const completed: ReadDimension[] = []

  const outcomes = [framing, delegation, decisionQuality, adaptation, ownership]
  for (const outcome of outcomes) {
    if ('failure' in outcome) {
      failures.push(outcome.failure)
      continue
    }
    completed.push(outcome.dimension)
  }

  if (!('failure' in framing)) reads.framing = toBandRead(framing.value, sources.framing, neverEcho)
  if (!('failure' in delegation)) {
    reads.delegation = toBandRead(delegation.value, sources.delegation, neverEcho)
  }
  if (!('failure' in decisionQuality)) {
    const recommendation = context.graphs.frame_beside_decision.brief?.recommendation ?? ''
    const read: DecisionQualityRead = {
      ...toBandRead(decisionQuality.value, sources.decision_quality, neverEcho),
      matchedPosition: matchedPositionOf(
        decisionQuality.value.matchedPositionKey,
        context.positions,
        recommendation,
      ),
      minimumCommitmentExists: context.positions.some((position) => position.isMinimumCommitment),
    }
    reads.decision_quality = read
  }
  if (!('failure' in adaptation))
    reads.adaptation = toBandRead(adaptation.value, sources.adaptation, neverEcho)
  if (!('failure' in ownership))
    reads.ownership = toBandRead(ownership.value, sources.ownership, neverEcho)

  return { reads, failures, completed }
}
