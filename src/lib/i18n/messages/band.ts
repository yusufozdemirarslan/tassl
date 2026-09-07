// The seven drafted bands (PRD §7.13, Appendix A; FR-004, FR-131, FR-137, FR-138, FR-141).
//
// Two kinds of sentence live here, and neither of them is the rubric.
//
//   * **A rationale** — the one paragraph a band carries saying what the run recorded and which
//     recorded fact placed it. It is a template with numbers in it, filled by `bands.ts` from the
//     categorical facts, and where a model read the free text its rationale is appended after this
//     sentence rather than replacing it (10 §11.3). So the reproducible half of the reason is
//     always in the reader's hands, and the model's half is always marked as the model's.
//   * **An unassessed reason** — why a dimension holds no band. FR-004 is explicit that an
//     unassessable dimension is "reported unassessed, never estimated", so a reason has to say what
//     was missing precisely enough that an instructor can tell a broken run from a thin one.
//
// The band descriptors themselves are *not* here: they live in `scoring/rubric/v1.ts`, transcribed
// from Appendix A, because a rubric is a versioned artifact a scored run points back to and this
// catalogue has no versions in it (D-033).
//
// Two rules govern every sentence below, and they are the same two the graph namespace keeps.
//
//   * **Nothing evaluates.** A rationale reports counts and placements — "three interrogation
//     actions", "one of two authored defects" — and never says a run was good, weak, careless or
//     strong. The band is the placement; a second opinion beside it would be Tassl forming a view
//     about a person, which PRD §7.13 forbids in as many words.
//   * **No composite, no rank, no percentile** (FR-131). There is no word here for a total, a
//     position in a cohort, or a comparison with another student, and there is nothing to add one
//     to: a run's output is its bands with their evidence.
import { scopedT } from '../scoped'

