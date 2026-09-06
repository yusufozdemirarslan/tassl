// Question selection (docs/tech/10-backend-spec-modules.md §9; FR-025, FR-121, FR-122; D-080,
// D-076, D-106, D-135, D-339, D-340, D-342).
//
// Six to nine questions, drawn from the confirmed bank by conditions in the student's own run
// record, with the student's own claims, figures, stances and assumptions filled into the author's
// templates. Nothing here reads or writes anything: it is a pure function of the run's events, the
// package it was run on, and the bank — which is what makes every condition in
// `tests/unit/defense/selection.test.ts` assertable without a database, and what gives each
// rendered question the `selecting_event_seq` the replay reads it back by.
//
// WHY THE EVENTS AND NOT THE ROWS
//
// Every fact a condition needs is in the trace, and the trace is the only place all of them are in
// one order: which claims were relied on (`claim_used`, whatever the via), when each was first put
// in front of the student (`document_open`, `delegation`, `turn_delivered`), which stance changed
// after which action (`stance_set` and `action`, in sequence), the frame and the brief, and the Turn
// response. Reading `run_claims` instead would answer the same questions from a different set of
// rows and give the rendered question no event to name — and 10 §10 requires one
// (`defense_question.selecting_event_seq`).
//
// WHAT MAY NEVER DECIDE A QUESTION
//
// The selection output is a payload to audit, not only a feature to build. **Whether a question is
// selected, its kind, its position in the interview and its wording must not be a function of a
// claim's evidence status, its failure family, or whether it is the planted one.** Every input
// below is therefore either the student's own act or a field of the package that is identical
// across both variants:
//
//   * `consequence_level` and `importance` live on `scenario_claims`, which the two variants share
//     (PRD §7.18 (9): they "differ only in the evidence status and verification results of the
//     planted claim"). So does `source_document_id`, so does `carried_values`, and so do the
//     documents whose numbers FR-025 is checked against.
//   * `variant_claim_states` is not read here **at all** — not the warranted stance, not the
//     evidence status, not the failure family, not the planted flag, and not `verification_paths`.
//     The provenance condition asks whether the student *ran* a Source Trace, which is an act in
//     their own trace, and never whether one was available.
//   * The bank is per package version, not per variant, and the validator requires one provenance
//     and one verification question for every claim (`QUESTION_BANK_INCOMPLETE`), so the bank's
//     shape says nothing about which claim carries the defect either.
//
// The one thing the interview does reveal is which claims the author called consequential, and
// which of those are load-bearing — §9 asks for both by name, and neither differs between the two
// variants a student could have drawn, so neither can tell a student whether their run has a defect
// in it or where.
import { t } from '@/lib/i18n/t'
// The one definition of "the same number" in this codebase, and it is already FR-025's: the numeric
// guard exists because "a figure that matches no claim and no document is the assistant's
// assumption, and defending it is theirs" (`numeric-guard.ts`). A second normalizer here would let a
// figure be unsourced for the assistant and sourced for the defense.
import { normalizeNumber, numbersIn } from '@/server/llm/guardrails/numeric-guard'
// D-076's named-field matching, from the module that owns it. FR-025 is the other side of FR-101's
// coin — a figure that matches a claim is reliance on it, and a figure that matches none is the
// student's own assumption to defend — so a copy of the tolerance here would let one number be
// both. One pure file of another module, imported for one rule, is the resolution `reliance` and
// `trace` already make for `runs/clock.ts` (10 §10, D-286).
import {
  namedValueMatchesClaim,
  type CarriedValue,
  type ValueUnitValue,
} from '@/server/modules/reliance/matching'
import type { QuestionKindValue } from './schema'

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

/** Re-exported so a caller of this file names one type for a unit and one for a carried value. */
export type { CarriedValue, ValueUnitValue }

/** `run_claims.stance` / `scenario_claims` stances (06 §3.3). */
export type StanceValue = 'accept' | 'verify' | 'challenge' | 'reject' | 'escalate'

/**
 * One stored trace event, structurally.
 *
 * Declared here rather than imported from `trace` so this file stays a pure function of plain data
 * and a unit test can write one by hand. `trace.TraceRecordEvent` satisfies it.
 */
