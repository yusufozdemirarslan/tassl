// Graph 3 of 4 — the stance matrix (FR-134, FR-082, FR-063; 10-backend-spec-modules.md §11.1;
// D-107). Verification and Calibration are read off it, and the False Challenge Rate is computed
// from it (PRD §7.13, §10).
//
// One row per consequential claim in the run's variant, the stance taken against the stance
// warranted under the authored conditions, and beneath the rows a five-by-five summary and the
// rate. Three things about the arithmetic are easy to get wrong and are therefore stated here.
//
// **The denominator is every consequential claim in the variant, surfaced or not (D-107).** FR-134
// spells it "divided by the count of consequential claims in the run", and PRD §6 fixes the
// arithmetic it has to reproduce: Marco's eight false alarms over eleven claims is 73 percent. A
// denominator of *met* claims would make the rate a function of how much of the scenario a student
// happened to see, so two students with the same eight false alarms would get different rates. An
// unsurfaced claim is a row with `surfaced: false` and `stance_taken: null`: a defect never met is
// neither a match nor a false challenge, and it still counts in the denominator.
//
// **A false challenge is about the claim's authored state, not about the student's confidence.**
// It is a claim whose evidence status is `sound` and whose warranted stance is accept or verify,
// that the student stanced challenge or reject. Proportionality is already carried by the warranted
// stance, "so no separate judgment of disproportion enters the computation" (PRD §7.13). Escalate
// is not a false challenge: it is a statement about the student's own competence (FR-092), and it
// is read by the Calibration rules separately.
//
// **A neutralized claim leaves the summary and the rate, and keeps its row (FR-003).** The faculty
// seat neutralizes a claim that turned out to be defective by accident; the row stays visible in
// the debrief, struck through, because the student did something on it and deserves to see what.
// `credit_challenge` on the neutralization makes the row a match whatever stance it carries.
import { t } from '@/lib/i18n/t'
import type { RunEventTypeValue } from '@/server/modules/trace/schema'
import {
  eventsOfType,
  firstOfType,
  missingEventTypes,
  percent,
  rate3,
  STANCES,
  type ActionTypeValue,
  type ClaimImportanceValue,
  type EvidenceStatusValue,
  type GraphBase,
  type GraphInput,
  type StanceValue,
} from './types'

/** How the claim first reached the student (06 §3.4 `run_claims.surfaced_by`; FR-063). */
export type SurfacedByValue = 'delegation' | 'document' | 'turn' | 'student'

/** The interrogation action that ran immediately before the stance was set (FR-080). */
export type PrecedingAction = { action_id: string; type: ActionTypeValue; at: string }

/** The Readiness Check result on the concept this claim turns on (FR-012). Context, never an input. */
export type ReadinessContext = { concept_key: string; correct: boolean | null }

export type StanceMatrixRow = {
  claim_id: string
  key: string
  text: string
  surfaced: boolean
  surfaced_by: SurfacedByValue | null
  surfaced_by_id: string | null
  surfaced_at: string | null
  stance_taken: StanceValue | null
  stance_taken_at: string | null
  previous_stance: StanceValue | null
  preceding_action: PrecedingAction | null
  evidence_status: EvidenceStatusValue
  importance: ClaimImportanceValue
  load_bearing: boolean
  warranted_stance: StanceValue
  readiness_context: ReadinessContext | null
  relied_on: boolean
  neutralized: boolean
  inconsistency_credited: boolean
  /** FR-087: the stance record was lost, so this row cannot be read as a stance either way. */
  stance_record_lost: boolean
  match: boolean
}

export type StanceMatrixGraph = GraphBase & {
  rows: StanceMatrixRow[]
  /** `summary[taken][warranted]`, both indexed by `STANCES`, over non-neutralized rows. */
  summary: number[][]
  false_challenge_rate: number | null
  /** The numerator behind the rate: sound claims warranting reliance that were challenged. */
  false_challenge_count: number
  /**
   * The denominator behind the rate — every consequential claim in the variant minus the
   * neutralized ones, surfaced or not (D-107). It is carried beside the rate because "0.727" alone
   * cannot be checked, and because the debrief and the export both show the arithmetic (PRD §12).
   */
  consequential_claim_count: number
  matched_share: number | null
}

