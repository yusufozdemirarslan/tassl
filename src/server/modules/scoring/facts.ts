// Step three of the scoring pipeline — the categorical facts (10-backend-spec-modules.md §11.2).
//
// Trace → graphs → **facts** → reads → bands → points. Everything a band rule may decide *without*
// a model lives here, and it is computed the same way the graphs are: from the run's own events,
// the authored package version and the variant's claim states, and from nothing else (PRD §7.13).
// A fact is therefore reproducible, arguable and quotable — every one of them can be pointed at a
// list of trace event sequences, which is what `run_bands.evidence_event_seqs` carries and what
// makes a band something a student can appeal against rather than an opinion (FR-137, FR-153).
//
// Three properties this module keeps, each of which a shortcut would break.
//
//   * **Pure and total.** No database handle, no clock, no session, and no throw. A run that wrote
//     none of the events a fact is drawn from produces the empty answer for that fact — zero
//     actions, no Turn response, `no_turn` — never an exception. What an absent fact *means* is a
//     band rule's decision, not this file's (FR-004: unassessed, never estimated).
//   * **Facts describe; they never judge.** Nothing here returns a band, and nothing is named
//     good or bad. `misreadTrace` counts the traces that ended in an accept on a defective claim;
//     whether that is Developing is `bands.ts`, and whether it stands is the instructor's.
//   * **The answer key is read, never leaked.** Facts are computed from warranted stances, evidence
//     status and planted flags, so like the graphs they are a reviewer artifact end to end: nothing
//     in this file may reach a student payload before the run is scored
//     (`src/server/auth/student-view.ts`, `trace/owner-view.ts`).
//
// The False Challenge Rate is *not* recomputed here. Step 10.2's stance matrix owns it, including
// D-107's denominator of every consequential claim in the variant whether or not the student ever
// met it; this file consumes `falseChallengeRate` and adds only the question the rate cannot
// answer on its own — which of the false challenges fell on a claim a challenge was defensible on
// (Appendix A.4's Developing-to-Proficient boundary).
import type { RunEventTypeValue } from '@/server/modules/trace/schema'
import { SPEED_OUTLIER_MS } from './constants'
import {
  buildGraphs,
  falseChallengeRate,
  type GraphInput,
  type RunGraphs,
  type StanceMatrixRow,
} from './graphs'
import { eventsOfType, firstOfType, lastOfType, rate3, type TypedEvent } from './graphs/types'
import type { Dimension } from './rubric'

// ---------------------------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------------------------

/**
 * What the three confidence points say about each other (10 §11.2; PRD §7.8).
 *
 * `flat_50` and `flat_100` are the two shapes PRD §7.8 names by hand — "Flat 50 percent is
 * uninformative and scores as poorly as a badly miscalibrated line" and constant 100 percent is
 * "answered by showing the student their own confidence line". `rising_unchecked` is Nadia's run
 * one: confidence up from the frame to the lock while the claims she leant on were mostly ones she
 * had not checked. `other` is every line that is none of those, which is not a finding either way —
 * PRD §7.13 and A.4 fix no band for the confidence line by itself.
 */
export type ConfidenceShape = 'flat_50' | 'flat_100' | 'rising_unchecked' | 'other'

/**
 * The Turn response against the Turn's authored warrant (10 §11.2; PRD §7.11, FR-115).
 *
 * `implicit_hold_ok` and `implicit_hold_failed` are the two halves of FR-115's unanswered window:
 * the same silence is the proportionate response to a Turn that warranted no change and a failure
 * to adapt to one that did. `no_turn` and `no_response` are absences, not placements — a run with
 * neither has no Adaptation evidence at all and the dimension is unassessed (FR-004).
 */
export type ResponseVsWarrant =
  | 'match'
  | 'over_adaptation'
  | 'under_adaptation'
  | 'implicit_hold_ok'
  | 'implicit_hold_failed'
  | 'no_response'
  | 'no_turn'