export type SelectionEvent = {
  seq: number
  type: string
  occurredAt: Date
  payload: Record<string, unknown>
}

/** One authored claim, in the fields a condition or a template may read. */
export type SelectionClaim = {
  id: string
  text: string
  sourceKind: string
  sourceDocumentId: string | null
  importance: 'load_bearing' | 'supporting'
  consequenceLevel: 'low' | 'medium' | 'high'
  carriedValues: readonly CarriedValue[]
  position: number
}

/** One Evidence Room document: its title, for `{document_title}`, and its body, for FR-025. */
export type SelectionDocument = { id: string; title: string; body: string }

/** One named numeric field of the Decision Brief (DATA-018). */
export type SelectionNamedField = {
  key: string
  label: string
  unit: ValueUnitValue
  position: number
}

/**
 * One row of the confirmed question bank, in the fields selection reads.
 *
 * `expectedAnswerNotes` is deliberately absent: it is the faculty seat's reading and this function
 * has no use for it, so the repository never loads it (12 §8's "pick, never delete"). `followUp` is
 * absent for the same reason — it is `answerQuestion`'s, not selection's.
 */
export type BankQuestion = {
  id: string
  kind: QuestionKindValue
  claimId: string | null
  assumptionIndex: number | null
  template: string
  condition: Record<string, unknown>
  isDefault: boolean
  position: number
}

export type SelectionInput = {
  /** The run's trace as written, in sequence order. */
  events: readonly SelectionEvent[]
  claims: readonly SelectionClaim[]
  documents: readonly SelectionDocument[]
  namedFields: readonly SelectionNamedField[]
  bank: readonly BankQuestion[]
}

/** One question the run record selected, rendered and ready to insert. */
export type SelectedQuestion = {
  questionId: string
  kind: QuestionKindValue
  renderedText: string
  /** The event the condition was read from; null for a `default` question, which reads none. */
  selectingEventSeq: number | null
}

// ---------------------------------------------------------------------------------------------
// Constants of the rule
// ---------------------------------------------------------------------------------------------

/** PRD §7.12: "Selection asks at least six and at most nine". */
export const QUESTIONS_MIN = 6
export const QUESTIONS_MAX = 9

/**
 * FR-121's "assumption departed from": the frame assumption's normalized tokens overlap the brief's
 * assumptions and the Turn justification by less than half.
 */
export const ASSUMPTION_OVERLAP_MIN = 0.5

/** The five placeholders 10 §9 step 4 fills (FR-122). */
const PLACEHOLDERS = ['claim_text', 'figure', 'stance', 'document_title', 'assumption'] as const
type Placeholder = (typeof PLACEHOLDERS)[number]

// ---------------------------------------------------------------------------------------------
// Reading a payload without trusting it
// ---------------------------------------------------------------------------------------------

const str = (payload: Record<string, unknown>, key: string): string | null =>
  typeof payload[key] === 'string' ? payload[key] : null

const num = (payload: Record<string, unknown>, key: string): number | null =>
  typeof payload[key] === 'number' ? payload[key] : null

const strings = (payload: Record<string, unknown>, key: string): string[] => {
  const value = payload[key]
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

const numbersByKey = (payload: Record<string, unknown>, key: string): Record<string, number> => {
  const value = payload[key]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) out[name] = entry
  }
  return out
}

const STANCES: readonly StanceValue[] = ['accept', 'verify', 'challenge', 'reject', 'escalate']

const stanceOf = (value: string | null): StanceValue | null =>
  value !== null && (STANCES as readonly string[]).includes(value) ? (value as StanceValue) : null

// ---------------------------------------------------------------------------------------------
// Normalization (FR-121's "normalized token overlap")
// ---------------------------------------------------------------------------------------------

/**
 * Words, lower-cased, with everything that is not a letter or a digit treated as a space.
 *
 * No stemming and no stop-word list. Both would be rules nobody wrote down, and both would move the
 * boundary of "departed from" in a way a student could not predict and an instructor could not
 * explain. Punctuation is dropped so "premium retention holds." and "premium retention holds"
 * overlap completely, which is the only difference a reader would not consider a difference.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
}

/**
 * The share of `subject`'s distinct tokens that appear anywhere in `corpus` (FR-121).
 *
 * An empty subject answers 1: an assumption with no words in it is not an assumption the brief
 * departed from, and asking a student to defend a departure from nothing would be a question about
 * a bug rather than about their run.
 */
