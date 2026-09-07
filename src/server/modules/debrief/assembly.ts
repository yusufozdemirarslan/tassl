// The debrief's assembly (docs/tech/10-backend-spec-modules.md §13, §13.1; FR-151, FR-153, FR-155).
//
// Everything on this page that is not stored is built here, and it is built as a pure function of
// what the run recorded, so that `tests/unit/debrief/assembly.test.ts` can hold the two rules the
// PRD makes about it without a database:
//
//   1. **The order is fixed** (FR-151). The debrief walks the run in the order the run happened, and
//      a section a run cannot support is named with the reason rather than dropped (FR-155, FR-004):
//      a page that quietly omitted the missed-defect section would read as a run with nothing to say
//      about its defects, which is a different sentence from "your decision rested on no authored
//      defect".
//   2. **Generated text comes from the authored rationale plus fixed templates** (FR-153). Every
//      sentence this file produces is a `t()` of a `debrief.` key with run facts interpolated into
//      it; nothing is composed word by word, and nothing evaluates the student. The catalogue's own
//      header states the three vocabularies that are absent from it, and the unit test scans for
//      them.
//
// The four graphs arrive already projected for their own student (`scoring.readGraphsForOwner`), and
// every section that draws one carries the graph unchanged: FR-154 says the student and the
// instructor "see identical graphs from the same trace", which is a claim about one object rather
// than two renderings.
import { t } from '@/lib/i18n/t'
import type {
  DebriefBand,
  DebriefPoints,
  DebriefQuestions,
  DebriefSection,
  DebriefSectionKey,
  StanceValue,
} from './schema'
import { DEBRIEF_SECTION_ORDER } from './schema'

export { DEBRIEF_SECTION_ORDER }

// ---------------------------------------------------------------------------------------------
// What the assembly is given
// ---------------------------------------------------------------------------------------------

/** The four interrogation actions, restated: this file names them and never runs one. */
export type ActionTypeValue =
  'source_trace' | 'replication_check' | 'decomposition_check' | 'stakeholder_interview'

/** One claim of the run, the authored standard and what the student did with it, joined. */
export type ClaimFacts = {
  claimId: string
  key: string
  text: string
  importance: 'load_bearing' | 'supporting'
  rationale: string
  evidenceStatus: 'sound' | 'defective'
  failureFamily: string | null
  warrantedStance: StanceValue
  planted: boolean
  /** The run's own row; absent when the claim never came up (D-107's "not surfaced"). */
  surfaced: boolean
  stanceTaken: StanceValue | null
  previousStance: StanceValue | null
  stanceSetAt: string | null
  reliedOn: boolean
  neutralized: boolean
  inconsistencyCredited: boolean
  stanceRecordLost: boolean
  /** Interrogation actions run on this claim, in completion order. */
  actions: { type: ActionTypeValue; completedAt: string }[]
  /** The document the claim quotes, when it names one. */
  document: { title: string; author: string; datedOn: string } | null
  passage: string
  /** What each interrogation action returns for this claim on this variant, already rendered. */
  check: { type: ActionTypeValue; sentence: string } | null
}

/** The Sycophancy Probe as the debrief replays it, after the run is scored (FR-053, D-088). */
export type ProbeFacts = {
  claimId: string
  claimKey: string
  reversal: string
  occurredAt: string
  stanceAfter: StanceValue | null
}

/** The frame as the student locked it; its own words, which is why a quote from it is theirs. */
export type FrameFacts = {
  decision: string
  assumptions: string[]
  position: string
}

export type AssemblyInput = {
  version: 'draft' | 'confirmed'
  viewer: 'owner' | 'reviewer'
  /** `scoring.readGraphsForOwner`'s four payloads, or null before a run has been scored. */
  graphs: Record<string, unknown> | null
  frame: FrameFacts | null
  /** The response the student filed against the Turn, or null when none was filed. */
  turnResponse: { response: 'hold' | 'revise' | 'reverse' } | null
  /** What the authored Turn warranted; never emitted, only compared with (12 §8.1). */
  turnStandard: {
    warrantsChange: boolean
    proportionateResponse: 'hold' | 'revise' | 'reverse'
  } | null
  counterfactual: string
  claims: ClaimFacts[]
  probe: ProbeFacts | null
  escalations: { claimId: string; claimKey: string }[]
  bands: DebriefBand[]
  points: DebriefPoints
  questions: DebriefQuestions
}

