// Step five of the scoring pipeline — the seven draft bands (10-backend-spec-modules.md §11.3;
// PRD §7.13, Appendix A; FR-004, FR-109, FR-136 to FR-139, FR-142).
//
// Trace → graphs → facts → reads → **bands** → points. Given the categorical facts, the four graph
// payloads and whatever the five free-text reads returned, this file places each of the seven
// dimensions in one of the four Appendix A bands, or reports it unassessed and says why. It is a
// pure function of its arguments: no database, no clock, no provider call, and no throw.
//
// **A draft, and only a draft.** Nothing here decides anything. Every band it produces is written
// as `draft_band` and shown labelled draft until a human with disciplinary expertise confirms or
// changes it, and that person's decision is final (PRD §6, §7.13, §7.17; FR-182). The boundaries it
// places against are the Appendix A drafts, uncalibrated, pending the pilot (A.0) — which is why
// the rubric carries `uncalibrated: true` and every screen that shows a band says so (FR-141).
//
// **Unassessed is an answer, never a zero.** FR-004: "a dimension that cannot be assessed is
// reported unassessed, never estimated", and PRD §7.19 adds that it is excluded from the run's
// points rather than counted as zero. So there are four ways a dimension ends without a band, each
// with its own reason, and none of them is a low band:
//
//   * `graph_unavailable` — a graph the dimension reads from could not be plotted from this run's
//     trace (FR-136). A dimension reading from more than one is unassessed when *any* of them is
//     unavailable, and its band cites every graph it was read from (PRD §7.13).
//   * `stance_records_lost` — FR-087's smaller loss: a third or fewer of the consequential claims
//     lost their stance record, so Verification and Calibration cannot be read and the rest of the
//     run stands. Above a third the run is not scoreable at all, which is the job's decision to
//     hold and the faculty seat's to void — `stanceRecordLoss` in `facts.ts` is what says so.
//   * `no_evidence` — the run recorded nothing the dimension is about: no Turn, no defense.
//   * `read_failed` — the free-text read did not complete and the recorded events alone do not
//     place the dimension (11 §3's degradation ladder).
//
// **Where a fixed placement and a boundary sentence disagree, the fixed placement wins.** Appendix
// A.0 says who wrote what: the Novice and Professional descriptors "restate PRD text", while the
// three interior boundary sentences are the editor's drafts for the builder to edit. So PRD §7.9's
// "both consequential defects escalated is top of Calibration" outranks A.4's boundary condition
// that escalations fall only outside demonstrated competence, and the rule below reads the narrower
// fact `escalationsInsideCompetenceOnSoundClaims` for exactly that reason. Each such call is marked
// at the rule it decides.
//
// **The two computed dimensions never see a model.** Verification and Calibration are "computed
// throughout" (PRD §7.13), so their bands are reproducible from the trace alone and carry
// `provisional: false`. The other five turn on free text, so a model reads it, quotes what it read,
// and the band is provisional on that basis (FR-137, FR-138).
import { t } from '@/lib/i18n/t'
import { FCR_FEW, FCR_NOVICE, FCR_PROFESSIONAL } from './constants'
import type { GraphKey, RunGraphs } from './graphs'
import type { CategoricalFacts, ResponseVsWarrant } from './facts'
import { DIMENSIONS, lowerBand, type Band, type Dimension } from './rubric'

// ---------------------------------------------------------------------------------------------
// What a band read gives back, and what a band is
// ---------------------------------------------------------------------------------------------

/** A quote a read took from the run's own free text, anchored to the event it came from. */
export type BandQuote = { event_seq: number; text: string }

/** The output shape of the five `band-read-*` prompts (11 §2.1). Filled by Step 10.4's `reads.ts`. */
export type BandRead = {
  band: Band
  quotes: BandQuote[]
  rationale: string
}

/** How a recommendation sat against the authored answer space (FR-109; PRD §7.10). */
export type MatchedPosition =
  'defensible' | 'minimum_commitment' | 'evidence_inconsistent' | 'declined' | 'none'

