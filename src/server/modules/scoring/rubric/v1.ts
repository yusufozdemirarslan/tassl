// Rubric version 1 — PRD Appendix A.1 to A.7, transcribed (FR-142, DATA-053, D-033).
//
// **Every string in the seven data blocks below is assessment copy, copied character for character
// from `docs/prd/Tassl-PRD.md` Appendix A.** Nothing here is paraphrased, tightened or corrected.
// That is not a stylistic preference: a band is a descriptive placement a human reviewer is held to
// and a student may appeal against (PRD §7.13, §7.17), the descriptors are handed to the five band
// reads as the standard they read against (11 §2.1), and A.0 fixes who may change them — the
// builder edits the three interior boundary sentences of each dimension before the build, the pilot
// calibrates them afterwards, and the Novice and Professional descriptors and the fixed modifiers
// "restate PRD text and change only if that text changes". A sentence improved in transit would
// make the rubric this file claims to be and the rubric the PRD publishes two different documents.
// `tests/unit/scoring/rubric.test.ts` re-reads Appendix A out of the PRD on every run and fails on
// any drift, in either direction.
//
// **The version is the artifact.** D-033: `run_scores.rubric_version` records the version a run
// was scored against, editing produces `v2.ts` and a registry bump, and scored runs keep their
// version. So nothing in this file is ever edited in place once a run has been scored against it.
//
// **Why the copy lives here and not in the i18n catalogue.** Every user-facing string in this
// codebase goes through `t()`; this one does not, and the exception is D-033's. A rubric is a
// versioned artifact a scored run points back to, and the catalogue is a single mutable document
// with no versions in it — putting the descriptors there would let an edit to A.4 change what an
// already-scored run says it was scored against, which is the one property D-033 exists to keep.
// The strings are also not UI chrome: they are the standard itself, quoted into the debrief, the
// faculty replay and the band-read prompts alike.
//
// What is *not* transcribed: the Anchor column of each table. D-033 names three things — the
// descriptors, the fixed modifiers, and the boundary sentences — and an anchor is Appendix A's note
// on *where a placement came from* ("Fixed: 7.9", "Proposed, not anchored"), provenance for a
// reader of the PRD rather than a standard anything is read against. Where an anchor decides a
// conflict, `bands.ts` cites it at the rule it decides.
import { AppError } from '@/lib/errors'

// ---------------------------------------------------------------------------------------------
// The vocabulary (06-data-model.md §3.2; 10-backend-spec-modules.md §11)
// ---------------------------------------------------------------------------------------------

/** The seven dimensions of PRD §7.13, in the order Appendix A and the debrief present them. */
export const DIMENSIONS = [
  'framing',
  'delegation',
  'verification',
  'calibration',
  'decision_quality',
  'adaptation',
  'ownership',
] as const
export type Dimension = (typeof DIMENSIONS)[number]

/** The four bands, ascending. That order is the whole of the FR-005 floor's arithmetic. */
export const BANDS = ['novice', 'developing', 'proficient', 'professional'] as const
export type Band = (typeof BANDS)[number]

/** The three interior boundaries A.0 hands the builder, named for the pair they sit between. */
export const BOUNDARIES = [
  'novice_to_developing',
  'developing_to_proficient',
  'proficient_to_professional',
] as const
export type Boundary = (typeof BOUNDARIES)[number]

export type DimensionRubric = {
  dimension: Dimension
  /** The Appendix A section this dimension was transcribed from. */
  appendix: string
  /** The dimension's name, as Appendix A heads its section. */
  title: string
  /** The four draft descriptors, verbatim. */
  descriptors: Readonly<Record<Band, string>>
  /** The "Fixed modifiers." paragraph, verbatim, including its leading label. */
  fixedModifiers: string
  /** The three [EDIT] boundary sentences, verbatim, including their [EDIT] label. */
  boundaries: Readonly<Record<Boundary, string>>
}

export type Rubric = {
  version: string
  source: string
  /**
   * A.0: "Until then a boundary is a descriptive draft against the authored standard, not a
   * validated cut score." It is carried on the artifact so every screen that shows a band can say
   * so (FR-141) by reading the rubric rather than by restating it.
   */
  uncalibrated: boolean
  dimensions: Readonly<Record<Dimension, DimensionRubric>>
}

// ---------------------------------------------------------------------------------------------
// Appendix A.1 to A.7, verbatim
// ---------------------------------------------------------------------------------------------

