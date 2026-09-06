// Graph 4 of 4 — frame beside decision (FR-135; 10-backend-spec-modules.md §11.1; D-079).
//
// "The frozen frame (decision, three assumptions, position, confidence) beside the locked brief
// (recommendation, three assumptions, what would change their mind, confidence) and beside the Turn
// response (hold, revise, or reverse, justification, confidence), with the assumptions the Turn
// disrupted marked" (PRD §7.13). Decision Quality and Adaptation are read off it, and Framing reads
// it beside the clock timeline's reading segment.
//
// **It is a layout before it is a graph, and the layout is the argument.** There is no plot here
// and there must not be one: the reading is what a student said they were deciding, before any
// help, against what they filed at the end of the working period. `src/components/graphs/
// frame-beside-decision.tsx` draws it as two columns of the same grid (D-348), which is also why
// the component carries no charting library — it renders on the Turn screen, and 16 §3.2 forbids
// recharts anywhere in the run workspace.
//
// **D-079's marking is a stemmed token overlap of at least one half.** The package's Turn carries
// `disrupted_assumption_keys` — authored intent, in the author's words — and the frame carries
// three sentences in the student's. Neither is a key the other can be looked up by, so the match is
// deterministic and approximate: strip both to content words, stem the obvious English suffixes,
// and call an assumption disrupted when at least half of a key's content words appear in it. A key
// that matches no assumption is not silently dropped; it is listed as "not named in the frame",
// which is itself the finding — the Turn moved something the student never wrote down.
//
// **The answer key stays out of the payload.** `warrants_change` and `proportionate_response` are
// what Adaptation is measured against and are forbidden in any student payload in any state
// (12 §8.1, `student-view.ts`); the debrief shows this graph to the student once the run is scored,
// so neither appears here. The band rules read them from the package version directly (10 §11.3).
import { t } from '@/lib/i18n/t'
import type { RunEventTypeValue } from '@/server/modules/trace/schema'
import {
  firstOfType,
  lastOfType,
  missingEventTypes,
  type GraphBase,
  type GraphInput,
  type TurnResponseValue,
} from './types'

/** The frame locked before the assistant was in the room (FR-040, FR-041). Immutable from then on. */
export type FramedRecordPayload = {
  decision: string
  assumptions: string[]
  position: string
  confidence: number
  locked_at: string
}

/** The brief as filed at the Decision Lock (FR-100 to FR-106). */
export type FiledRecordPayload = {
  recommendation: string
  rationale: string
  assumptions: string[]
  change_my_mind: string
  named_values: Record<string, number>
  confidence: number | null
  /** True when the clock ran out and the draft was locked for the student (FR-105). */
  auto: boolean
  /** FR-106: locked under four minutes of working time. An instructor observation, not a finding. */
  speed_outlier: boolean
  locked_at: string
}

/** The Turn as delivered and the one response filed against it (FR-110 to FR-115). */
export type TurnRecordPayload = {
  text: string
  response: TurnResponseValue | null
  justification: string | null
  confidence: number | null
  /** True when the window closed unanswered, which files a hold (FR-115). */
  implicit: boolean
}

export type FrameBesideDecisionGraph = GraphBase & {
  frame: FramedRecordPayload | null
  brief: FiledRecordPayload | null
  /** The fifty words a student may add after the lock (FR-107); null when none was written. */
  addendum: string | null
  turn: TurnRecordPayload | null
  /** Indexes into `frame.assumptions` the Turn disrupted (D-079). */
  disrupted_assumption_indexes: number[]
  /** Authored disruptions that matched no framed assumption — "not named in the frame" (D-079). */
  unmatched_disrupted_keys: string[]
}

const REQUIRED: readonly RunEventTypeValue[] = ['frame_locked', 'decision_locked']

const RESPONSE_LABELS: Record<TurnResponseValue, string> = {
  hold: t('graph.frameBesideDecision.responseHold'),
  revise: t('graph.frameBesideDecision.responseRevise'),
  reverse: t('graph.frameBesideDecision.responseReverse'),
}

const COLUMNS = [
  t('graph.frameBesideDecision.columnField'),
  t('graph.frameBesideDecision.columnFrame'),
  t('graph.frameBesideDecision.columnDecision'),
]