export const band = {
  // ---------------------------------------------------------------------------------------------
  // The four bands and the two draft states
  // ---------------------------------------------------------------------------------------------
  'band.novice': 'Novice',
  'band.developing': 'Developing',
  'band.proficient': 'Proficient',
  'band.professional': 'Professional',
  'band.unassessed': 'Unassessed',
  'band.draft': 'Draft',

  // ---------------------------------------------------------------------------------------------
  // The seven dimensions (PRD §7.13)
  // ---------------------------------------------------------------------------------------------
  'band.dimension.framing': 'Framing',
  'band.dimension.delegation': 'Delegation',
  'band.dimension.verification': 'Verification',
  'band.dimension.calibration': 'Calibration',
  'band.dimension.decision_quality': 'Decision Quality',
  'band.dimension.adaptation': 'Adaptation',
  'band.dimension.ownership': 'Ownership',

  // ---------------------------------------------------------------------------------------------
  // Why a dimension holds no band (FR-004)
  // ---------------------------------------------------------------------------------------------
  'band.unassessed.graphUnavailable':
    'This dimension is read from {graphs}, and this run’s trace is missing the events {missing} is drawn from, so it is reported unassessed rather than estimated.',
  'band.unassessed.noEvidence':
    'This run holds no evidence for this dimension: {detail} It is reported unassessed rather than estimated.',
  'band.unassessed.stanceRecordsLost':
    '{lost} of {total} consequential claims lost their stance record, so what this run did with its claims cannot be read either way. Verification and Calibration are reported unassessed and excluded from the run’s points.',
  'band.unassessed.readIncomplete':
    'The reading of this run’s free text did not complete, and the recorded events on their own do not place this dimension.',
  'band.unassessed.noTurn': 'no Turn was delivered on this run, so there is no response to read.',
  'band.unassessed.noResponse':
    'the Turn was delivered and this run records no response to it, not even the hold a closing window files.',
  'band.unassessed.noDefense':
    'the defense recorded no questions, so there are no answers to read.',
  'band.unassessed.noClaims': 'the variant carries no consequential claim to take a stance on.',

  // ---------------------------------------------------------------------------------------------
  // Rationales, one template per dimension (10 §11.3)
  // ---------------------------------------------------------------------------------------------
  'band.framing.rationale':
    'Read from the frame locked before the assistant was in the room, with {documents} Evidence Room documents opened before the first delegation.',
  'band.framing.singleToken':
    'A frame field was filled with a single word, which is the first clause of the Novice descriptor.',
  'band.framing.noReadingFirst':
    'No Evidence Room document was opened before the assistant was first used, so the Professional descriptor’s condition on the evidence read before AI entered is not met.',

  'band.delegation.rationale':
    '{delegations} delegations, {why} of them carrying a stated reason, and {documents} documents opened before the first delegation.',
  'band.delegation.incompleteLog':
    'A delegation carries no response text, so this band is drafted from the defense answers instead of the log.',
  'band.delegation.none':
    'No delegation was made, so this band is drafted from what the run says about not delegating.',
  'band.delegation.flagged': '{flagged} delegations were flagged by a reviewer and left out.',

  'band.verification.rationale':
    '{actions} interrogation actions, {onLoadBearing} of them on load-bearing claims. {defectsChecked} of {defects} authored defects in this variant were surfaced by a check. {asserted} claims were marked verify with no action behind them, and {misread} were traced and then accepted.',
  'band.verification.defectFree':
    'This variant plants no defect, so there was nothing for a check to surface; {nonWarranting} checks fell on claims whose warranted stance was accept.',

  'band.calibration.rationale':
    'False Challenge Rate {fcr} percent: {falseChallenges} challenges or rejections of sound claims across {denominator} consequential claims. {kept} of {defects} authored defects were kept from the decision, and {escalations} escalations were spent. {confidence}',
  'band.calibration.confidenceRising':
    'Confidence rose from {frame} at the frame to {lock} at the lock while {accuracy} percent of the claims relied on had been checked or were sound.',
  'band.calibration.confidenceFlat':
    'Confidence was recorded at {value} at every point, which says nothing about the claims it was held over.',
  'band.calibration.confidencePlain':
    'Confidence was recorded at {frame}, {lock} and {turn} across the three points.',
  'band.calibration.confidenceCap':
    'A flat confidence line is uninformative, which holds this dimension at Developing.',

  'band.decisionQuality.rationale':
    'Read from the brief as it was filed, against the answer space the disciplinary authority confirmed.',
  'band.decisionQuality.empty':
    'The brief was locked with the recommendation field empty, which is recorded as empty.',
  'band.decisionQuality.outside':
    'The recommendation matches no position the answer space declares defensible.',
  'band.decisionQuality.inconsistent':
    'The recommendation matches a position the answer space records as inconsistent with the evidence.',
  'band.decisionQuality.declined':
    'The brief declines to recommend where the answer space states a minimum defensible commitment.',
  'band.decisionQuality.speedOutlier':
    'The brief was locked under four minutes of working time. That is an observation for the reviewer and no part of this placement.',

  /**
   * The Turn's authored warrant is never named in a sentence a student reads: `warrantsChange` and
   * `proportionateResponse` are forbidden in a student payload in every state (12 §8.1, D-384), and
   * the debrief shows this rationale. What the sentences below give is the reason for the
   * placement, which FR-153 requires, and not the answer key it was read against.
   */
  'band.adaptation.rationale':
    'Read from the response filed against the Turn, beside the frame locked before the assistant was in the room. {detail}',
  'band.adaptation.match': 'The response matched the warranted one.',
  'band.adaptation.over':
    'The response went further than the new information warranted, which is placed exactly as a response that went less far is.',
  'band.adaptation.under':
    'The response went less far than the new information warranted, which is placed exactly as a response that went further is.',
  'band.adaptation.implicitHoldOk':
    'The window closed unanswered, which files a hold. The Turn warranted no change, so the holding decision was the proportionate one and the missing justification holds the band where it is.',
  'band.adaptation.implicitHoldAgainstWarrant':
    'The window closed unanswered, which files a hold, and the Turn warranted a change.',
  'band.adaptation.noJustification': 'The response was filed with no justification.',
  'band.adaptation.holdEqualsRevision':
    'A hold with a stated reason and a warranted revision are placed identically.',

  'band.ownership.rationale':
    '{answered} of {questions} defense questions were answered, taken without the run record in front of the student.',
  'band.ownership.nothingAnswered':
    'Every question was met with an empty answer. The debrief separates not knowing the content from not knowing one’s own work.',
  'band.ownership.defenseMissed':
    'The defense was not taken, which caps this dimension and leaves every other dimension intact.',

  // ---------------------------------------------------------------------------------------------
  // The two halves of a reason, and the labels a draft carries (FR-141, FR-203)
  // ---------------------------------------------------------------------------------------------
  /** The categorical sentence, then the model's own words. Never the other way round. */
  'band.rationale.withRead': '{categorical} {read}',
  'band.provisional':
    'This band turns on free text a model read, so it is shown provisional until a reviewer confirms it.',

  // ---------------------------------------------------------------------------------------------
  // The two identifiers a band row can carry where a drafted one carries prose (D-463, D-515)
  //
  // A hand-banded held run stores the literal `manual` in `run_bands.rationale` on all seven
  // dimensions, and every unassessed dimension stores one of four `UnassessedReason` values in
  // `run_bands.draft_reason`. D-463 gave the reviewer's replay a sentence for each and left the
  // student's debrief and the Judgment Record printing `manual` and `no_evidence` at a person — on
  // the two surfaces D-468 calls the ones somebody may still be reading a year later. They live in
  // `band.` rather than in `review.` because all three screens draw them and one copy is the whole
  // point; `src/lib/band-prose.ts` is the single map from identifier to sentence.
  // ---------------------------------------------------------------------------------------------
  'band.rationaleManual':
    'This band was set by hand: nothing in the run placed it, and a reviewer chose it.',
  'band.unassessedReason.graph_unavailable':
    'The graphs this dimension is read from could not be drawn from this run’s trace.',
  'band.unassessedReason.no_evidence': 'This run holds nothing that places this dimension.',
  'band.unassessedReason.stance_records_lost':
    'The record of what this run did with its claims was lost, so it cannot be read either way.',
  'band.unassessedReason.read_failed':
    'The reading of this run’s free text did not come back, and the recorded events alone do not place this dimension.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(band)