export function tokenOverlap(subject: string, corpus: readonly string[]): number {
  const wanted = new Set(tokenize(subject))
  if (wanted.size === 0) return 1
  const seen = new Set(corpus.flatMap(tokenize))
  let hits = 0
  for (const token of wanted) if (seen.has(token)) hits += 1
  return hits / wanted.size
}

// ---------------------------------------------------------------------------------------------
// The run record, read out of the trace
// ---------------------------------------------------------------------------------------------

type FrameFact = { assumptions: string[]; confidence: number | null; seq: number }
type DecisionFact = {
  assumptions: string[]
  confidence: number | null
  namedValues: Record<string, number>
  seq: number
}
type TurnFact = { response: string; justification: string | null; implicit: boolean; seq: number }
type ActionFact = { type: string; at: Date; seq: number }
type StanceFact = {
  stance: StanceValue | null
  previous: StanceValue | null
  at: Date
  seq: number
}
type SurfacingFact = { at: Date; seq: number }

/** Everything the seven conditions read, in one pass over the trace. */
export type RunRecord = {
  frame: FrameFact | null
  decision: DecisionFact | null
  turn: TurnFact | null
  /** Claim id → the `claim_used` event that first made it relied on (FR-084's three routes). */
  reliedOn: Map<string, number>
  /** Claim id → when the run first put it in front of the student. */
  surfaced: Map<string, SurfacingFact>
  /** Claim id → every interrogation action run on it, in sequence order. */
  actions: Map<string, ActionFact[]>
  /** Claim id → the last `stance_set`, and the last one that changed a stance already taken. */
  stance: Map<string, StanceFact>
  changed: Map<string, StanceFact>
}

/**
 * Reads the run's record out of its own events.
 *
 * Surfacing has no event of its own — `run_claims` is written by `reliance.surfaceClaims`, which
 * three different acts call — so it is read from the three acts themselves: opening the document a
 * claim is sourced from (FR-031), a delegation that matched it, and the Turn's delivery. The first
 * of them in sequence order is when the student met the claim, which is the order 10 §9 puts the
 * provenance questions in.
 */
export function readRunRecord(
  events: readonly SelectionEvent[],
  claims: readonly SelectionClaim[],
): RunRecord {
  const record: RunRecord = {
    frame: null,
    decision: null,
    turn: null,
    reliedOn: new Map(),
    surfaced: new Map(),
    actions: new Map(),
    stance: new Map(),
    changed: new Map(),
  }

  const bySourceDocument = new Map<string, SelectionClaim[]>()
  for (const claim of claims) {
    if (claim.sourceKind !== 'document' || claim.sourceDocumentId === null) continue
    const list = bySourceDocument.get(claim.sourceDocumentId) ?? []
    list.push(claim)
    bySourceDocument.set(claim.sourceDocumentId, list)
  }

  const surface = (claimId: string, event: SelectionEvent): void => {
    if (record.surfaced.has(claimId)) return
    record.surfaced.set(claimId, { at: event.occurredAt, seq: event.seq })
  }

  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const payload = event.payload
    switch (event.type) {
      case 'frame_locked':
        record.frame = {
          assumptions: strings(payload, 'assumptions'),
          confidence: num(payload, 'confidence'),
          seq: event.seq,
        }
        break
      case 'decision_locked':
        record.decision = {
          assumptions: strings(payload, 'assumptions'),
          confidence: num(payload, 'confidence'),
          namedValues: numbersByKey(payload, 'named_values'),
          seq: event.seq,
        }
        break
      case 'turn_response_locked':
        record.turn = {
          response: str(payload, 'response') ?? 'hold',
          justification: str(payload, 'justification'),
          implicit: payload.implicit === true,
          seq: event.seq,
        }
        break
      case 'document_open': {
        const documentId = str(payload, 'document_id')
        if (documentId === null) break
        for (const claim of bySourceDocument.get(documentId) ?? []) surface(claim.id, event)
        break
      }
      case 'delegation':
        for (const claimId of strings(payload, 'claim_ids')) surface(claimId, event)
        break
      case 'turn_delivered':
        for (const claimId of strings(payload, 'window_claim_ids')) surface(claimId, event)
        break
      case 'claim_used': {
        const claimId = str(payload, 'claim_id')
        if (claimId === null) break
        surface(claimId, event)
        if (!record.reliedOn.has(claimId)) record.reliedOn.set(claimId, event.seq)
        break
      }
      case 'stance_set': {
        const claimId = str(payload, 'claim_id')
        if (claimId === null) break
        surface(claimId, event)
        const fact: StanceFact = {
          stance: stanceOf(str(payload, 'stance')),
          previous: stanceOf(str(payload, 'previous_stance')),
          at: event.occurredAt,
          seq: event.seq,
        }
        record.stance.set(claimId, fact)
        if (fact.previous !== null) record.changed.set(claimId, fact)
        break
      }
      case 'action': {
        const claimId = str(payload, 'claim_id')
        const type = str(payload, 'type')
        if (claimId === null || type === null) break
        surface(claimId, event)
        const list = record.actions.get(claimId) ?? []
        list.push({ type, at: event.occurredAt, seq: event.seq })
        record.actions.set(claimId, list)
        break
      }
      default:
        break
    }
  }

  return record
}