/** What FR-087's one-third rule makes of the stance records this run lost. */
export type StanceRecordLoss = 'none' | 'dimensions_unassessed' | 'unscoreable'

export type CategoricalFacts = {
  // -------------------------------------------------------------------------------------------
  // The defects the variant carries and what became of them
  // -------------------------------------------------------------------------------------------
  /** Consequential claims the variant authored as defective, neutralized ones excluded. */
  defectsInVariant: number
  /** Of those, the ones the student ever met (FR-063). */
  defectsSurfaced: number
  /** 10 §11.2: stance in {challenge, reject, escalate}, or an action ran and the stance is not accept. */
  defectsKeptFromDecision: number
  /** Defects that were neither kept nor left alone: accepted *and* relied on (A.4's "unexamined"). */
  defectsReachedDecision: number
  /** Defects an interrogation action was actually run on (A.3's "surfaced by a check"). */
  defectsSurfacedByCheck: number
  /** True when the variant authored no defective consequential claim: nothing to catch (A.3, A.4). */
  defectFree: boolean
  /** Every defect kept from the decision — the condition A.4 puts under Proficient and Professional. */
  allDefectsKeptFromDecision: boolean

  // -------------------------------------------------------------------------------------------
  // The checks (A.3)
  // -------------------------------------------------------------------------------------------
  actionCount: number
  actionsOnLoadBearing: number
  /** 10 §11.2: actions on claims whose warranted stance is `accept` — a check nothing asked for. */
  actionsOnNonWarranting: number
  actionsOnReliedOn: number
  /** Claims finally stanced `verify` with no action behind it (PRD §7.8: asserted verification). */
  assertedVerification: number
  /** A Source Trace on a defective claim that ended in accept: right action, wrong conclusion (FR-075). */
  misreadTrace: number

  // -------------------------------------------------------------------------------------------
  // Escalation (A.4; PRD §7.9)
  // -------------------------------------------------------------------------------------------
  escalationCount: number
  /** 10 §11.2 as written: escalated claims whose concept the Readiness Check showed held. */
  escalationsInsideCompetence: number
  /**
   * The same count over *sound* claims only, which is what the A.4 rules read.
   *
   * PRD §7.8's "escalations inside demonstrated competence score as under-confidence" is about
   * spending an escalation on something the student could have evaluated themselves. An escalation
   * that lands on a defect is the opposite act: §7.9 fixes "both consequential defects escalated"
   * at the *top* of Calibration, "since what matters is that they never reached the decision". A
   * fixed placement outranks a boundary sentence the editor proposed (A.0), so the narrower count
   * is what `bands.ts` reads and the literal one above is what the debrief reports.
   */
  escalationsInsideCompetenceOnSoundClaims: number

  // -------------------------------------------------------------------------------------------
  // Reliance across the run (A.4)
  // -------------------------------------------------------------------------------------------
  /** Every stance the run recorded was accept (PRD §7.8's "accept everything"). */
  acceptEverything: boolean
  /** The False Challenge Rate from the stance matrix, three decimals, D-107's denominator. */
  fcr: number | null
  falseChallengeCount: number
  falseChallengeClaimIds: string[]
  /**
   * The false challenges A.4's Developing-to-Proficient boundary does *not* excuse: claims that
   * were none of load-bearing, high consequence, weakly sourced, or on a concept the Readiness
   * Check did not show the student holds.
   */
  indefensibleFalseChallengeClaimIds: string[]
  matchedShare: number | null

  // -------------------------------------------------------------------------------------------
  // Confidence (FR-083, FR-086)
  // -------------------------------------------------------------------------------------------
  confidence: { frame: number | null; lock: number | null; turn: number | null }
  /** D-078's accuracy at the Decision Lock: the share of claims relied on that were sound or checked. */
  accuracyAtLock: number | null
  confidenceShape: ConfidenceShape

  // -------------------------------------------------------------------------------------------
  // The Turn (A.6)
  // -------------------------------------------------------------------------------------------
  responseVsWarrant: ResponseVsWarrant
  /** A filed response carrying no justification is A.6's Novice descriptor. */
  turnJustificationPresent: boolean

  // -------------------------------------------------------------------------------------------
  // The brief (A.5)
  // -------------------------------------------------------------------------------------------
  recommendationEmpty: boolean
  /** FR-105: the clock ran out and the draft was locked for the student. */
  briefAutoLocked: boolean
  /** FR-106, A.5: under four minutes of working time. A signal for the instructor, never a band. */
  speedOutlier: boolean
  lockElapsedMs: number | null

  // -------------------------------------------------------------------------------------------
  // The frame (A.1)
  // -------------------------------------------------------------------------------------------
  /** Any of the five frame fields filled with a single token (PRD §7.4's gate-passing frame). */
  frameFieldSingleToken: boolean

  // -------------------------------------------------------------------------------------------
  // Delegation (A.2)
  // -------------------------------------------------------------------------------------------
  delegationCount: number
  /** Delegations a reviewer flagged, which 10 §11.3 excludes from the Delegation read. */
  flaggedDelegationCount: number
  whyLineCount: number
  /** FR-064: a delegation with no response text, which sends Delegation to the defense answers. */
  incompleteLog: boolean
  /** Distinct Evidence Room documents opened before the assistant was first used (FR-023, A.2). */
  readOrderBeforeAssistant: number
  /** FR-061: declared and recorded, and read by no band rule. Reported, never scored. */
  outsideToolDeclarations: number

  // -------------------------------------------------------------------------------------------
  // The defense (A.7)
  // -------------------------------------------------------------------------------------------
  questionCount: number
  answeredCount: number
  /** FR-124: every question met with an empty answer, or with none at all. */
  nothingAnswered: boolean

  // -------------------------------------------------------------------------------------------
  // FR-087: the stance records this run lost
  // -------------------------------------------------------------------------------------------
  consequentialClaimCount: number
  stanceRecordsLost: number
  stanceRecordsLostShare: number
  stanceRecordLoss: StanceRecordLoss

  /** The trace events each dimension's facts were read from (`run_bands.evidence_event_seqs`). */
  evidenceEventSeqs: Readonly<Record<Dimension, number[]>>
}