const FRAMING: DimensionRubric = {
  dimension: 'framing',
  appendix: 'A.1',
  title: 'Framing',
  descriptors: {
    novice:
      'Fields filled to pass the gate without stating a decision: one word per field, a decision that is not the one the brief owns, or assumptions that restate the position rather than name what it rests on. A framing outside the answer space, named with the evidence it missed, sits here.',
    developing:
      'The decision the brief owns is stated, but the position is a confident guess without reasons, or at most one of the three assumptions is something the decision would fail without. An honest "I do not know" with a reason and confidence under 30 sits above a confident guess.',
    proficient:
      'The decision matches the one the brief owns, at least two of the three assumptions are ones the Evidence Room bears on, the position is inside the answer space, and the confidence number has a stated reason.',
    professional:
      'Decision, all three assumptions, and lean are inside the answer space; each assumption can be traced to Evidence Room material or is named as an unknown; confidence matches the thinness of the evidence read before AI entered. The Section 6 frame (the decision, three named load-bearing assumptions, a lean toward holding, confidence 40) is the worked example, with no band named for it.',
  },
  fixedModifiers:
    'Fixed modifiers. An assumption named in the frame that the Turn later disrupts is credited in Adaptation, not here (7.4). A frame written with an outside assistant costs in the defense, not here; Tassl neither detects nor accuses (7.4). The frame is immutable and is the baseline for Adaptation (7.4).',
  boundaries: {
    novice_to_developing:
      '[EDIT] Novice to Developing: A frame leaves Novice when it states the decision the brief owns and at least one assumption the decision would fail without.',
    developing_to_proficient:
      '[EDIT] Developing to Proficient: A frame reaches Proficient when the position sits inside the answer space and at least two of the three assumptions are load-bearing and testable against Evidence Room material.',
    proficient_to_professional:
      '[EDIT] Proficient to Professional: A frame reaches Professional when all three assumptions are load-bearing, the position and confidence are consistent with the evidence read before AI entered, and any unknown is named as an unknown rather than guessed.',
  },
}

const DELEGATION: DimensionRubric = {
  dimension: 'delegation',
  appendix: 'A.2',
  title: 'Delegation',
  descriptors: {
    novice:
      "The decision itself is handed over: the whole answer asked for at once and adopted with nothing retained, the Evidence Room never opened, or the assistant's summary of the room used in place of the documents it flattened. Never using the assistant in a computation-driven scenario with no stated reason sits here.",
    developing:
      'Delegations are legitimate units of work but unreasoned: what came back is used without retaining the decision-relevant parts (which document, which date, which cohort), and no reason for delegating is stated.',
    proficient:
      'Production work (reading, computing, comparing, drafting) is delegated; the decision, its assumptions, and the evaluation of each consequential claim are retained; a reason is stated when the log asks for one.',
    professional:
      'Delegation is sequenced and reasoned: Evidence Room material read before first use of the assistant, each delegation scoped to what the student can evaluate, and the choice not to delegate stated and reasonable, which in a short judgment call can be excellent.',
  },
  fixedModifiers:
    'Fixed modifiers. An incomplete log is scored from the defense alone (7.6). Everything declared as outside is taken at face value, and the thin in-environment log is reported as fact, not judgment (7.6). Declaring outside-tool use never lowers a band or a point (7.6). With no consequential AI claims, Delegation is scored on the justification for not delegating (7.13). Asking the assistant to summarize the room is a legitimate delegation (7.2).',
  boundaries: {
    novice_to_developing:
      '[EDIT] Novice to Developing: Delegation leaves Novice when the student handed over specific tasks rather than the decision, and the log shows which returned claims they used.',
    developing_to_proficient:
      '[EDIT] Developing to Proficient: Delegation reaches Proficient when the decision, its assumptions, and the evaluation of every consequential claim stayed with the student, and each delegation can be explained in the defense.',
    proficient_to_professional:
      '[EDIT] Proficient to Professional: Delegation reaches Professional when the sequence shows the student decided what to hand over before handing it over: evidence read before the assistant was first used, and each choice to delegate or not to delegate stated with a reason that fits the scenario type.',
  },
}