// ---------------------------------------------------------------------------------------------
// The graphs each section draws
// ---------------------------------------------------------------------------------------------

type GraphKey = 'confidence_line' | 'clock_timeline' | 'stance_matrix' | 'frame_beside_decision'

type GraphPayload = { available?: unknown; missing_event_types?: unknown } & Record<string, unknown>

const GRAPH_TITLES: Record<GraphKey, string> = {
  confidence_line: t('graph.confidenceLine.title'),
  clock_timeline: t('graph.clockTimeline.title'),
  stance_matrix: t('graph.stanceMatrix.title'),
  frame_beside_decision: t('graph.frameBesideDecision.title'),
}

const STANCE_LABELS: Record<StanceValue, string> = {
  accept: t('stance.accept'),
  verify: t('stance.verify'),
  challenge: t('stance.challenge'),
  reject: t('stance.reject'),
  escalate: t('stance.escalate'),
}

const ACTION_LABELS: Record<ActionTypeValue, string> = {
  source_trace: t('debrief.action.source_trace'),
  replication_check: t('debrief.action.replication_check'),
  decomposition_check: t('debrief.action.decomposition_check'),
  stakeholder_interview: t('debrief.action.stakeholder_interview'),
}

const TURN_RESPONSE_LABELS: Record<'hold' | 'revise' | 'reverse', string> = {
  hold: t('graph.frameBesideDecision.responseHold'),
  revise: t('graph.frameBesideDecision.responseRevise'),
  reverse: t('graph.frameBesideDecision.responseReverse'),
}

/** The ten authored defect kinds, in the words a student reads them in (12 §8.2). */
export function failureFamilyLabel(family: string | null): string | null {
  if (family === null) return null
  const key = `debrief.defect.family.${family}`
  return key in DEFECT_FAMILY_LABELS ? DEFECT_FAMILY_LABELS[key]! : null
}

const DEFECT_FAMILY_LABELS: Record<string, string> = {
  'debrief.defect.family.near_neighbor': t('debrief.defect.family.near_neighbor'),
  'debrief.defect.family.unstated_assumption': t('debrief.defect.family.unstated_assumption'),
  'debrief.defect.family.stale_evidence': t('debrief.defect.family.stale_evidence'),
  'debrief.defect.family.uncomputed_number': t('debrief.defect.family.uncomputed_number'),
  'debrief.defect.family.extrapolation': t('debrief.defect.family.extrapolation'),
  'debrief.defect.family.reversal_to_agree': t('debrief.defect.family.reversal_to_agree'),
  'debrief.defect.family.omitted_alternative': t('debrief.defect.family.omitted_alternative'),
  'debrief.defect.family.misapplied_method': t('debrief.defect.family.misapplied_method'),
  'debrief.defect.family.misattributed_source': t('debrief.defect.family.misattributed_source'),
  'debrief.defect.family.unacceptable_route': t('debrief.defect.family.unacceptable_route'),
}

function graphOf(graphs: Record<string, unknown> | null, key: GraphKey): GraphPayload | null {
  const payload = graphs?.[key]
  return payload && typeof payload === 'object' ? (payload as GraphPayload) : null
}

/** The reason a graph-backed section is not drawn, or null when it can be (FR-155). */
function graphUnavailableReason(graph: GraphPayload | null, key: GraphKey): string | null {
  if (graph === null) return t('debrief.unavailable.noGraphs')
  if (graph.available === true) return null
  const missing = Array.isArray(graph.missing_event_types)
    ? graph.missing_event_types.map(String)
    : []
  return t('debrief.unavailable.graph', {
    graph: GRAPH_TITLES[key],
    missing: missing.join(', '),
  })
}

// ---------------------------------------------------------------------------------------------
// The rows each section carries
// ---------------------------------------------------------------------------------------------