/** `band-read-decision-quality@1`, which also reports which authored position it matched. */
export type DecisionQualityRead = BandRead & {
  matchedPosition: MatchedPosition
  /** PRD §7.10: the answer space states a minimum defensible commitment for this scenario. */
  minimumCommitmentExists: boolean
}

/** The five reads, each absent when it was not run or did not come back (11 §3). */
export type BandReads = {
  framing?: BandRead
  delegation?: BandRead
  decision_quality?: DecisionQualityRead
  adaptation?: BandRead
  ownership?: BandRead
}

export type BandStatus = 'drafted' | 'unassessed'
export type UnassessedReason =
  'graph_unavailable' | 'no_evidence' | 'stance_records_lost' | 'read_failed'
/** FR-138: what the band was read from. `none` is the manual banding path of FR-140. */
export type BandBasis = 'trace' | 'defense_only' | 'categorical_only' | 'none'

/** One drafted band, shaped so `run_bands` and the `draft_band` payload take it unchanged. */
export type DraftBand = {
  dimension: Dimension
  /** Null exactly when `status` is `unassessed` (FR-004). */
  band: Band | null
  status: BandStatus
  /** The `UnassessedReason` when unassessed; empty when drafted. */
  reason: string
  basis: BandBasis
  provisional: boolean
  /** Every graph the band was read from, unavailable ones included (PRD §7.13). */
  graphKeys: GraphKey[]
  evidenceEventSeqs: number[]
  quotes: BandQuote[]
  rationale: string
}

export type BandContext = {
  facts: CategoricalFacts
  graphs: RunGraphs
  reads?: BandReads
  /** FR-125, PRD §7.12: the run reached Defense Missed, which caps Ownership and nothing else. */
  defenseMissed?: boolean
}

/**
 * Which graphs each dimension is read from (10 §11.3; PRD §7.13).
 *
 * Framing reads from two because "a frame is banded partly on the evidence the student read before
 * the assistant unlocked", and Ownership from all four because the defense is read against the
 * whole record. A dimension reading from more than one is unassessed when any of them is
 * unavailable, and cites every one of them either way (FR-136).
 */
export const DIMENSION_GRAPHS: Readonly<Record<Dimension, readonly GraphKey[]>> = {
  framing: ['frame_beside_decision', 'clock_timeline'],
  delegation: ['clock_timeline'],
  verification: ['clock_timeline', 'stance_matrix'],
  calibration: ['stance_matrix', 'confidence_line'],
  decision_quality: ['frame_beside_decision'],
  adaptation: ['frame_beside_decision'],
  ownership: ['confidence_line', 'clock_timeline', 'stance_matrix', 'frame_beside_decision'],
}

/** The two dimensions PRD §7.13 computes throughout, and FR-087 reports unassessed together. */
export const COMPUTED_DIMENSIONS = ['verification', 'calibration'] as const

// ---------------------------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------------------------

/** Every dimension's draft band, in the order Appendix A and the debrief present them. */
export function draftBands(context: BandContext): Record<Dimension, DraftBand> {
  const drafted = {
    framing: framing(context),
    delegation: delegation(context),
    verification: verification(context),
    calibration: calibration(context),
    decision_quality: decisionQuality(context),
    adaptation: adaptation(context),
    ownership: ownership(context),
  }
  // The graph rule is checked last and overrides everything: a band read off a graph that could not
  // be plotted is not a band, whatever the facts said (FR-136).
  for (const dimension of DIMENSIONS) {
    const missing = unavailableGraphsFor(dimension, context.graphs)
    if (missing.length > 0) drafted[dimension] = graphUnavailable(dimension, context, missing)
  }
  return drafted
}

// ---------------------------------------------------------------------------------------------
// Verification (A.3) — computed
// ---------------------------------------------------------------------------------------------