/**
 * What Step 10.1's export and the scoring pipeline read when they want the rate and nothing else
 * (10 §10 computed block). The counts travel with it because "0.727" on its own cannot be checked,
 * and the export shows the arithmetic PRD §12 asks for.
 */
export type FalseChallengeRate = {
  /** Three decimals, or null when the variant carries no assessable consequential claim. */
  rate: number | null
  false_challenges: number
  denominator: number
  false_challenge_claim_ids: string[]
}

/** The matrix is the record of a decision, so it needs the decision to have been filed. */
const REQUIRED: readonly RunEventTypeValue[] = ['decision_locked']

const STANCE_LABELS: Record<StanceValue, string> = {
  accept: t('stance.accept'),
  verify: t('stance.verify'),
  challenge: t('stance.challenge'),
  reject: t('stance.reject'),
  escalate: t('stance.escalate'),
}

const COLUMNS = [
  t('graph.stanceMatrix.columnClaim'),
  t('graph.stanceMatrix.columnText'),
  t('graph.stanceMatrix.columnSurfaced'),
  t('graph.stanceMatrix.columnTaken'),
  t('graph.stanceMatrix.columnTakenAt'),
  t('graph.stanceMatrix.columnPreviousStance'),
  t('graph.stanceMatrix.columnPrecedingAction'),
  t('graph.stanceMatrix.columnWarranted'),
  t('graph.stanceMatrix.columnEvidence'),
  t('graph.stanceMatrix.columnImportance'),
  t('graph.stanceMatrix.columnReadiness'),
  t('graph.stanceMatrix.columnReliedOn'),
  t('graph.stanceMatrix.columnNeutralized'),
  t('graph.stanceMatrix.columnMatch'),
]

const CHALLENGING: readonly StanceValue[] = ['challenge', 'reject']
const WARRANTS_RELIANCE: readonly StanceValue[] = ['accept', 'verify']

// ---------------------------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------------------------

export function buildStanceMatrix(input: GraphInput): StanceMatrixGraph {
  const missing = missingEventTypes(input.events, REQUIRED)
  const rows = buildRows(input)
  const live = rows.filter((row) => !row.neutralized)

  const summary = STANCES.map((taken) =>
    STANCES.map(
      (warranted) =>
        live.filter((row) => row.stance_taken === taken && row.warranted_stance === warranted)
          .length,
    ),
  )
  const fcr = rateFrom(rows)
  const matched = rate3(live.filter((row) => row.match).length, live.length)

  const base = {
    rows,
    summary,
    false_challenge_rate: fcr.rate,
    false_challenge_count: fcr.false_challenges,
    consequential_claim_count: fcr.denominator,
    matched_share: matched,
    data_table: {
      caption: t('graph.stanceMatrix.caption'),
      columns: COLUMNS,
      rows: rows.map(tableRow),
    },
  }
  if (missing.length > 0) {
    return {
      ...base,
      available: false,
      missing_event_types: missing,
      description: t('graph.unavailableDescription', { types: missing.join(', ') }),
    }
  }
  return {
    ...base,
    available: true,
    missing_event_types: [],
    description: describe(rows, live, summary, fcr, matched),
  }
}

/**
 * The False Challenge Rate and the counts behind it (FR-134, D-107).
 *
 * Exported on its own because the trace export's computed block needs the number without the graph
 * (10 §10): `buildStanceMatrix(input).false_challenge_rate` is the same value.
 */
export function falseChallengeRate(input: GraphInput): FalseChallengeRate {
  return rateFrom(buildRows(input))
}

function rateFrom(rows: readonly StanceMatrixRow[]): FalseChallengeRate {
  // D-107: every consequential claim in the variant, minus the neutralized ones. Unsurfaced claims
  // stay in, which is what keeps the rate independent of how much of the scenario was met.
  const denominator = rows.filter((row) => !row.neutralized)
  const falseChallenges = denominator.filter(
    (row) =>
      row.evidence_status === 'sound' &&
      WARRANTS_RELIANCE.includes(row.warranted_stance) &&
      row.stance_taken !== null &&
      CHALLENGING.includes(row.stance_taken),
  )
  return {
    rate: rate3(falseChallenges.length, denominator.length),
    false_challenges: falseChallenges.length,
    denominator: denominator.length,
    false_challenge_claim_ids: falseChallenges.map((row) => row.claim_id),
  }
}