/** One row of the claim-by-claim walk: what you did, what it warranted, and why (FR-151). */
export type ClaimWalkthrough = {
  claimId: string
  key: string
  text: string
  importance: 'load_bearing' | 'supporting'
  stanceTaken: StanceValue | null
  warrantedStance: StanceValue
  match: boolean
  evidenceStatus: 'sound' | 'defective'
  failureFamily: string | null
  failureFamilyLabel: string | null
  reliedOn: boolean
  neutralized: boolean
  /** The author's "what it deserved and why"; the one piece of prose here nobody generated. */
  rationale: string
  /** The generated half: fixed templates with this run's facts in them (FR-153). */
  lines: string[]
}

/** One defect the filed decision rested on, with the check that would have shown it (FR-151). */
export type MissedDefect = {
  claimId: string
  key: string
  text: string
  failureFamily: string | null
  failureFamilyLabel: string | null
  document: { title: string; author: string; datedOn: string } | null
  passage: string
  stanceLine: string
  checkLine: string
  actionLine: string
}

// ---------------------------------------------------------------------------------------------
// The claim-by-claim walk (FR-151)
// ---------------------------------------------------------------------------------------------

export function claimWalkthrough(claim: ClaimFacts): ClaimWalkthrough {
  const lines: string[] = []
  if (!claim.surfaced) {
    lines.push(t('debrief.claim.notSurfaced'))
  } else if (claim.stanceRecordLost) {
    lines.push(t('debrief.claim.recordLost'))
  } else if (claim.stanceTaken === null) {
    lines.push(t('debrief.claim.noStance'))
  } else if (claim.previousStance !== null && claim.previousStance !== claim.stanceTaken) {
    lines.push(
      t('debrief.claim.youTookAfter', {
        stance: STANCE_LABELS[claim.stanceTaken],
        previous: STANCE_LABELS[claim.previousStance],
      }),
    )
  } else {
    lines.push(t('debrief.claim.youTook', { stance: STANCE_LABELS[claim.stanceTaken] }))
  }

  lines.push(t('debrief.claim.warranted', { stance: STANCE_LABELS[claim.warrantedStance] }))
  const match = matchedStance(claim)
  if (claim.surfaced && claim.stanceTaken !== null && !claim.stanceRecordLost) {
    lines.push(match ? t('debrief.claim.same') : t('debrief.claim.different'))
  }
  lines.push(claim.reliedOn ? t('debrief.claim.reliedOn') : t('debrief.claim.notReliedOn'))
  lines.push(
    claim.actions.length > 0
      ? t('debrief.claim.checksRun', { actions: joinActions(claim.actions.map((a) => a.type)) })
      : t('debrief.claim.noChecksRun'),
  )
  if (claim.neutralized) lines.push(t('debrief.claim.neutralized'))
  if (claim.inconsistencyCredited) lines.push(t('debrief.claim.credited'))

  return {
    claimId: claim.claimId,
    key: claim.key,
    text: claim.text,
    importance: claim.importance,
    stanceTaken: claim.stanceTaken,
    warrantedStance: claim.warrantedStance,
    match,
    evidenceStatus: claim.evidenceStatus,
    failureFamily: claim.failureFamily,
    failureFamilyLabel: failureFamilyLabel(claim.failureFamily),
    reliedOn: claim.reliedOn,
    neutralized: claim.neutralized,
    rationale: claim.rationale === '' ? t('debrief.claim.noRationale') : claim.rationale,
    lines,
  }
}

/**
 * Whether the stance the student took is the one the material warranted.
 *
 * `inconsistency_credited` counts as a match, which is D-092's credit path read from this side: an
 * instructor who recorded that the student's challenge was right has said the run's stance on that
 * claim was the correct one, and the walk says so rather than showing a mismatch beside a note that
 * contradicts it. A lost stance record is neither a match nor a mismatch (FR-087).
 */
function matchedStance(claim: ClaimFacts): boolean {
  if (claim.stanceRecordLost) return false
  if (claim.inconsistencyCredited) return true
  return claim.stanceTaken !== null && claim.stanceTaken === claim.warrantedStance
}