export function buildFrameBesideDecision(input: GraphInput): FrameBesideDecisionGraph {
  const missing = missingEventTypes(input.events, REQUIRED)
  if (missing.length > 0) return unavailable(missing)

  const frameEvent = firstOfType(input.events, 'frame_locked')
  const lockEvent = firstOfType(input.events, 'decision_locked')
  if (!frameEvent || !lockEvent) return unavailable(REQUIRED)

  const frame: FramedRecordPayload = {
    decision: frameEvent.payload.decision,
    assumptions: [...frameEvent.payload.assumptions],
    position: frameEvent.payload.position,
    confidence: frameEvent.payload.confidence,
    locked_at: frameEvent.occurredAt,
  }
  const brief: FiledRecordPayload = {
    recommendation: lockEvent.payload.recommendation,
    rationale: lockEvent.payload.rationale,
    assumptions: [...lockEvent.payload.assumptions],
    change_my_mind: lockEvent.payload.change_my_mind,
    named_values: { ...lockEvent.payload.named_values },
    confidence: lockEvent.payload.confidence,
    auto: lockEvent.payload.auto,
    speed_outlier: lockEvent.payload.speed_outlier,
    locked_at: lockEvent.occurredAt,
  }

  // The addendum is one per run (FR-107); the last one written is the record.
  const addendum = lastOfType(input.events, 'addendum')

  const delivered = firstOfType(input.events, 'turn_delivered')
  const response = firstOfType(input.events, 'turn_response_locked')
  const turn: TurnRecordPayload | null = delivered
    ? {
        text: delivered.payload.text,
        response: response?.payload.response ?? null,
        justification: response?.payload.justification ?? null,
        confidence: response?.payload.confidence ?? null,
        implicit: response?.payload.implicit ?? false,
      }
    : null

  const { indexes, unmatched } = matchDisruptions(
    input.packageVersion.turn?.disruptedAssumptionKeys ?? [],
    frame.assumptions,
  )

  return {
    available: true,
    missing_event_types: [],
    frame,
    brief,
    addendum: addendum?.payload.text ?? null,
    turn,
    disrupted_assumption_indexes: indexes,
    unmatched_disrupted_keys: unmatched,
    data_table: {
      caption: t('graph.frameBesideDecision.caption'),
      columns: COLUMNS,
      rows: tableRows(frame, brief, addendum?.payload.text ?? null, turn, indexes),
    },
    description: describe(turn, indexes, unmatched),
  }
}

// ---------------------------------------------------------------------------------------------
// D-079 — matching authored disruptions against the student's own words
// ---------------------------------------------------------------------------------------------

/** Words that carry no content and would inflate every overlap if they were counted. */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'for',
  'from',
  'has',
  'have',
  'in',
  'is',
  'it',
  'its',
  'no',
  'not',
  'of',
  'on',
  'or',
  'our',
  'that',
  'the',
  'their',
  'they',
  'this',
  'to',
  'was',
  'we',
  'were',
  'will',
  'with',
  'would',
])

/**
 * A deliberately small English stemmer: plurals and the four inflections that separate an author's
 * `supplier_lead_times` from a student's "supplier lead time". Anything cleverer would need a
 * dictionary, and this match is a marking on a graph a human reads, not a scoring rule.
 */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (
    word.length > 4 &&
    (word.endsWith('sses') || word.endsWith('shes') || word.endsWith('ches'))
  ) {
    return word.slice(0, -2)
  }
  if (word.length > 4 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length > 4 && word.endsWith('ly')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/** Content words of a phrase, stemmed and de-duplicated. Underscores and hyphens are separators. */
export function contentTokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word))
    .map(stem)
  return new Set(words)
}

/** D-079's threshold: at least half of a key's content words appear in the assumption. */
const OVERLAP_THRESHOLD = 0.5

export function matchDisruptions(
  keys: readonly string[],
  assumptions: readonly string[],
): { indexes: number[]; unmatched: string[] } {
  const assumptionTokens = assumptions.map(contentTokens)
  const indexes = new Set<number>()
  const unmatched: string[] = []

  for (const key of keys) {
    const keyTokens = contentTokens(key)
    if (keyTokens.size === 0) {
      unmatched.push(key)
      continue
    }
    let matched = false
    assumptionTokens.forEach((tokens, index) => {
      const shared = [...keyTokens].filter((token) => tokens.has(token)).length
      if (shared / keyTokens.size >= OVERLAP_THRESHOLD) {
        indexes.add(index)
        matched = true
      }
    })
    if (!matched) unmatched.push(key)
  }
  return { indexes: [...indexes].sort((a, b) => a - b), unmatched }
}