/**
 * A.3 and 10 §11.3, top rung first.
 *
 * Professional has two forms because Appendix A gives it two: on a variant that plants defects,
 * every one of them was surfaced by a check capable of changing the decision; on a defect-free
 * variant, no check was spent on a claim that did not warrant one, "the limiting case being no
 * checks where no claim warranted one" — which is why a run with zero actions on a clean variant
 * lands here and not at the bottom. A trace that was misread did not surface anything, so it bars
 * the first form (FR-075).
 *
 * With the three upper rungs taken, Novice is exactly the run that ran no interrogation action at
 * all, which is both of 10 §11.3's Novice clauses at once: no action on any claim the decision
 * rested on, and asserted verification with nothing behind it.
 */
export function verificationBand(facts: CategoricalFacts): Band {
  const surfacedEveryDefect =
    !facts.defectFree &&
    facts.defectsSurfacedByCheck === facts.defectsInVariant &&
    facts.misreadTrace === 0
  const spentNothingUnwarranted = facts.defectFree && facts.actionsOnNonWarranting === 0
  if (surfacedEveryDefect || spentNothingUnwarranted) return 'professional'
  if (facts.actionsOnLoadBearing >= 1 && facts.misreadTrace === 0) return 'proficient'
  if (facts.actionCount > 0) return 'developing'
  return 'novice'
}

function verification(context: BandContext): DraftBand {
  const { facts } = context
  if (facts.stanceRecordLoss !== 'none') return stanceRecordsLost('verification', context)
  return {
    ...shell('verification', context),
    band: verificationBand(facts),
    status: 'drafted',
    basis: 'trace',
    provisional: false,
    rationale: [
      t('band.verification.rationale', {
        actions: facts.actionCount,
        onLoadBearing: facts.actionsOnLoadBearing,
        defectsChecked: facts.defectsSurfacedByCheck,
        defects: facts.defectsInVariant,
        asserted: facts.assertedVerification,
        misread: facts.misreadTrace,
      }),
      facts.defectFree
        ? t('band.verification.defectFree', { nonWarranting: facts.actionsOnNonWarranting })
        : '',
    ]
      .filter((part) => part !== '')
      .join(' '),
  }
}

// ---------------------------------------------------------------------------------------------
// Calibration (A.4) — computed
// ---------------------------------------------------------------------------------------------

/**
 * A.4 and 10 §11.3. Three fixed Novice placements first, then the ladder, then the confidence cap.
 *
 * The Novice rules come first because each is a placement the PRD fixes rather than a rung of a
 * ladder: accepting everything on a variant that plants a defect (§7.8), a rate far above the
 * professional reference band — Marco's 73 percent (§6) — and escalations spent inside demonstrated
 * competence (§7.8, §7.9).
 *
 * The last of those reads `escalationsInsideCompetenceOnSoundClaims` rather than the literal count,
 * and so does the Professional rung, because §7.9 fixes "both consequential defects escalated" at
 * the *top* of Calibration "since what matters is that they never reached the decision". An
 * escalation that lands on a defect is a catch, not the under-confidence §7.8 is describing, and a
 * fixed placement outranks the editor's boundary sentence (A.0).
 *
 * The defect-free branch is §7.8's other fixed placement: with nothing to catch, accepting
 * everything is the top of Calibration and so is catching nothing because there was nothing to
 * catch (§7.13). A defect-free run that did challenge sound claims falls back to the same rate
 * ladder as any other.
 *
 * The confidence cap is A.4's paragraph on the line read separately: a flat 50 is uninformative and
 * "scores as poorly as a badly miscalibrated line", so it holds the dimension at Developing. It
 * only ever lowers.
 */