const joinActions = (types: readonly ActionTypeValue[]): string =>
  types.map((type) => ACTION_LABELS[type]).join(', ')

// ---------------------------------------------------------------------------------------------
// Defects the decision rested on (FR-151, FR-153)
// ---------------------------------------------------------------------------------------------

/**
 * The planted defects the filed decision still rested on (10 §13's "planted claims not kept from the
 * decision").
 *
 * "Kept from the decision" is `scoring`'s own test (10 §11.2): a stance of challenge, reject or
 * escalate, or an interrogation action run with a stance that is not accept. A claim the decision
 * did not rest on is not in this section either — the section is about what the decision carried,
 * and a defect the student met and set aside is in the claim-by-claim walk above it.
 *
 * A neutralized claim is out: the instructor has said this run is not read on it (FR-003).
 */
export function missedDefects(claims: readonly ClaimFacts[]): MissedDefect[] {
  return claims.filter(isMissedDefect).map(toMissedDefect)
}

function isMissedDefect(claim: ClaimFacts): boolean {
  if (!claim.planted || claim.neutralized) return false
  if (!claim.surfaced || !claim.reliedOn) return false
  return !keptFromDecision(claim)
}

const KEPT_STANCES: ReadonlySet<StanceValue> = new Set(['challenge', 'reject', 'escalate'])

function keptFromDecision(claim: ClaimFacts): boolean {
  if (claim.stanceTaken !== null && KEPT_STANCES.has(claim.stanceTaken)) return true
  return claim.actions.length > 0 && claim.stanceTaken !== null && claim.stanceTaken !== 'accept'
}

function toMissedDefect(claim: ClaimFacts): MissedDefect {
  const warranted = STANCE_LABELS[claim.warrantedStance]
  const stanceLine =
    claim.stanceTaken === null
      ? t('debrief.defect.noStanceRelied', { warranted })
      : claim.stanceTaken === 'accept'
        ? t('debrief.defect.acceptedRelied', { warranted })
        : t('debrief.defect.stanceRelied', {
            stance: STANCE_LABELS[claim.stanceTaken],
            warranted,
          })
  return {
    claimId: claim.claimId,
    key: claim.key,
    text: claim.text,
    failureFamily: claim.failureFamily,
    failureFamilyLabel: failureFamilyLabel(claim.failureFamily),
    document: claim.document,
    passage: claim.passage,
    stanceLine,
    checkLine: claim.check?.sentence ?? t('debrief.defect.noPath'),
    actionLine:
      claim.actions.length > 0
        ? t('debrief.defect.checkedFirst', {
            actions: joinActions(claim.actions.map((action) => action.type)),
          })
        : t('debrief.defect.notChecked'),
  }
}

// ---------------------------------------------------------------------------------------------
// "One thing this run did" (FR-153, 10 §13.1)
// ---------------------------------------------------------------------------------------------

/**
 * §13.1's ladder, in order, first match wins; the last rung is true of every run that reached this
 * page (FR-153: the debrief "always names at least one thing done well").
 *
 * Two readings of the list are settled here and recorded as decisions. §13.1's third rung says "a
 * hold or revision matching the warrant": a `reverse` that matches the warrant is admitted on the
 * same terms (D-448), because the fact the rung names is that the response was the proportionate one
 * and the Turn decides which of the three that is. §13.1's fifth says "a complete frame with all
 * assumptions load-bearing (read quote)": that is Appendix A.1's Professional boundary word for
 * word, so the condition is the framing band standing at Professional, and the quote is the
 * student's own first framed assumption rather than a band read's quote, which is reviewer-only in
 * every state (D-449).
 */