const VERIFICATION: DimensionRubric = {
  dimension: 'verification',
  appendix: 'A.3',
  title: 'Verification',
  descriptors: {
    novice:
      'No check reached a claim the decision rested on: the Evidence Room never opened, consequential claims accepted untraced when a 1-minute Source Trace would have surfaced the superseding document, or verification asserted without an action.',
    developing:
      'Checks were run but did not bear on the decision or were misread: Replication Checks on claims that were not load-bearing, a Decomposition Check on a single-step claim, or the right action with the date misread.',
    proficient:
      "At least one check landed on a load-bearing claim and its result, including source and date, was read correctly; in a defect-free run, checks were confined to claims that warranted one under 7.8 (load-bearing, high consequence, cheap to check, weakly sourced, volatile, or outside the learner's competence).",
    professional:
      'Every planted consequential defect was surfaced by a check capable of changing the decision, or, in a defect-free run, every check that ran landed on a claim warranting one under 7.8 and its result including date and source was read correctly, the limiting case being no checks where no claim warranted one. Whether the number of checks was proportionate to the stakes is charged to Calibration, not here.',
  },
  fixedModifiers:
    'Fixed modifiers. Right action with a wrong conclusion is separated in the debrief because the two need different coaching (7.7). A genuine unintended inconsistency found is credited as a correct challenge (7.2); an unplanted flaw found in a Critique Run is credited (7.15). An action started before the clock expires completes and its result returns (7.7). Verification is neutralized, not zeroed, on a retired variant (7.21).',
  boundaries: {
    novice_to_developing:
      '[EDIT] Novice to Developing: Verification leaves Novice when at least one interrogation action or stakeholder interview was run and its result was used in a stance, rather than verification being asserted or skipped.',
    developing_to_proficient:
      '[EDIT] Developing to Proficient: Verification reaches Proficient when at least one check landed on a claim the decision rested on and its result, including its date and source, was read correctly.',
    proficient_to_professional:
      '[EDIT] Proficient to Professional: Verification reaches Professional when every planted consequential defect was surfaced by a check capable of changing the decision, or, in a defect-free run, when no check was spent on a claim that did not warrant one.',
  },
}

const CALIBRATION: DimensionRubric = {
  dimension: 'calibration',
  appendix: 'A.4',
  title: 'Calibration',
  descriptors: {
    novice:
      "Reliance unrelated to claim quality in either direction: everything accepted in a two-defect run; every claim marked unsound in a Critique Run regardless of detections; a False Challenge Rate far above the professional reference band, as in Marco's 73 percent; or both escalations spent on claims inside demonstrated competence.",
    developing:
      'Reliance moves in the right direction but is disproportionate: a wide net that catches the consequential defect while challenging claims already traced clean, defensible only because information was thin; or a correct escalation followed by accepting the hedge without noticing it.',
    proficient:
      'Consequential claims stanced in proportion to their quality and stakes, with disproportion confined to non-consequential claims: no consequential defect reached the decision unexamined, false challenges are few and fall on weakly sourced or high-stakes claims, and each escalation names a real limit.',
    professional:
      "Reliance proportionate across the run: every consequential defect the variant plants kept from the decision, by escalation or by challenge, rejection, or verification, even with no personal detection, which is both defects in the two-defect run of 7.8 and 7.9 and the single defect in the build's defective variant; in a defect-free run, everything accepted, or nothing caught because there was nothing to catch; False Challenge Rate below the professional reference band of 15 percent, a hypothesis to calibrate.",
  },
  fixedModifiers:
    "Fixed modifiers. A stance changed after an action is exactly right and both stances are kept (7.8). With no consequential AI claims, Calibration is scored on Evidence Room stances (7.13). Calibration is reported unassessed where some stance records are lost, and the run is voided and re-offered at no cost where more than a third of consequential claims lose theirs, since the run cannot then be scored (7.8, Section 7 standing rules). Readiness results do not justify a harsher band for a knowledge gap (7.1); when the check cannot be completed, the escalation band is widened (7.1). Calibration is neutralized, not zeroed, on a retired variant (7.21). Section 10's Calibration Gain figures (baseline near 55 percent proportionate, target near 73 percent) are cohort-level planning hypotheses, not band boundaries.",
  boundaries: {
    novice_to_developing:
      '[EDIT] Novice to Developing: Calibration leaves Novice when stances differ across claims in a way that tracks evidence or stakes, no consequential defect the variant plants reached the decision unexamined, and the challenges of clean claims can be defended by the thinness of the information at the time. On a variant that plants no defect the second condition is met with nothing to catch, and what lifts the run out of Novice is the first: reliance varied with the authored evidence status, importance, and stakes of the claims rather than being uniform across them.',
    developing_to_proficient:
      "[EDIT] Developing to Proficient: Calibration reaches Proficient when every consequential defect was kept from the decision by challenge, rejection, verification, or escalation, and false challenges are confined to claims that were load-bearing, weakly sourced, or outside the student's competence.",
    proficient_to_professional:
      '[EDIT] Proficient to Professional: Calibration reaches Professional when the False Challenge Rate is below the professional reference band (15 percent, a hypothesis), escalations fall only on claims outside demonstrated competence, and the confidence line rises with checked rather than unchecked claims.',
  },
}