// ---------------------------------------------------------------------------------------------
// Rendering (10 §9 step 4, FR-122)
// ---------------------------------------------------------------------------------------------

/** `{figure}`: the student's own number in the author's own unit (D-342). */
export function formatFigure(value: number, unit: ValueUnitValue): string {
  const params = { value: String(value) }
  switch (unit) {
    case 'percent':
      return t('defense.figurePercent', params)
    case 'months':
      return t('defense.figureMonths', params)
    case 'usd':
      return t('defense.figureUsd', params)
    case 'ratio':
      return t('defense.figureRatio', params)
    case 'count':
      return t('defense.figureCount', params)
    default:
      return t('defense.figureOther', params)
  }
}

/** `{stance}`: the stance the student ended on, in the vocabulary every other screen uses. */
export function formatStance(stance: StanceValue): string {
  return t(`stance.${stance}`)
}

/**
 * Fills an author's template with the run's own values.
 *
 * A placeholder with no value becomes the empty string and the surrounding whitespace is collapsed.
 * Two alternatives were worse: leaving `{document_title}` on the screen shows a student the
 * machinery, and substituting a phrase of our own would put words the author did not write into a
 * question they confirmed. The bank is validated for the one placeholder that must be there
 * (`{figure}` on the figure-provenance question, D-135), and every other one is the author's choice
 * on a question they wrote for a claim that has the value.
 */
export function renderTemplate(
  template: string,
  values: Partial<Record<Placeholder, string | undefined>>,
): string {
  let text = template
  for (const name of PLACEHOLDERS) {
    text = text.split(`{${name}}`).join(values[name] ?? '')
  }
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([.,;:!?])/g, '$1')
    .trim()
}

// ---------------------------------------------------------------------------------------------
// The seven conditions (10 §9 step 1)
// ---------------------------------------------------------------------------------------------

type Candidate = SelectedQuestion

/** The bank's questions of one kind, in the author's own order. */
const ofKind = (bank: readonly BankQuestion[], kind: QuestionKindValue): BankQuestion[] =>
  bank.filter((question) => question.kind === kind).sort((a, b) => a.position - b.position)

const firstOfKind = (
  bank: readonly BankQuestion[],
  kind: QuestionKindValue,
  match: (question: BankQuestion) => boolean = () => true,
): BankQuestion | undefined => ofKind(bank, kind).find(match)

/**
 * The candidates, in 10 §9's order.
 *
 * The order is the rule and not a detail: it is what survives the cut at nine, so a run that met
 * every condition is asked about its provenance and its figures before it is asked about its
 * confidence. Within `provenance` it is load-bearing first and then by surfaced time, which puts the
 * claim the decision rests on at the top of the interview.
 */