export function selectDoneWell(input: AssemblyInput): string {
  const matched = input.claims.find(
    (claim) => claim.importance === 'load_bearing' && claim.surfaced && matchedStance(claim),
  )
  if (matched && matched.stanceTaken !== null) {
    return t('debrief.doneWell.matchedStance', {
      key: matched.key,
      stance: STANCE_LABELS[matched.stanceTaken],
    })
  }

  const read = input.claims.find(readCheckCorrectly)
  if (read && read.stanceTaken !== null) {
    const action = read.actions[0]
    if (action) {
      return t('debrief.doneWell.sourceTrace', {
        action: ACTION_LABELS[action.type],
        key: read.key,
        stance: STANCE_LABELS[read.stanceTaken],
      })
    }
  }

  if (
    input.turnStandard !== null &&
    input.turnResponse !== null &&
    input.turnResponse.response === input.turnStandard.proportionateResponse
  ) {
    return t('debrief.doneWell.turnResponse', {
      warranted: TURN_RESPONSE_LABELS[input.turnStandard.proportionateResponse],
    })
  }

  const escalation = input.escalations[0]
  if (escalation) return t('debrief.doneWell.escalation', { key: escalation.claimKey })

  const assumption = completeFrameAssumption(input)
  if (assumption !== null) return t('debrief.doneWell.frame', { assumption })

  return t('debrief.doneWell.fallback')
}

/** §13.1 rung two: an interrogation action on a defective claim, then a stance that is not accept. */
function readCheckCorrectly(claim: ClaimFacts): boolean {
  if (claim.evidenceStatus !== 'defective' || claim.neutralized) return false
  if (claim.stanceTaken === null || claim.stanceTaken === 'accept') return false
  const action = claim.actions[0]
  if (!action) return false
  if (claim.stanceSetAt === null) return true
  return action.completedAt <= claim.stanceSetAt
}

/** §13.1 rung five: the frame is whole and Framing stands at Appendix A.1's Professional. */
function completeFrameAssumption(input: AssemblyInput): string | null {
  const frame = input.frame
  if (!frame) return null
  const assumptions = frame.assumptions.filter((assumption) => assumption.trim() !== '')
  if (frame.decision.trim() === '' || frame.position.trim() === '') return null
  if (assumptions.length < 3) return null
  const framing = input.bands.find((band) => band.dimension === 'framing')
  if (!framing || framing.band !== 'professional') return null
  return assumptions[0] ?? null
}

// ---------------------------------------------------------------------------------------------
// The twelve sections (FR-151, FR-155)
// ---------------------------------------------------------------------------------------------

const SECTION_COPY: Record<DebriefSectionKey, { title: string; body: string }> = {
  frame_beside_decision: {
    title: t('debrief.section.frameBesideDecision.title'),
    body: t('debrief.section.frameBesideDecision.body'),
  },
  stance_matrix: {
    title: t('debrief.section.stanceMatrix.title'),
    body: t('debrief.section.stanceMatrix.body'),
  },
  missed_defects: {
    title: t('debrief.section.missedDefects.title'),
    body: t('debrief.section.missedDefects.body'),
  },
  probe: { title: t('debrief.section.probe.title'), body: t('debrief.section.probe.body') },
  confidence_line: {
    title: t('debrief.section.confidenceLine.title'),
    body: t('debrief.section.confidenceLine.body'),
  },
  turn_beside_frame: {
    title: t('debrief.section.turnBesideFrame.title'),
    body: t('debrief.section.turnBesideFrame.body'),
  },
  clock_timeline: {
    title: t('debrief.section.clockTimeline.title'),
    body: t('debrief.section.clockTimeline.body'),
  },
  counterfactual: {
    title: t('debrief.section.counterfactual.title'),
    body: t('debrief.section.counterfactual.body'),
  },
  bands: { title: t('debrief.section.bands.title'), body: t('debrief.section.bands.body') },
  points: { title: t('debrief.section.points.title'), body: t('debrief.section.points.body') },
  done_well: {
    title: t('debrief.section.doneWell.title'),
    body: t('debrief.section.doneWell.body'),
  },
  questions: {
    title: t('debrief.section.questions.title'),
    body: t('debrief.section.questions.body'),
  },
}

const available = (key: DebriefSectionKey, data: unknown): DebriefSection => ({
  key,
  available: true,
  reason: null,
  ...SECTION_COPY[key],
  data: data ?? null,
})

const withheld = (key: DebriefSectionKey, reason: string): DebriefSection => ({
  key,
  available: false,
  reason,
  ...SECTION_COPY[key],
  data: null,
})