// ---------------------------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------------------------

const KEEPING = new Set(['challenge', 'reject', 'escalate'])
/** hold < revise < reverse: the only ordering PRD §7.11's "size of the change" needs. */
const RESPONSE_RANK = { hold: 0, revise: 1, reverse: 2 } as const

/**
 * Every categorical fact of one run.
 *
 * `graphs` is an argument so the pipeline plots once and reads twice; passing graphs built from a
 * different input is the one way to get a wrong answer out of this function, which is why the
 * default builds them from the input it was given.
 */
export function categoricalFacts(
  input: GraphInput,
  graphs: RunGraphs = buildGraphs(input),
): CategoricalFacts {
  const { events, packageVersion } = input
  const claims = new Map(packageVersion.claims.map((claim) => [claim.id, claim] as const))
  const states = new Map(input.variantStates.map((state) => [state.claimId, state] as const))

  const actions = eventsOfType(events, 'action')
  const escalations = eventsOfType(events, 'escalation')
  const stances = eventsOfType(events, 'stance_set')
  const delegations = eventsOfType(events, 'delegation')
  const opens = eventsOfType(events, 'document_open')
  const declarations = eventsOfType(events, 'outside_tool_declared')
  const questions = eventsOfType(events, 'defense_question')
  const answers = eventsOfType(events, 'defense_answer')
  const frame = firstOfType(events, 'frame_locked')
  const lock = firstOfType(events, 'decision_locked')
  const turnDelivered = firstOfType(events, 'turn_delivered')
  const turnResponse = lastOfType(events, 'turn_response_locked')

  const rows = graphs.stance_matrix.rows
  const live = rows.filter((row) => !row.neutralized)
  const readiness = readinessByConcept(events)

  // ------------------------------------------------------------------------------------------
  // Defects
  // ------------------------------------------------------------------------------------------
  const defects = live.filter((row) => row.evidence_status === 'defective')
  const actionsOn = (claimId: string) => actions.filter((e) => e.payload.claim_id === claimId)
  const kept = defects.filter(
    (row) =>
      (row.stance_taken !== null && KEEPING.has(row.stance_taken)) ||
      (actionsOn(row.claim_id).length > 0 && row.stance_taken !== 'accept'),
  )
  const reached = defects.filter((row) => !kept.includes(row) && row.relied_on)
  const checkedDefects = defects.filter((row) => actionsOn(row.claim_id).length > 0)

  // ------------------------------------------------------------------------------------------
  // Checks
  // ------------------------------------------------------------------------------------------
  const rowOf = new Map(rows.map((row) => [row.claim_id, row] as const))
  const warrantedOf = (claimId: string) => states.get(claimId)?.warrantedStance ?? 'accept'
  const asserted = live.filter(
    (row) => row.stance_taken === 'verify' && actionsOn(row.claim_id).length === 0,
  )
  const misread = live.filter((row) => misreadTraceOn(row, actions, stances))

  // ------------------------------------------------------------------------------------------
  // Escalation
  // ------------------------------------------------------------------------------------------
  const held = (claimId: string): boolean => {
    const claim = claims.get(claimId)
    return claim !== undefined && readiness.get(claim.conceptKey) === true
  }
  const escalatedClaimIds = [...new Set(escalations.map((e) => e.payload.claim_id))]
  const insideCompetence = escalatedClaimIds.filter(held)
  const insideCompetenceOnSound = insideCompetence.filter(
    (claimId) => states.get(claimId)?.evidenceStatus !== 'defective',
  )

  // ------------------------------------------------------------------------------------------
  // Reliance
  // ------------------------------------------------------------------------------------------
  const stanced = live.filter((row) => row.stance_taken !== null)
  const fcr = falseChallengeRate(input)
  const indefensible = fcr.false_challenge_claim_ids.filter((claimId) => {
    const claim = claims.get(claimId)
    if (!claim) return true
    // A.4's Developing-to-Proficient boundary excuses a challenge on a claim that was
    // "load-bearing, weakly sourced, or outside the student's competence"; A.4's Proficient
    // descriptor and 10 §11.3 add high stakes. Competence is *demonstrated* only by a correct
    // Readiness answer, so an unanswered or skipped check leaves the claim outside it — A.0 forbids
    // a readiness result justifying a harsher band, and absence of evidence is not evidence.
    return !(
      claim.importance === 'load_bearing' ||
      claim.consequenceLevel === 'high' ||
      claim.weaklySourced ||
      readiness.get(claim.conceptKey) !== true
    )
  })

  // ------------------------------------------------------------------------------------------
  // Confidence, the Turn, the brief, the frame
  // ------------------------------------------------------------------------------------------
  const points = graphs.confidence_line.points
  const at = (key: 'frame' | 'lock' | 'turn') => points.find((point) => point.at === key) ?? null
  const confidence = {
    frame: at('frame')?.confidence ?? null,
    lock: at('lock')?.confidence ?? null,
    turn: at('turn')?.confidence ?? null,
  }

  const frameFields = frame
    ? [frame.payload.decision, ...frame.payload.assumptions, frame.payload.position]
    : []

  // ------------------------------------------------------------------------------------------
  // FR-087
  // ------------------------------------------------------------------------------------------
  const lost = rows.filter((row) => row.stance_record_lost).length
  const total = rows.length

  return {
    defectsInVariant: defects.length,
    defectsSurfaced: defects.filter((row) => row.surfaced).length,
    defectsKeptFromDecision: kept.length,
    defectsReachedDecision: reached.length,
    defectsSurfacedByCheck: checkedDefects.length,
    defectFree: defects.length === 0,
    allDefectsKeptFromDecision: kept.length === defects.length,

    actionCount: actions.length,
    actionsOnLoadBearing: actions.filter(
      (e) => rowOf.get(e.payload.claim_id)?.load_bearing === true,
    ).length,
    actionsOnNonWarranting: actions.filter((e) => warrantedOf(e.payload.claim_id) === 'accept')
      .length,
    actionsOnReliedOn: actions.filter((e) => rowOf.get(e.payload.claim_id)?.relied_on === true)
      .length,
    assertedVerification: asserted.length,
    misreadTrace: misread.length,

    escalationCount: escalations.length,
    escalationsInsideCompetence: insideCompetence.length,
    escalationsInsideCompetenceOnSoundClaims: insideCompetenceOnSound.length,

    acceptEverything: stanced.length > 0 && stanced.every((row) => row.stance_taken === 'accept'),
    fcr: fcr.rate,
    falseChallengeCount: fcr.false_challenges,
    falseChallengeClaimIds: fcr.false_challenge_claim_ids,
    indefensibleFalseChallengeClaimIds: indefensible,
    matchedShare: graphs.stance_matrix.matched_share,

    confidence,
    accuracyAtLock: at('lock')?.accuracy ?? null,
    confidenceShape: shapeOf(confidence, at('lock')?.accuracy ?? null),

    responseVsWarrant: responseVsWarrant(packageVersion.turn, turnDelivered !== null, turnResponse),
    turnJustificationPresent: (turnResponse?.payload.justification ?? '').trim() !== '',

    recommendationEmpty: (lock?.payload.recommendation ?? '').trim() === '',
    briefAutoLocked: lock?.payload.auto === true,
    speedOutlier: lock !== null && lock.payload.elapsed_ms < SPEED_OUTLIER_MS,
    lockElapsedMs: lock?.payload.elapsed_ms ?? null,

    frameFieldSingleToken: frameFields.some((field) => tokens(field).length === 1),

    delegationCount: delegations.length,
    flaggedDelegationCount: delegations.filter((e) => e.payload.flags.length > 0).length,
    whyLineCount: delegations.filter((e) => (e.payload.why ?? '').trim() !== '').length,
    incompleteLog: delegations.some((e) => e.payload.response_text.trim() === ''),
    readOrderBeforeAssistant: new Set(
      opens.filter((e) => e.payload.before_first_delegation).map((e) => e.payload.document_id),
    ).size,
    outsideToolDeclarations: declarations.length,

    questionCount: questions.length,
    answeredCount: answers.filter((e) => e.payload.text.trim() !== '').length,
    nothingAnswered: questions.length > 0 && answers.every((e) => e.payload.text.trim() === ''),

    consequentialClaimCount: total,
    stanceRecordsLost: lost,
    stanceRecordsLostShare: rate3(lost, total) ?? 0,
    stanceRecordLoss: stanceRecordLoss(lost, total),

    evidenceEventSeqs: evidenceSeqs(input),
  }
}