// ---------------------------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------------------------

function buildRows(input: GraphInput): StanceMatrixRow[] {
  const { events, packageVersion, variantStates } = input
  const stateByClaim = new Map(variantStates.map((state) => [state.claimId, state] as const))

  const delegations = eventsOfType(events, 'delegation')
  const opens = eventsOfType(events, 'document_open')
  const turn = firstOfType(events, 'turn_delivered')
  const stances = eventsOfType(events, 'stance_set')
  const actions = eventsOfType(events, 'action')
  const escalations = eventsOfType(events, 'escalation')
  const used = eventsOfType(events, 'claim_used')
  const neutralizations = eventsOfType(events, 'claim_neutralized')

  // The Readiness Check result per concept (FR-012). An unanswered item carries `correct: null`,
  // and a skipped check leaves no `readiness_item` events at all — both read back as context that
  // could not be established, never as a fact about the claim.
  const readinessByConcept = new Map<string, boolean | null>()
  for (const item of eventsOfType(events, 'readiness_item')) {
    readinessByConcept.set(item.payload.concept_key, item.payload.correct)
  }

  const actionsById = new Map(actions.map((event) => [event.payload.action_id, event] as const))

  return packageVersion.claims.map((claim): StanceMatrixRow => {
    const state = stateByClaim.get(claim.id)

    // How the claim first reached the student, from the trace alone: the delegation that carried
    // it, the document that holds it (a `document` claim is surfaced by opening its document —
    // `reliance.surfaceDocumentClaims` writes the row inside the `document_open` transaction), or
    // the Turn window. A claim named by no such event but touched by a stance or an action is
    // recorded surfaced with no attribution rather than dropped.
    const delegation = delegations.find((event) => event.payload.claim_ids.includes(claim.id))
    const open =
      claim.sourceKind === 'document' && claim.sourceDocumentId !== null
        ? opens.find((event) => event.payload.document_id === claim.sourceDocumentId)
        : undefined
    const inTurn = turn?.payload.window_claim_ids.includes(claim.id) === true ? turn : undefined
    const touched = [...stances, ...actions, ...escalations, ...used].filter(
      (event) => event.payload.claim_id === claim.id,
    )
    const candidates: Array<{
      seq: number
      by: SurfacedByValue | null
      id: string | null
      at: string
    }> = []
    if (delegation) {
      candidates.push({
        seq: delegation.seq,
        by: 'delegation',
        id: delegation.payload.delegation_id,
        at: delegation.occurredAt,
      })
    }
    if (open) {
      candidates.push({
        seq: open.seq,
        by: 'document',
        id: open.payload.document_id,
        at: open.occurredAt,
      })
    }
    if (inTurn) {
      candidates.push({
        seq: inTurn.seq,
        by: 'turn',
        id: inTurn.payload.turn_id,
        at: inTurn.occurredAt,
      })
    }
    for (const event of touched)
      candidates.push({ seq: event.seq, by: null, id: null, at: event.occurredAt })
    candidates.sort((a, b) => a.seq - b.seq)
    const first = candidates[0]

    const claimStances = stances.filter((event) => event.payload.claim_id === claim.id)
    const last = claimStances[claimStances.length - 1]
    const precedingActionId = last?.payload.action_ids[last.payload.action_ids.length - 1]
    const precedingAction = precedingActionId ? actionsById.get(precedingActionId) : undefined

    const neutralization = neutralizations.find((event) => event.payload.claim_id === claim.id)
    const credited = neutralization?.payload.credit_challenge === true
    const warranted = state?.warrantedStance ?? 'accept'
    const taken = last?.payload.stance ?? null

    return {
      claim_id: claim.id,
      key: claim.key,
      text: claim.text,
      surfaced: first !== undefined,
      surfaced_by: first?.by ?? null,
      surfaced_by_id: first?.id ?? null,
      surfaced_at: first?.at ?? null,
      stance_taken: taken,
      stance_taken_at: last?.occurredAt ?? null,
      previous_stance: last?.payload.previous_stance ?? null,
      preceding_action: precedingAction
        ? {
            action_id: precedingAction.payload.action_id,
            type: precedingAction.payload.type,
            at: precedingAction.occurredAt,
          }
        : null,
      evidence_status: state?.evidenceStatus ?? 'sound',
      importance: claim.importance,
      load_bearing: claim.importance === 'load_bearing',
      warranted_stance: warranted,
      readiness_context: readinessByConcept.has(claim.conceptKey)
        ? {
            concept_key: claim.conceptKey,
            correct: readinessByConcept.get(claim.conceptKey) ?? null,
          }
        : null,
      relied_on: used.some((event) => event.payload.claim_id === claim.id),
      neutralized: neutralization !== undefined,
      inconsistency_credited: credited,
      stance_record_lost: neutralization?.payload.reason === 'record_lost',
      match: credited || (taken !== null && taken === warranted),
    }
  })
}