/**
 * The twelve sections in the fixed order, each either drawn or named with the reason it is not.
 *
 * The four sections whose contents are top-level fields of the view — `bands`, `points`,
 * `done_well`, `questions` — carry `data: null` and appear here for their place in the order, which
 * is the product rule 07 §7's `DebriefView` leaves to this list.
 */
export function buildSections(input: AssemblyInput): DebriefSection[] {
  const sections: DebriefSection[] = []
  for (const key of DEBRIEF_SECTION_ORDER) sections.push(buildSection(key, input))
  return sections
}

function buildSection(key: DebriefSectionKey, input: AssemblyInput): DebriefSection {
  switch (key) {
    case 'frame_beside_decision':
      return fromGraph(key, input, 'frame_beside_decision', (graph) => ({
        graphKey: 'frame_beside_decision',
        graph,
      }))
    case 'stance_matrix':
      return fromGraph(key, input, 'stance_matrix', (graph) => ({
        graphKey: 'stance_matrix',
        graph,
        claims: input.claims.map(claimWalkthrough),
      }))
    case 'missed_defects': {
      const items = missedDefects(input.claims)
      return items.length === 0
        ? withheld(key, t('debrief.unavailable.noDefects'))
        : available(key, { items })
    }
    case 'probe':
      return input.probe === null
        ? withheld(key, t('debrief.unavailable.probeNotFired'))
        : available(key, {
            claimId: input.probe.claimId,
            claimKey: input.probe.claimKey,
            reversal: input.probe.reversal,
            occurredAt: input.probe.occurredAt,
            intro: t('debrief.probe.intro', { key: input.probe.claimKey }),
            after:
              input.probe.stanceAfter === null
                ? t('debrief.probe.noStanceAfter')
                : t('debrief.probe.stanceAfter', {
                    stance: STANCE_LABELS[input.probe.stanceAfter],
                  }),
          })
    case 'confidence_line':
      return fromGraph(key, input, 'confidence_line', (graph) => ({
        graphKey: 'confidence_line',
        graph,
      }))
    case 'turn_beside_frame': {
      const graph = graphOf(input.graphs, 'frame_beside_decision')
      const reason = graphUnavailableReason(graph, 'frame_beside_decision')
      if (reason !== null || graph === null) {
        return withheld(key, reason ?? t('debrief.unavailable.noGraphs'))
      }
      if (graph.turn === null || graph.turn === undefined) {
        return withheld(key, t('debrief.unavailable.noTurn'))
      }
      return available(key, {
        graphKey: 'frame_beside_decision',
        turn: graph.turn,
        frame: graph.frame ?? null,
        disruptedAssumptionIndexes: graph.disrupted_assumption_indexes ?? [],
        unmatchedDisruptedKeys: graph.unmatched_disrupted_keys ?? [],
      })
    }
    case 'clock_timeline':
      return fromGraph(key, input, 'clock_timeline', (graph) => ({
        graphKey: 'clock_timeline',
        graph,
      }))
    case 'counterfactual':
      return input.counterfactual.trim() === ''
        ? withheld(key, t('debrief.unavailable.noCounterfactual'))
        : available(key, { text: input.counterfactual })
    case 'bands':
      return input.bands.length === 0
        ? withheld(key, t('debrief.unavailable.noBands'))
        : available(key, null)
    case 'points':
      return input.bands.length === 0
        ? withheld(key, t('debrief.unavailable.noMapping'))
        : available(key, null)
    case 'done_well':
      return available(key, null)
    case 'questions':
      return available(key, null)
  }
}

function fromGraph(
  key: DebriefSectionKey,
  input: AssemblyInput,
  graphKey: GraphKey,
  data: (graph: GraphPayload) => unknown,
): DebriefSection {
  const graph = graphOf(input.graphs, graphKey)
  const reason = graphUnavailableReason(graph, graphKey)
  if (reason !== null || graph === null) {
    return withheld(key, reason ?? t('debrief.unavailable.noGraphs'))
  }
  return available(key, data(graph))
}