/**
 * FR-087's one third, compared in integers.
 *
 * `lost / total > 1 / 3` is the rule; `lost * 3 > total` is the same rule with no float in it. The
 * distinction is not academic: three of nine is *exactly* a third and must leave the run standing,
 * and the two roundings this codebase already does — `rate3` to three decimals and Postgres
 * `numeric(5,4)` — would each put 0.333 on the wrong side of a stored 1/3 sooner or later.
 */
export function stanceRecordLoss(lost: number, total: number): StanceRecordLoss {
  if (total <= 0 || lost === 0) return 'none'
  return lost * 3 > total ? 'unscoreable' : 'dimensions_unassessed'
}

// ---------------------------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------------------------

const tokens = (text: string): string[] =>
  text
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')

/** The Readiness Check result per concept; `true` only where the student answered it correctly. */
function readinessByConcept(events: GraphInput['events']): Map<string, boolean | null> {
  const map = new Map<string, boolean | null>()
  for (const item of eventsOfType(events, 'readiness_item')) {
    map.set(item.payload.concept_key, item.payload.correct)
  }
  return map
}

/**
 * FR-075's "right action, wrong conclusion": a Source Trace ran on a defective claim, and the
 * stance the student settled on afterwards was accept. The action has to come first — a trace run
 * after the stance did not inform it — which is why this reads sequences rather than counts.
 */