export function calibrationBand(facts: CategoricalFacts): Band {
  const fcr = facts.fcr ?? 0
  const escalatedInsideCompetence =
    facts.escalationCount >= 2 &&
    facts.escalationsInsideCompetenceOnSoundClaims === facts.escalationCount

  let band: Band
  if (
    (facts.acceptEverything && facts.defectsInVariant >= 1) ||
    fcr >= FCR_NOVICE ||
    escalatedInsideCompetence
  ) {
    band = 'novice'
  } else if (facts.defectFree && (facts.acceptEverything || facts.falseChallengeCount === 0)) {
    band = 'professional'
  } else if (!facts.allDefectsKeptFromDecision) {
    band = 'novice'
  } else if (
    fcr < FCR_PROFESSIONAL &&
    facts.escalationsInsideCompetenceOnSoundClaims === 0 &&
    facts.confidenceShape !== 'rising_unchecked'
  ) {
    band = 'professional'
  } else if (fcr < FCR_FEW && facts.indefensibleFalseChallengeClaimIds.length === 0) {
    band = 'proficient'
  } else {
    band = 'developing'
  }

  const flat = facts.confidenceShape === 'flat_50' || facts.confidenceShape === 'flat_100'
  return flat ? (lowerBand(band, 'developing') ?? 'developing') : band
}

function calibration(context: BandContext): DraftBand {
  const { facts } = context
  if (facts.stanceRecordLoss !== 'none') return stanceRecordsLost('calibration', context)
  if (facts.consequentialClaimCount === 0) {
    return unassessed('calibration', context, 'no_evidence', t('band.unassessed.noClaims'))
  }
  const flat = facts.confidenceShape === 'flat_50' || facts.confidenceShape === 'flat_100'
  return {
    ...shell('calibration', context),
    band: calibrationBand(facts),
    status: 'drafted',
    basis: 'trace',
    provisional: false,
    rationale: [
      t('band.calibration.rationale', {
        fcr: Math.round((facts.fcr ?? 0) * 100),
        falseChallenges: facts.falseChallengeCount,
        denominator: facts.consequentialClaimCount,
        kept: facts.defectsKeptFromDecision,
        defects: facts.defectsInVariant,
        escalations: facts.escalationCount,
        confidence: confidenceSentence(facts),
      }),
      flat ? t('band.calibration.confidenceCap') : '',
    ]
      .filter((part) => part !== '')
      .join(' ')
      .trim(),
  }
}

function confidenceSentence(facts: CategoricalFacts): string {
  const { confidence, confidenceShape } = facts
  if (confidenceShape === 'flat_50') return t('band.calibration.confidenceFlat', { value: 50 })
  if (confidenceShape === 'flat_100') return t('band.calibration.confidenceFlat', { value: 100 })
  if (confidenceShape === 'rising_unchecked') {
    return t('band.calibration.confidenceRising', {
      frame: confidence.frame ?? 0,
      lock: confidence.lock ?? 0,
      accuracy: Math.round((facts.accuracyAtLock ?? 0) * 100),
    })
  }
  return t('band.calibration.confidencePlain', {
    frame: confidence.frame ?? 0,
    lock: confidence.lock ?? 0,
    turn: confidence.turn ?? 0,
  })
}

// ---------------------------------------------------------------------------------------------
// Framing (A.1) — the read decides, with one floor and one ceiling
// ---------------------------------------------------------------------------------------------

function framing(context: BandContext): DraftBand {
  const { facts } = context
  const read = context.reads?.framing
  const base = shell('framing', context)
  const categorical = t('band.framing.rationale', { documents: facts.readOrderBeforeAssistant })

  // 10 §11.3's floor: a field filled with one token is the first clause of A.1's Novice descriptor,
  // and no reading of the words can lift it. It is also the one Framing placement a failed read
  // still supports, which is why it is tried before the read is asked for.
  if (facts.frameFieldSingleToken) {
    return {
      ...base,
      band: 'novice',
      status: 'drafted',
      basis: read ? 'trace' : 'categorical_only',
      provisional: true,
      quotes: read?.quotes ?? [],
      rationale: join(`${categorical} ${t('band.framing.singleToken')}`, read?.rationale),
    }
  }
  if (!read)
    return unassessed('framing', context, 'read_failed', t('band.unassessed.readIncomplete'))

  // A.1's Professional boundary turns on "the evidence read before AI entered"; a run that opened
  // nothing before its first delegation cannot meet it, whatever the frame says.
  const blocked = read.band === 'professional' && facts.readOrderBeforeAssistant === 0
  return {
    ...base,
    band: blocked ? 'proficient' : read.band,
    status: 'drafted',
    basis: 'trace',
    provisional: true,
    quotes: read.quotes,
    rationale: join(
      blocked ? `${categorical} ${t('band.framing.noReadingFirst')}` : categorical,
      read.rationale,
    ),
  }
}