export function candidatesFor(input: SelectionInput, record: RunRecord): Candidate[] {
  const { bank, claims, documents, namedFields } = input
  const claimById = new Map(claims.map((claim) => [claim.id, claim]))
  const titleById = new Map(documents.map((document) => [document.id, document.title]))
  const out: Candidate[] = []

  const documentTitleOf = (claim: SelectionClaim): string | undefined =>
    claim.sourceDocumentId === null ? undefined : titleById.get(claim.sourceDocumentId)

  const stanceTextOf = (claimId: string): string | undefined => {
    const stance = record.stance.get(claimId)?.stance
    return stance ? formatStance(stance) : undefined
  }

  // 1. `provenance` — a consequential claim the decision leant on, with no Source Trace behind it.
  const reliedOnClaims = claims
    .filter((claim) => claim.consequenceLevel !== 'low' && record.reliedOn.has(claim.id))
    .filter(
      (claim) =>
        !(record.actions.get(claim.id) ?? []).some((action) => action.type === 'source_trace'),
    )
    .sort((a, b) => {
      const weight = (claim: SelectionClaim) => (claim.importance === 'load_bearing' ? 0 : 1)
      if (weight(a) !== weight(b)) return weight(a) - weight(b)
      // Surfaced time, and the surfacing event's own sequence as the tie-break, so two claims
      // surfaced by one delegation are ordered by nothing more than the order they were written in.
      const at = (claim: SelectionClaim) => record.surfaced.get(claim.id)
      const left = at(a)
      const right = at(b)
      if (!left || !right) return left ? -1 : right ? 1 : a.position - b.position
      return left.at.getTime() - right.at.getTime() || left.seq - right.seq
    })

  for (const claim of reliedOnClaims) {
    const question = firstOfKind(bank, 'provenance', (entry) => entry.claimId === claim.id)
    if (!question) continue
    out.push({
      questionId: question.id,
      kind: 'provenance',
      renderedText: renderTemplate(question.template, {
        claim_text: claim.text,
        document_title: documentTitleOf(claim),
        stance: stanceTextOf(claim.id),
      }),
      selectingEventSeq: record.reliedOn.get(claim.id) ?? null,
    })
  }

  // 2. `figure_provenance` — FR-025: a figure in the brief that matches no claim and no document.
  const documentNumbers = new Set(documents.flatMap((document) => numbersIn(document.body)))
  const figureQuestion = firstOfKind(bank, 'figure_provenance', (entry) => entry.claimId === null)
  const namedValues = record.decision?.namedValues ?? {}
  if (figureQuestion) {
    for (const field of [...namedFields].sort((a, b) => a.position - b.position)) {
      const value = namedValues[field.key]
      if (value === undefined) continue
      const matchesClaim = claims.some((claim) =>
        namedValueMatchesClaim(field.key, value, field.unit, claim.carriedValues),
      )
      if (matchesClaim) continue
      if (documentNumbers.has(normalizeNumber(String(value)))) continue
      out.push({
        questionId: figureQuestion.id,
        kind: 'figure_provenance',
        renderedText: renderTemplate(figureQuestion.template, {
          figure: formatFigure(value, field.unit),
        }),
        selectingEventSeq: record.decision?.seq ?? null,
      })
    }
  }

  // 3. `verification` — a stance that changed, with an interrogation action before the change.
  const changed = [...record.changed.entries()]
    .filter(([claimId, fact]) =>
      (record.actions.get(claimId) ?? []).some((action) => action.at.getTime() < fact.at.getTime()),
    )
    .sort(([, a], [, b]) => a.seq - b.seq)

  for (const [claimId, fact] of changed) {
    const claim = claimById.get(claimId)
    const question = firstOfKind(bank, 'verification', (entry) => entry.claimId === claimId)
    if (!claim || !question) continue
    out.push({
      questionId: question.id,
      kind: 'verification',
      renderedText: renderTemplate(question.template, {
        claim_text: claim.text,
        document_title: documentTitleOf(claim),
        stance: fact.stance ? formatStance(fact.stance) : undefined,
      }),
      selectingEventSeq: fact.seq,
    })
  }

  // 4. `assumption` — a frame assumption the brief and the Turn justification departed from, or all
  //    three when the response was a reversal (FR-121: a reversal departs from the whole frame).
  const frame = record.frame
  if (frame) {
    const corpus = [...(record.decision?.assumptions ?? []), record.turn?.justification ?? '']
    const reversed = record.turn?.response === 'reverse'
    frame.assumptions.forEach((assumption, index) => {
      const departed = reversed || tokenOverlap(assumption, corpus) < ASSUMPTION_OVERLAP_MIN
      if (!departed) return
      const question = firstOfKind(bank, 'assumption', (entry) => entry.assumptionIndex === index)
      if (!question) return
      out.push({
        questionId: question.id,
        kind: 'assumption',
        renderedText: renderTemplate(question.template, { assumption }),
        selectingEventSeq: frame.seq,
      })
    })
  }

  // 5. `confidence` — D-080: confidence at the lock strictly above confidence at the frame.
  const frameConfidence = frame?.confidence ?? null
  const lockConfidence = record.decision?.confidence ?? null
  if (frameConfidence !== null && lockConfidence !== null && lockConfidence > frameConfidence) {
    const question = firstOfKind(bank, 'confidence')
    if (question) {
      out.push({
        questionId: question.id,
        kind: 'confidence',
        renderedText: renderTemplate(question.template, {}),
        selectingEventSeq: record.decision?.seq ?? null,
      })
    }
  }

  // 6. `frame_vs_response` — D-106: only when the student filed a response. An implicit hold is the
  //    window closing on nobody, and there is no revision to compare the frame with.
  if (record.turn && !record.turn.implicit) {
    const question = firstOfKind(bank, 'frame_vs_response')
    if (question) {
      out.push({
        questionId: question.id,
        kind: 'frame_vs_response',
        renderedText: renderTemplate(question.template, {}),
        selectingEventSeq: record.turn.seq,
      })
    }
  }

  // 7. `counterfactual` — the question moves a figure the student committed to (PRD §7.18 (12)), so
  //    it is asked when they committed one. D-339 says how a bank question names its field.
  for (const question of ofKind(bank, 'counterfactual')) {
    const fieldKey =
      typeof question.condition.named_field_key === 'string'
        ? question.condition.named_field_key
        : null
    const field = namedFields.find((entry) => entry.key === fieldKey)
    const value = fieldKey === null ? undefined : namedValues[fieldKey]
    const entered = fieldKey === null ? Object.keys(namedValues).length > 0 : value !== undefined
    if (!entered) continue
    out.push({
      questionId: question.id,
      kind: 'counterfactual',
      renderedText: renderTemplate(question.template, {
        figure: value !== undefined && field ? formatFigure(value, field.unit) : undefined,
      }),
      selectingEventSeq: record.decision?.seq ?? null,
    })
  }

  return out
}