const DECISION_QUALITY: DimensionRubric = {
  dimension: 'decision_quality',
  appendix: 'A.5',
  title: 'Decision Quality',
  descriptors: {
    novice:
      'Recommendation outside the answer space, the debrief naming the evidence it ignores; a brief that declines to recommend where the answer space states a minimum defensible commitment; or a brief auto-locked with the recommendation field empty.',
    developing:
      'Recommendation inside the answer space, but the rationale rests on a claim the evidence available before lock contradicted or superseded, or the stated assumptions do not support the recommendation: the position is defensible, the grounds given are not.',
    proficient:
      'Recommendation inside the answer space; rationale and the three assumptions supported by current Evidence Room material; "what would change my mind" names a real condition.',
    professional:
      'Recommendation inside the answer space; rationale traceable to current rather than superseded documents; assumptions that are the ones the recommendation actually turns on; a change-my-mind condition specific enough that the Turn could test it.',
  },
  fixedModifiers:
    "Fixed modifiers. A recommendation identical to the assistant's is not penalized (7.10). A poorly scored decision defended well moves Decision Quality up (7.12). A 4-minute lock is a speed outlier, a signal rather than a penalty (7.10). An instructor may add a course-specific position to the answer space for their own sections (7.17).",
  boundaries: {
    novice_to_developing:
      '[EDIT] Novice to Developing: Decision Quality leaves Novice when the recommendation is a position inside the answer space, or the minimum defensible commitment where the answer space allows declining.',
    developing_to_proficient:
      '[EDIT] Developing to Proficient: Decision Quality reaches Proficient when the rationale rests on claims the evidence available before lock supported and the three brief assumptions are the ones the recommendation depends on.',
    proficient_to_professional:
      '[EDIT] Proficient to Professional: Decision Quality reaches Professional when the rationale cites current rather than superseded documents, the recommendation would survive the loss of any single unchecked claim, and the stated change-my-mind condition is specific enough to be tested by the Turn.',
  },
}

const ADAPTATION: DimensionRubric = {
  dimension: 'adaptation',
  appendix: 'A.6',
  title: 'Adaptation',
  descriptors: {
    novice:
      'Response disproportionate in either direction: full reversal on information warranting a marginal adjustment, or no change when the Turn warranted one, the two scoring equally poorly; or a filed response carrying no justification. An implicit hold where the Turn warranted no change is not Novice and sits at Developing under the fixed modifier below.',
    developing:
      'The direction is right but the size or reasoning is not: where the Turn did not warrant a change, an implicit hold with no justification sits mid-band for the holding decision itself; a revision that never mentions the Turn is scored on substance and flagged for the defense.',
    proficient:
      'Hold, revise, or reverse matches what the Turn warrants, the size of the change matches the size of the new information, and the justification refers to the Turn and to the frozen frame.',
    professional:
      'Proportionate response with a justification that ties the Turn to a named frame assumption: either the assumption named before AI entered is the one the response turns on, or a reasoned hold explains why the new information does not move a load-bearing assumption. A hold with a stated reason and a warranted revision score identically here.',
  },
  fixedModifiers:
    "Fixed modifiers. Where no response was filed and the Turn did not warrant a change, the hold and the missing justification resolve to one band: the hold sits mid-band at Developing and the missing justification holds the band there rather than lifting it, so the run bands Developing and the debrief records both components separately (7.11). Where no response was filed and the Turn did warrant a change, the run failed to adapt and bands Novice (7.11). A claim to have anticipated the Turn is checked live against the frozen frame (7.11). A Turn contradicting something verified before lock is the intended hard case; holding and revising are both defensible (7.11). A Turn later found miscalibrated is re-authored and affected Adaptation bands are neutralized (7.11). A defensible decision the Turn later undermines remains defensible in Decision Quality (7.11). Nadia's run one (complete reversal on one retention figure when her frozen frame named supplier cost) and run four (holds through the Turn with a reason) are the worked examples of the two ends, with no band named for either (6).",
  boundaries: {
    novice_to_developing:
      '[EDIT] Novice to Developing: Adaptation leaves Novice when the response is in the direction the Turn warrants, even if its size or justification is wrong.',
    developing_to_proficient:
      '[EDIT] Developing to Proficient: Adaptation reaches Proficient when the size of the change matches the size of the new information and the justification names the Turn and the frozen assumption it bears on.',
    proficient_to_professional:
      '[EDIT] Proficient to Professional: Adaptation reaches Professional when the justification shows the Turn was weighed against the frame rather than replacing it: an assumption named before AI entered is the one the response turns on, or a reasoned hold explains why the new information does not move a load-bearing assumption.',
  },
}