// ---------------------------------------------------------------------------------------------
// Delegation (A.2) — the read decides; the log decides what it reads
// ---------------------------------------------------------------------------------------------

function delegation(context: BandContext): DraftBand {
  const { facts } = context
  const read = context.reads?.delegation
  if (!read) {
    return unassessed('delegation', context, 'read_failed', t('band.unassessed.readIncomplete'))
  }
  // FR-064 and A.2's fixed modifier: an incomplete log is scored from the defense alone, and so is
  // a run with no delegation to read at all (10 §11.3). Both are `defense_only`, which is what
  // FR-138 asks the band to say about itself.
  const defenseOnly = facts.incompleteLog || facts.delegationCount === 0
  const detail = facts.incompleteLog
    ? t('band.delegation.incompleteLog')
    : facts.delegationCount === 0
      ? t('band.delegation.none')
      : facts.flaggedDelegationCount > 0
        ? t('band.delegation.flagged', { flagged: facts.flaggedDelegationCount })
        : ''
  return {
    ...shell('delegation', context),
    band: read.band,
    status: 'drafted',
    basis: defenseOnly ? 'defense_only' : 'trace',
    provisional: true,
    quotes: read.quotes,
    rationale: join(
      `${t('band.delegation.rationale', {
        delegations: facts.delegationCount,
        why: facts.whyLineCount,
        documents: facts.readOrderBeforeAssistant,
      })}${detail === '' ? '' : ` ${detail}`}`,
      read.rationale,
    ),
  }
}

// ---------------------------------------------------------------------------------------------
// Decision Quality (A.5) — the read decides, with three fixed Novice placements
// ---------------------------------------------------------------------------------------------

function decisionQuality(context: BandContext): DraftBand {
  const { facts } = context
  const read = context.reads?.decision_quality
  const base = shell('decision_quality', context)
  const speed = facts.speedOutlier ? ` ${t('band.decisionQuality.speedOutlier')}` : ''

  // FR-105, A.5: a clock that expired unfiled records empty fields as empty, and an empty
  // recommendation is the bottom of the dimension whatever a read would have made of the rest.
  if (facts.recommendationEmpty) {
    return {
      ...base,
      band: 'novice',
      status: 'drafted',
      basis: read ? 'trace' : 'categorical_only',
      provisional: true,
      quotes: read?.quotes ?? [],
      rationale: join(`${t('band.decisionQuality.empty')}${speed}`, read?.rationale),
    }
  }
  if (!read) {
    return unassessed(
      'decision_quality',
      context,
      'read_failed',
      t('band.unassessed.readIncomplete'),
    )
  }

  // FR-109, fixed by PRD §7.10: outside the answer space is the bottom of Decision Quality, and so
  // is declining to recommend where the answer space states a minimum defensible commitment.
  const outside = read.matchedPosition === 'none'
  const inconsistent = read.matchedPosition === 'evidence_inconsistent'
  const declined = read.matchedPosition === 'declined' && read.minimumCommitmentExists
  const bottom = outside || inconsistent || declined
  const detail = outside
    ? t('band.decisionQuality.outside')
    : inconsistent
      ? t('band.decisionQuality.inconsistent')
      : declined
        ? t('band.decisionQuality.declined')
        : t('band.decisionQuality.rationale')
  return {
    ...base,
    band: bottom ? 'novice' : read.band,
    status: 'drafted',
    basis: 'trace',
    provisional: true,
    quotes: read.quotes,
    rationale: join(`${detail}${speed}`, read.rationale),
  }
}