function misreadTraceOn(
  row: StanceMatrixRow,
  actions: TypedEvent<'action'>[],
  stances: TypedEvent<'stance_set'>[],
): boolean {
  if (row.evidence_status !== 'defective' || row.stance_taken !== 'accept') return false
  const claimStances = stances.filter((e) => e.payload.claim_id === row.claim_id)
  const finalSeq = claimStances[claimStances.length - 1]?.seq
  if (finalSeq === undefined) return false
  return actions.some(
    (e) =>
      e.payload.claim_id === row.claim_id && e.payload.type === 'source_trace' && e.seq < finalSeq,
  )
}

/** 10 §11.2's three named confidence shapes, tried in the order PRD §7.8 names them. */
function shapeOf(
  confidence: { frame: number | null; lock: number | null; turn: number | null },
  accuracyAtLock: number | null,
): ConfidenceShape {
  const filed = [confidence.frame, confidence.lock, confidence.turn].filter(
    (value): value is number => value !== null,
  )
  if (filed.length >= 2 && filed.every((value) => value === 50)) return 'flat_50'
  if (filed.length >= 2 && filed.every((value) => value === 100)) return 'flat_100'
  if (
    confidence.frame !== null &&
    confidence.lock !== null &&
    confidence.lock > confidence.frame &&
    accuracyAtLock !== null &&
    accuracyAtLock < 0.5
  ) {
    return 'rising_unchecked'
  }
  return 'other'
}