// ---------------------------------------------------------------------------------------------
// The table and the description
// ---------------------------------------------------------------------------------------------

function readinessLabel(context: ReadinessContext | null): string {
  if (context === null) return t('graph.stanceMatrix.readinessNone')
  if (context.correct === null) {
    return t('graph.stanceMatrix.readinessUnanswered', { concept: context.concept_key })
  }
  return context.correct
    ? t('graph.stanceMatrix.readinessCorrect', { concept: context.concept_key })
    : t('graph.stanceMatrix.readinessIncorrect', { concept: context.concept_key })
}

const yesNo = (value: boolean): string =>
  value ? t('graph.stanceMatrix.yes') : t('graph.stanceMatrix.no')

function tableRow(row: StanceMatrixRow): Array<string | number | null> {
  return [
    row.key,
    row.text,
    row.surfaced ? yesNo(true) : t('graph.stanceMatrix.notSurfaced'),
    row.stance_taken === null ? t('graph.stanceMatrix.noStance') : STANCE_LABELS[row.stance_taken],
    row.stance_taken_at,
    row.previous_stance === null ? null : STANCE_LABELS[row.previous_stance],
    row.preceding_action === null ? null : row.preceding_action.type,
    STANCE_LABELS[row.warranted_stance],
    row.evidence_status === 'sound'
      ? t('graph.stanceMatrix.evidenceSound')
      : t('graph.stanceMatrix.evidenceDefective'),
    row.load_bearing
      ? t('graph.stanceMatrix.importanceLoadBearing')
      : t('graph.stanceMatrix.importanceSupporting'),
    readinessLabel(row.readiness_context),
    yesNo(row.relied_on),
    yesNo(row.neutralized),
    row.inconsistency_credited ? t('graph.stanceMatrix.creditedMatch') : yesNo(row.match),
  ]
}

function describe(
  rows: readonly StanceMatrixRow[],
  live: readonly StanceMatrixRow[],
  summary: readonly number[][],
  fcr: FalseChallengeRate,
  matched: number | null,
): string {
  const neutralized = rows.length - live.length
  const head = t('graph.stanceMatrix.description', {
    claims: rows.length,
    surfaced: rows.filter((row) => row.surfaced).length,
    stanced: rows.filter((row) => row.stance_taken !== null).length,
    matched: live.filter((row) => row.match).length,
    fcr: fcr.rate === null ? 0 : percent(fcr.rate),
    falseChallenges: fcr.false_challenges,
    denominator: fcr.denominator,
    neutralized:
      neutralized > 0
        ? t('graph.stanceMatrix.descriptionNeutralized', { count: neutralized })
        : t('graph.stanceMatrix.descriptionNoNeutralized'),
  })

  // The five-by-five summary in words. A screen-reader user reads the same counts a sighted reader
  // sees in the grid; only the non-zero cells are spoken, because twenty-five "0"s are noise.
  const cells: string[] = []
  STANCES.forEach((taken, i) => {
    STANCES.forEach((warranted, j) => {
      const count = summary[i]?.[j] ?? 0
      if (count === 0) return
      cells.push(
        t('graph.stanceMatrix.summaryCell', {
          taken: STANCE_LABELS[taken],
          warranted: STANCE_LABELS[warranted],
          count,
        }),
      )
    })
  })
  const share =
    matched === null
      ? ''
      : t('graph.stanceMatrix.descriptionMatched', { percent: percent(matched) })
  const summarySentences = cells.length > 0 ? `${cells.join('. ')}.` : ''
  return [head, summarySentences, share].filter((part) => part !== '').join(' ')
}