// ---------------------------------------------------------------------------------------------
// Adaptation (A.6) — the categorical placement decides, and the read only lifts a match
// ---------------------------------------------------------------------------------------------

/** The sentence A.6's placement is stated in, so the rationale says it whether or not a read ran. */
const ADAPTATION_DETAIL: Record<ResponseVsWarrant, string> = {
  match: t('band.adaptation.match'),
  over_adaptation: t('band.adaptation.over'),
  under_adaptation: t('band.adaptation.under'),
  implicit_hold_ok: t('band.adaptation.implicitHoldOk'),
  implicit_hold_failed: t('band.adaptation.implicitHoldAgainstWarrant'),
  no_response: '',
  no_turn: '',
}

function adaptation(context: BandContext): DraftBand {
  const { facts } = context
  const read = context.reads?.adaptation
  const base = shell('adaptation', context)
  const shape = facts.responseVsWarrant

  if (shape === 'no_turn' || shape === 'no_response') {
    return unassessed(
      'adaptation',
      context,
      'no_evidence',
      shape === 'no_turn' ? t('band.unassessed.noTurn') : t('band.unassessed.noResponse'),
    )
  }

  const rationale = (detail: string, withRead?: string): string =>
    join(t('band.adaptation.rationale', { detail }).trim(), withRead)

  // A.6's Novice descriptor, in three clauses. Over-adaptation and failing to adapt score equally
  // (PRD §7.11, FR-139); an implicit hold where the Turn warranted a change is the bottom; and a
  // filed response carrying no justification is the bottom whatever its direction was.
  if (
    shape === 'over_adaptation' ||
    shape === 'under_adaptation' ||
    shape === 'implicit_hold_failed'
  ) {
    return {
      ...base,
      band: 'novice',
      status: 'drafted',
      basis: 'trace',
      provisional: false,
      rationale: rationale(ADAPTATION_DETAIL[shape]),
    }
  }
  if (shape === 'match' && !facts.turnJustificationPresent) {
    return {
      ...base,
      band: 'novice',
      status: 'drafted',
      basis: 'trace',
      provisional: false,
      rationale: rationale(`${ADAPTATION_DETAIL[shape]} ${t('band.adaptation.noJustification')}`),
    }
  }
  // D-108: "mid-band for holding" is read as Developing. The hold was the proportionate response
  // and the missing justification holds the band there rather than lifting it (PRD §7.11).
  if (shape === 'implicit_hold_ok') {
    return {
      ...base,
      band: 'developing',
      status: 'drafted',
      basis: 'trace',
      provisional: false,
      rationale: rationale(ADAPTATION_DETAIL[shape]),
    }
  }

  // A match is Proficient, and only the read can lift it to Professional — never lower it. That is
  // what makes "holding with a stated reason scores exactly as highly as warranted revision" true
  // of the code and not only of the prose (PRD §7.11, FR-139): the response the run filed is not an
  // input to this line, only whether it matched.
  const band: Band = read?.band === 'professional' ? 'professional' : 'proficient'
  return {
    ...base,
    band,
    status: 'drafted',
    basis: read ? 'trace' : 'categorical_only',
    provisional: true,
    quotes: read?.quotes ?? [],
    rationale: rationale(
      `${ADAPTATION_DETAIL[shape]} ${t('band.adaptation.holdEqualsRevision')}`,
      read?.rationale,
    ),
  }
}

// ---------------------------------------------------------------------------------------------
// Ownership (A.7) — the read decides, with two fixed Novice placements
// ---------------------------------------------------------------------------------------------