// ---------------------------------------------------------------------------------------------
// The table and the description
// ---------------------------------------------------------------------------------------------

const orEmpty = (value: string): string =>
  value.trim() === '' ? t('graph.frameBesideDecision.empty') : value

function tableRows(
  frame: FramedRecordPayload,
  brief: FiledRecordPayload,
  addendum: string | null,
  turn: TurnRecordPayload | null,
  disrupted: readonly number[],
): Array<Array<string | number | null>> {
  const rows: Array<Array<string | number | null>> = [
    [
      t('graph.frameBesideDecision.rowStatement'),
      orEmpty(frame.decision),
      orEmpty(brief.recommendation),
    ],
    [t('graph.frameBesideDecision.rowPosition'), orEmpty(frame.position), orEmpty(brief.rationale)],
  ]
  for (let index = 0; index < 3; index += 1) {
    const label = t('graph.frameBesideDecision.rowAssumption', { number: index + 1 })
    rows.push([
      disrupted.includes(index)
        ? `${label} — ${t('graph.frameBesideDecision.disruptedMark')}`
        : label,
      orEmpty(frame.assumptions[index] ?? ''),
      orEmpty(brief.assumptions[index] ?? ''),
    ])
  }
  rows.push([t('graph.frameBesideDecision.rowChangeMyMind'), null, orEmpty(brief.change_my_mind)])
  rows.push([t('graph.frameBesideDecision.rowConfidence'), frame.confidence, brief.confidence])
  if (addendum !== null) {
    rows.push([t('graph.frameBesideDecision.rowAddendum'), null, orEmpty(addendum)])
  }
  if (turn !== null) {
    rows.push([t('graph.frameBesideDecision.rowTurn'), null, orEmpty(turn.text)])
    rows.push([
      t('graph.frameBesideDecision.rowTurnResponse'),
      null,
      turn.implicit
        ? t('graph.frameBesideDecision.responseImplicit')
        : turn.response === null
          ? t('graph.frameBesideDecision.responseNone')
          : `${RESPONSE_LABELS[turn.response]} — ${orEmpty(turn.justification ?? '')}`,
    ])
  }
  return rows
}

function describe(
  turn: TurnRecordPayload | null,
  disrupted: readonly number[],
  unmatched: readonly string[],
): string {
  const turnSentence =
    turn === null
      ? t('graph.frameBesideDecision.descriptionTurnNone')
      : turn.implicit || turn.response === null
        ? t('graph.frameBesideDecision.descriptionTurnImplicit')
        : t('graph.frameBesideDecision.descriptionTurn', {
            response: RESPONSE_LABELS[turn.response],
            confidence:
              turn.confidence === null
                ? t('graph.confidenceLine.confidenceMissing')
                : t('graph.confidenceLine.confidenceValue', { value: turn.confidence }),
          })

  const disruptedSentence =
    disrupted.length === 0
      ? t('graph.frameBesideDecision.descriptionDisruptedNone')
      : t('graph.frameBesideDecision.descriptionDisrupted', {
          count: disrupted.length,
          list: disrupted.map((index) => index + 1).join(', '),
        })
  const unmatchedSentence =
    unmatched.length === 0
      ? ''
      : t('graph.frameBesideDecision.descriptionUnmatched', {
          count: unmatched.length,
          list: unmatched.join(', '),
        })

  return t('graph.frameBesideDecision.description', {
    turn: turnSentence,
    disrupted: [disruptedSentence, unmatchedSentence].filter((part) => part !== '').join(' '),
  })
}

function unavailable(missing: readonly RunEventTypeValue[]): FrameBesideDecisionGraph {
  return {
    available: false,
    missing_event_types: [...missing],
    frame: null,
    brief: null,
    addendum: null,
    turn: null,
    disrupted_assumption_indexes: [],
    unmatched_disrupted_keys: [],
    data_table: { caption: t('graph.frameBesideDecision.caption'), columns: COLUMNS, rows: [] },
    description: t('graph.unavailableDescription', { types: missing.join(', ') }),
  }
}