// ---------------------------------------------------------------------------------------------
// The selection (10 §9 steps 2 and 3)
// ---------------------------------------------------------------------------------------------

/**
 * Six to nine questions for one run (FR-121).
 *
 * Take the first nine of the candidates in condition order; if fewer than six conditions held, fill
 * from the bank's `default` questions in the author's own position order until there are six. The
 * fill is what makes the floor a promise rather than a hope: a student who opened nothing, relied on
 * nothing and let the window close still faces six questions, and the questions they face are the
 * ones the author wrote for exactly that run.
 *
 * A bank with fewer than six defaults produces fewer than six questions rather than an error. The
 * validator refuses to confirm such a package (`QUESTION_BANK_INCOMPLETE`), so this is unreachable
 * through the product; a defense with four questions is a worse outcome than a run that cannot open
 * its defense at all, but only just, and it is the one that keeps the student's run moving.
 */
export function selectQuestions(input: SelectionInput): SelectedQuestion[] {
  const record = readRunRecord(input.events, input.claims)
  const selected = candidatesFor(input, record).slice(0, QUESTIONS_MAX)

  if (selected.length >= QUESTIONS_MIN) return selected

  const chosen = new Set(selected.map((question) => question.questionId))
  for (const question of ofKind(input.bank, 'default')) {
    if (selected.length >= QUESTIONS_MIN) break
    if (chosen.has(question.id)) continue
    chosen.add(question.id)
    selected.push({
      questionId: question.id,
      kind: 'default',
      renderedText: renderTemplate(question.template, {}),
      selectingEventSeq: null,
    })
  }

  return selected
}