const OWNERSHIP: DimensionRubric = {
  dimension: 'ownership',
  appendix: 'A.7',
  title: 'Ownership',
  descriptors: {
    novice:
      'Defense missed; nothing answered; or every provenance question receiving the same answer because the Evidence Room was never opened.',
    developing:
      'Answers restate the brief: the brief read aloud triggers a follow-up that cannot be answered from it, and that follow-up goes unanswered; the student can say what was decided but not where the numbers came from or what the assistant did.',
    proficient:
      'Provenance, verification choices, and assumptions answered from the student\'s own record; gaps admitted, with an accurate "I do not know" paired with what they would do about it; confidence and the frame-to-revision relationship explained.',
    professional:
      "The final decision and the assistant's role explained without the record's help and under follow-ups three levels deep: which claims came from the assistant, which were checked, which were not and why, and what the Turn changed relative to the frozen frame.",
  },
  fixedModifiers:
    "Fixed modifiers. A Coherence Gap is a coaching hypothesis, not evidence of misconduct, and carries no automatic penalty (7.12). A defense taken at hour 47 after reconstructing the reasoning is legitimate and recorded as timing (7.12). A poorly scored decision defended well moves Decision Quality up (7.12). One word per field in the frame and undeclared outside use cost here, from the student's own record, or not at all (7.4, 7.6). Nothing answered is separated in the debrief into not knowing the content and not knowing one's own work (7.12). In Critique Runs, Ownership is banded from two follow-up questions, spoken or typed, 90 seconds total (7.15).",
  boundaries: {
    novice_to_developing:
      '[EDIT] Novice to Developing: Ownership leaves Novice when the student attempts the questions and can state, in their own words, what they decided and what the assistant was asked to do.',
    developing_to_proficient:
      '[EDIT] Developing to Proficient: Ownership reaches Proficient when provenance questions (which document, which cohort, from when) are answered correctly for the claims the decision rested on, and any gap is admitted with a stated next step rather than guessed.',
    proficient_to_professional:
      '[EDIT] Proficient to Professional: Ownership reaches Professional when every follow-up the run asked was answered without reference to the brief, or no follow-up was asked because every first answer already named its source, number, or reason (7.12); when the assistant\'s role and its unchecked claims are described accurately; and when the frame-to-revision reasoning holds under the counterfactual question the confirmed bank carries for the scenario, of the "what payback becomes if churn is 20 percent worse" kind (6). Where the bank carries no counterfactual question, the condition is not applied and the band rests on the first two.',
  },
}

/** The rubric the build scores against (FR-142): Appendix A as the editor drafted it. */
export const v1: Rubric = {
  version: 'v1',
  source: 'docs/prd/Tassl-PRD.md Appendix A.1 to A.7',
  uncalibrated: true,
  dimensions: {
    framing: FRAMING,
    delegation: DELEGATION,
    verification: VERIFICATION,
    calibration: CALIBRATION,
    decision_quality: DECISION_QUALITY,
    adaptation: ADAPTATION,
    ownership: OWNERSHIP,
  },
}

// ---------------------------------------------------------------------------------------------
// Reading a band
// ---------------------------------------------------------------------------------------------

/** Where a band sits on the four-point ladder; the only ordering this codebase gives them. */
export function bandRank(band: Band): number {
  const rank = BANDS.indexOf(band)
  if (rank < 0) throw new AppError('INTERNAL_ERROR', `Unknown band: ${band}`)
  return rank
}

/**
 * The higher of two bands, with `null` (unassessed) below every band.
 *
 * This is the whole of FR-005's floor: "a correction for Tassl's own error can raise a band or
 * neutralize a dimension and never lowers a band". `before` wins ties, and a recompute that
 * leaves a dimension unassessed keeps the band the run already had rather than taking it away.
 */
export function higherBand(before: Band | null, after: Band | null): Band | null {
  if (after === null) return before
  if (before === null) return after
  return bandRank(after) > bandRank(before) ? after : before
}

/** The lower of two bands, with `null` below every band — how A.4's confidence cap is applied. */
export function lowerBand(a: Band | null, b: Band | null): Band | null {
  if (a === null || b === null) return null
  return bandRank(b) < bandRank(a) ? b : a
}