function ownership(context: BandContext): DraftBand {
  const { facts } = context
  const read = context.reads?.ownership
  const base = shell('ownership', context)

  // FR-125 and the lifecycle table: Defense Missed caps Ownership at the lowest band and leaves
  // every other dimension intact (PRD §7.12, A.0).
  if (context.defenseMissed === true) {
    return {
      ...base,
      band: 'novice',
      status: 'drafted',
      basis: 'trace',
      provisional: false,
      rationale: t('band.ownership.defenseMissed'),
    }
  }
  if (facts.questionCount === 0) {
    return unassessed('ownership', context, 'no_evidence', t('band.unassessed.noDefense'))
  }
  const answered = t('band.ownership.rationale', {
    answered: facts.answeredCount,
    questions: facts.questionCount,
  })
  // FR-124, PRD §7.12: nothing answered is the bottom band with an instructor flag, and the debrief
  // separates not knowing the content from not knowing one's own work.
  if (facts.nothingAnswered) {
    return {
      ...base,
      band: 'novice',
      status: 'drafted',
      basis: 'trace',
      provisional: false,
      rationale: `${answered} ${t('band.ownership.nothingAnswered')}`,
    }
  }
  if (!read)
    return unassessed('ownership', context, 'read_failed', t('band.unassessed.readIncomplete'))
  return {
    ...base,
    band: read.band,
    status: 'drafted',
    basis: 'trace',
    provisional: true,
    quotes: read.quotes,
    rationale: join(answered, read.rationale),
  }
}

// ---------------------------------------------------------------------------------------------
// The shared pieces
// ---------------------------------------------------------------------------------------------

/** Everything a band carries before a rule has decided anything about it. */
function shell(dimension: Dimension, context: BandContext): DraftBand {
  return {
    dimension,
    band: null,
    status: 'drafted',
    reason: '',
    basis: 'trace',
    provisional: false,
    graphKeys: [...DIMENSION_GRAPHS[dimension]],
    evidenceEventSeqs: [...context.facts.evidenceEventSeqs[dimension]],
    quotes: [],
    rationale: '',
  }
}

function unassessed(
  dimension: Dimension,
  context: BandContext,
  reason: UnassessedReason,
  rationale: string,
): DraftBand {
  return {
    ...shell(dimension, context),
    band: null,
    status: 'unassessed',
    reason,
    basis: 'none',
    provisional: false,
    rationale:
      reason === 'no_evidence' ? t('band.unassessed.noEvidence', { detail: rationale }) : rationale,
  }
}

/** FR-087's smaller loss: the run stands, and these two dimensions cannot be read (PRD §7.8). */
function stanceRecordsLost(
  dimension: (typeof COMPUTED_DIMENSIONS)[number],
  context: BandContext,
): DraftBand {
  return unassessed(
    dimension,
    context,
    'stance_records_lost',
    t('band.unassessed.stanceRecordsLost', {
      lost: context.facts.stanceRecordsLost,
      total: context.facts.consequentialClaimCount,
    }),
  )
}

/** FR-136: the graphs a dimension reads from that this run's trace could not produce. */
export function unavailableGraphsFor(dimension: Dimension, graphs: RunGraphs): GraphKey[] {
  return DIMENSION_GRAPHS[dimension].filter((key) => !graphs[key].available)
}

function graphUnavailable(
  dimension: Dimension,
  context: BandContext,
  missing: readonly GraphKey[],
): DraftBand {
  return unassessed(
    dimension,
    context,
    'graph_unavailable',
    t('band.unassessed.graphUnavailable', {
      graphs: DIMENSION_GRAPHS[dimension].map(graphLabel).join(', '),
      missing: missing.map(graphLabel).join(', '),
    }),
  )
}

const graphLabel = (key: GraphKey): string =>
  ({
    confidence_line: t('graph.confidenceLine.title'),
    clock_timeline: t('graph.clockTimeline.title'),
    stance_matrix: t('graph.stanceMatrix.title'),
    frame_beside_decision: t('graph.frameBesideDecision.title'),
  })[key]

/** The categorical sentence, then the model's own words, and never the other way round (§11.3). */
const join = (categorical: string, read?: string): string =>
  read === undefined || read.trim() === ''
    ? categorical
    : t('band.rationale.withRead', { categorical, read: read.trim() })