/**
 * The response against the Turn's authored warrant (PRD §7.11, FR-115).
 *
 * The warrant is read from the package version and never from the graph payload: `warrants_change`
 * and `proportionate_response` are answer-key fields a student payload may not carry in any state
 * (12 §8.1, D-384), and the debrief shows the graph payload to the student.
 */
function responseVsWarrant(
  turn: GraphInput['packageVersion']['turn'],
  delivered: boolean,
  response: TypedEvent<'turn_response_locked'> | null,
): ResponseVsWarrant {
  if (turn === null || !delivered) return 'no_turn'
  if (response === null) return 'no_response'
  if (response.payload.implicit) {
    return turn.warrantsChange ? 'implicit_hold_failed' : 'implicit_hold_ok'
  }
  const taken = RESPONSE_RANK[response.payload.response]
  const warranted = RESPONSE_RANK[turn.proportionateResponse]
  if (taken === warranted) return 'match'
  return taken > warranted ? 'over_adaptation' : 'under_adaptation'
}

/**
 * The trace events behind each dimension's facts — `run_bands.evidence_event_seqs` (FR-137).
 *
 * A band cites the events it rests on so the faculty replay can jump to them and the student can
 * read what the placement was drawn from (PRD §7.13, §7.17). The lists are the events a dimension's
 * *facts* were computed from; the quotes a model read adds are carried separately on the band.
 */
function evidenceSeqs(input: GraphInput): Record<Dimension, number[]> {
  const { events } = input
  const seqs = (...types: RunEventTypeValue[]): number[] =>
    events
      .filter((event) => types.includes(event.type))
      .map((event) => event.seq)
      .sort((a, b) => a - b)

  // Typed as the full record, so a dimension added to the rubric is a compile error here rather
  // than a band that silently cites nothing.
  return {
    framing: seqs('frame_locked', 'document_open'),
    delegation: seqs('delegation', 'document_open', 'outside_tool_declared'),
    verification: seqs('action', 'escalation', 'stance_set'),
    calibration: seqs(
      'stance_set',
      'escalation',
      'claim_used',
      'frame_locked',
      'decision_locked',
      'turn_response_locked',
      'claim_neutralized',
    ),
    decision_quality: seqs('decision_locked', 'addendum'),
    adaptation: seqs('frame_locked', 'turn_delivered', 'turn_response_locked'),
    ownership: seqs('defense_question', 'defense_answer'),
  }
}
