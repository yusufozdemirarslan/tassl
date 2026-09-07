// The faculty replay and the decisions taken on it (UI-033 to UI-035, FR-180 to FR-186, FR-003,
// FR-008). Phase 11.1 opens the namespace with the sentences the review service answers with; the
// screens of steps 11.3 and 11.4 add their own.
//
// Two rules govern every string here. None of them describes a student — a refusal is about the
// seat and the run, never about the person who took it — and none of them says "cheat",
// "misconduct" or anything of that shape: nothing Tassl observes is treated as misconduct (PRD §7
// standing rules), and a sentence a reviewer reads while deciding a band is exactly the wrong place
// to imply otherwise.
//
// **This namespace is held to the same three vocabularies the debrief is** (D-450, D-457):
// `tests/unit/lib/review-voice.test.ts` scans every key *and* value here for the misconduct, the
// character-and-motive and the ranking word lists, with no allowlist, exactly as
// `tests/unit/debrief/assembly.test.ts` scans `debrief.`. That is why several sentences below say a
// thing the long way round — the test control arms "an assistant outage" rather than a failure, a
// held run is one "nothing could place" rather than one that was not scored, and a void reason is
// "banding was held" rather than the column's own `scoring_held`. The product's own words for a run
// state (`Scored`) and for a failure family live in the `run.` and `claimObject.` namespaces, which
// this screen reads for those two things and this scan does not cover; nothing on this surface has
// to say them twice.
import { scopedT } from '../scoped'

export const review = {
  // 08 §4's TA row, in the two places it bites. The first is per dimension and travels as
  // `BAND_LOCKED_BY_INSTRUCTOR`; the second is the whole screen once the run is confirmed, and is a
  // plain FORBIDDEN because there is no single band to name.
  'review.taCannotRedecide':
    'The bands on this run are confirmed, so only the instructor can change one now. Ask the instructor for this section if a band should be decided again.',

  // ---------------------------------------------------------------------------------------------
  // The screen (UI-033)
  // ---------------------------------------------------------------------------------------------
  'review.metaTitle': 'Replay — {student}',
  'review.metaTitleFallback': 'Replay',
  'review.attemptLine': 'Attempt {attempt} · {variant}',
  'review.variantDefective': 'Defective variant',
  'review.variantSound': 'Sound variant',
  'review.backToAssignment': 'Back to the assignment',
  'review.viewsLabel': 'Replay views',
  'review.tabOverview': 'Overview',
  'review.tabBands': 'Bands',
  'review.tabTrace': 'Trace',
  'review.tabPackage': 'Package',
  'review.tabActions': 'Actions',
  'review.uncalibratedNote':
    'Every band here is a descriptive draft against the authored standard. The rubric has no field calibration yet and the difficulty profile is the authority’s estimate.',
  'review.taSeatNote':
    'You hold a teaching-assistant seat on this section. You can decide any dimension the instructor has not decided; voiding the run, entering a correction and the test control stay with the instructor.',
  'review.voidedBanner':
    'This run is voided. It carries no partial result, and no export written afterwards names it.',

  // ---------------------------------------------------------------------------------------------
  // Overview: the four graphs, the interview, the check, the declarations, the log
  // ---------------------------------------------------------------------------------------------
  'review.graphsTitle': 'The four graphs',
  'review.graphsDescription':
    'What this run plotted. Each band on the Bands view names the graphs it was read from.',
  'review.graphsEmptyTitle': 'No graphs yet',
  'review.graphsEmptyBody':
    'The four graphs are plotted when the run’s bands are drafted. This run has not reached that point.',

  'review.defenseTitle': 'Defense transcript',
  'review.defenseDescription':
    'The interview as it happened, with the notes the package author wrote for each question.',
  'review.defenseEmptyTitle': 'No interview yet',
  'review.defenseEmptyBody': 'The transcript appears once the student has taken the defense.',
  'review.defenseQuestionLabel': 'Question {seq}',
  'review.defenseFollowUpLabel': 'Question {seq}, a follow-up',
  'review.defenseAnswerLabel': 'Answer',
  'review.defenseNoAnswer': 'No answer was filed for this question.',
  'review.defenseNotesLabel': 'Expected-answer notes',
  'review.defenseNoNotes': 'The author wrote no notes for this question.',
  'review.defenseTook': 'Written in {duration}.',
  'review.defenseUnaided':
    'The defense is taken with the run record closed: the student answered from memory.',

  'review.conceptsTitle': 'Readiness Check',
  'review.conceptsDescription': 'The concept map the Readiness Check closed with.',
  'review.conceptsEmptyTitle': 'The check did not close',
  'review.conceptsEmptyBody':
    'This run has no concept map: the Readiness Check was skipped, or it never finished.',

  'review.declarationsTitle': 'Outside-tool declarations',
  'review.declarationsDescription':
    'What the student said they used, beside what this course asks for.',
  'review.declarationsNone': 'This run carries no outside-tool declaration.',
  'review.declarationNoPenalty': 'A declaration never changes how a run is banded.',
  'review.declarationAt': 'Declared {at}',
  'review.policyOpen': 'This course allows outside AI tools.',
  'review.policyDeclared': 'This course asks for outside AI use to be declared.',
  'review.policyInEnvironmentOnly': 'This course asks for the run to be taken inside Tassl alone.',

  'review.logTitle': 'Delegation log',
  'review.logDescription': 'Every request the student made of the assistant, and what came back.',
  'review.logEmptyTitle': 'The assistant was not used',
  'review.logEmptyBody':
    'This run holds no delegation. The Delegation band is drafted from what the defense says about working without one.',
  'review.logEntry': 'Delegation {seq}',
  'review.logRequest': 'The request',
  'review.logResponse': 'What came back',
  'review.logNoResponse': 'Nothing came back on this request.',
  'review.logWhy': 'Why the student asked: {why}',
  'review.logNoWhy': 'The student wrote no reason for this request.',
  'review.logInWindow': 'Made inside the Turn window',
  'review.logClaims': 'Claims raised: {keys}',

  'review.unverifiedTitle': 'Figures with nothing behind them',
  'review.unverifiedDescription':
    'Numbers the assistant asserted that no document in the Evidence Room supports.',
  'review.unverifiedNone': 'The assistant asserted no figure without a source.',
  'review.unverifiedRow': '{value} — {context}',

  'review.observationsTitle': 'Conditions recorded on this run',
  'review.observationsDescription':
    'Facts about the run. None of them is a finding about the student, and none is treated as misbehavior.',
  'review.observationsNone': 'This run recorded none of these conditions.',
  'review.observation.nothingAnswered': 'The defense was filed with every answer left empty.',
  'review.observation.allNovice':
    'All seven draft bands landed on Novice, the lowest band in the rubric.',
  'review.observation.allProfessional':
    'All seven draft bands landed on Professional, the highest band in the rubric.',
  'review.observation.speedOutlier': 'The decision was locked inside four minutes of working time.',
  'review.observation.readinessNotSubmitted':
    'The Readiness Check could not be submitted, so the skip was opened for the student.',
  'review.observation.outageArmed': 'An assistant outage is armed for this run’s next request.',

  // ---------------------------------------------------------------------------------------------
  // Bands: the seven decisions and the arithmetic they produce (FR-181, FR-182, FR-202)
  // ---------------------------------------------------------------------------------------------
  'review.bandsTitle': 'The seven bands',
  'review.bandsDescription':
    'Confirm the draft, put a different band on the record, or mark the dimension not assessed. The run is confirmed once all seven carry a decision.',
  'review.bandsProgress': '{decided} of {total} decided',
  'review.bandsEmptyTitle': 'No draft bands yet',
  'review.bandsEmptyBody':
    'The seven drafts are written after the defense is filed and the run has been read.',
  'review.bandsEmptyHeldBody':
    'Nothing could place this run’s bands, so there are no drafts to decide. The seven are yours to set by hand.',
  'review.bandsEmptyHeldAction': 'Band this run by hand',
  'review.confirmRemaining': 'Confirm the remaining drafts',
  'review.confirmRemainingDialogTitle': 'Confirm the remaining drafts?',
  'review.confirmRemainingDialogBody':
    'These are the dimensions nobody has decided. Each takes the band drafted for it, and the last of the seven confirms the run.',
  'review.confirmRemainingReexport': 'Confirming these writes course export version {version}.',
  'review.confirmRemainingSubmit': 'Put the remaining drafts on the record',
  'review.confirmRemainingCancel': 'Leave them undecided',
  'review.confirmRemainingPending': 'Confirming…',
  'review.confirmRemainingDone': 'The remaining drafts are on the record.',

  'review.bandDraftIs': 'Draft: {band}',
  'review.bandOnRecord': 'On the record: {band}',
  'review.bandDecidedBy': 'Decided by {who}, {when}.',
  'review.bandDecidedByUnknown': 'Decided {when}.',
  'review.bandDecisionConfirmed': 'Confirmed',
  'review.bandDecisionOverridden': 'Overridden',
  'review.bandDecisionUnassessed': 'Unassessed',
  'review.bandNoteLine': 'Note to the student: {note}',
  'review.bandRaisedByCorrection': 'A correction raised this band from {before} to {after}.',
  'review.bandReexportNote':
    'This run is already exported. A decision changed here writes a new export version.',
  // A hand-banded run carries `MANUAL_BAND_RATIONALE` (the literal 'manual') where a drafted one
  // carries a paragraph, and `no_evidence` where a drafted one carries a sentence. Neither is a
  // thing to print at a reviewer.
  'review.bandRationaleManual':
    'This band was set by hand: nothing in the run placed it, and a reviewer chose it.',
  'review.unassessedReason.graph_unavailable':
    'The graphs this dimension is read from could not be drawn from this run’s trace.',
  'review.unassessedReason.no_evidence': 'This run holds nothing that places this dimension.',
  'review.unassessedReason.stance_records_lost':
    'The record of what this run did with its claims was lost, so it cannot be read either way.',
  'review.unassessedReason.read_failed':
    'The reading of this run’s free text did not come back, and the recorded events alone do not place this dimension.',

  'review.bandsReadOnly':
    'This run is not open for decisions. The seven bands below are on the record as they stand.',
  'review.claimNotFound':
    'No claim of this package version carries the key {key}. The claims of the version are below.',
  'review.logClaimsLabel': 'Claims raised',

  'review.bandBasisTrace': 'Read from the trace, including the student’s own words.',
  'review.bandBasisDefenseOnly': 'Read from the defense answers alone.',
  'review.bandBasisCategoricalOnly':
    'Read from the counted facts of the run alone, without a reading of the student’s words.',
  'review.bandBasisNone': 'Nothing in this run placed this dimension.',
  'review.bandGraphsLine': 'The graphs behind it: {graphs}.',

  'review.decisionLegend': 'Band for {dimension}',
  'review.decisionOptionUnassessed': 'Unassessed',
  'review.decisionNoteLabel': 'Note for the student (optional)',
  'review.decisionNoteHint':
    'The student reads this beside the band. It is optional: an override needs no justification.',
  'review.decisionChoose': 'Record this decision',
  'review.decisionConfirmBand': 'Confirm the draft: {band}',
  'review.decisionRecordInstead': 'Record {band} instead',
  'review.decisionMarkUnassessed': 'Record this dimension as Unassessed',
  'review.decisionSaving': 'Saving…',
  'review.decisionConfirming': 'Confirming…',
  'review.decisionChooseBand': 'Choose a band, or mark the dimension not assessed.',
  'review.decisionSaved': 'The decision is on the record.',
  'review.decisionLockedByInstructor':
    'The instructor decided this dimension. A teaching-assistant seat cannot change it: the band it stands on is above, and the instructor for this section can.',

  'review.evidenceSummary': 'Show the evidence behind this band',
  'review.evidenceGraphs': 'Graphs it was read from',
  'review.evidenceEvents': 'Trace events it was read from',
  'review.evidenceEventSeq': 'Event {seq}',
  'review.evidenceQuotes': 'Quoted from the run’s own words',
  'review.evidenceNone': 'This band names no evidence beyond its rationale.',

  'review.pointsTitle': 'Points under this course’s mapping',
  'review.pointsDescription':
    'The arithmetic, written out, so the figure can be checked rather than taken on trust.',
  'review.pointsMappingLine': '{band} = {value}',
  'review.pointsMappingLabel': 'This course’s mapping',
  'review.pointsSentence': '({terms}) / {assessed} = {total}',
  'review.pointsTableCaption':
    'Each dimension, the band it stands on, and what the mapping makes of it.',
  'review.pointsColumnDimension': 'Dimension',
  'review.pointsColumnBand': 'Band',
  'review.pointsColumnTerm': 'Points',
  'review.pointsNotCounted': 'Not counted',
  'review.pointsTotalRow': 'Total over the assessed dimensions ({assessed})',
  'review.pointsFromDraft': 'From the seven draft bands',
  'review.pointsFromConfirmed': 'From the seven bands on the record',
  'review.pointsAfterCorrection': 'After the correction',
  'review.pointsPending':
    'The confirmed figure is written once all seven dimensions carry a decision. Until then this is what the drafts come to.',
  'review.pointsNone':
    'No dimension of this run is assessed, so the mapping has nothing to divide and there is no figure to enter.',
  'review.pointsUnassessedNote':
    'A dimension marked not assessed is left out of the division rather than counted as nothing.',
  'review.pointsGradebookNote':
    'Enter the bands, the mapping and the points in the gradebook of record. Tassl holds no grade.',

  // ---------------------------------------------------------------------------------------------
  // Trace (UI-033, FR-240)
  // ---------------------------------------------------------------------------------------------
  'review.traceTitle': 'The run’s trace',
  'review.traceDescription': 'Every event in the order it was written, with the clock as it stood.',
  'review.traceEmptyTitle': 'No events',
  'review.traceEmptyBody': 'This run has written nothing to its trace yet.',
  'review.traceColumnSeq': 'No.',
  'review.traceColumnClock': 'Clock left',
  'review.traceColumnType': 'Event',
  'review.traceColumnSummary': 'What it says',
  'review.traceColumnRecord': 'Record',
  'review.traceCaption': 'Every event of this run, in the order it was written.',
  'review.traceCaptionFiltered': 'One kind of event from this run: {type}.',
  'review.traceCount': 'Showing {shown} of {total}.',
  'review.traceFilterLabel': 'Show one kind of event',
  'review.traceFilterAll': 'Every kind',
  'review.traceFilterApply': 'Show',
  'review.traceFilterClear': 'Show every kind again',
  'review.traceNoClockFull': 'No clock was running when this event was written.',
  'review.traceOpenRecord': 'Show the record',
  'review.traceNoRecord': 'This event carries nothing beyond its type.',
  'review.traceEmptyFilterTitle': 'No events of that kind',
  'review.traceEmptyFilterBody': 'This run wrote no event of the kind you asked for.',

  'review.eventType.policy_displayed': 'Policy shown',
  'review.eventType.lifecycle': 'State change',
  'review.eventType.readiness_item': 'Readiness item',
  'review.eventType.readiness_skipped': 'Readiness skipped',
  'review.eventType.document_open': 'Document opened',
  'review.eventType.document_close': 'Document closed',
  'review.eventType.frame_locked': 'Frame locked',
  'review.eventType.delegation': 'Delegation',
  'review.eventType.claim_used': 'Claim marked used',
  'review.eventType.stance_set': 'Stance set',
  'review.eventType.action': 'Interrogation action',
  'review.eventType.escalation': 'Escalation',
  'review.eventType.outside_tool_declared': 'Outside tool declared',
  'review.eventType.pause': 'Run paused',
  'review.eventType.resume': 'Run resumed',
  'review.eventType.lock_refused': 'Lock refused',
  'review.eventType.decision_locked': 'Decision locked',
  'review.eventType.brief_opened': 'Brief opened',
  'review.eventType.brief_closed': 'Brief closed',
  'review.eventType.addendum': 'Addendum',
  'review.eventType.turn_delivered': 'Turn delivered',
  'review.eventType.turn_response_locked': 'Turn response locked',
  'review.eventType.defense_question': 'Defense question',
  'review.eventType.defense_answer': 'Defense answer',
  'review.eventType.draft_band': 'Band drafted',
  'review.eventType.band_decision': 'Band decided',
  'review.eventType.claim_neutralized': 'Claim neutralized',
  'review.eventType.run_voided': 'Run voided',
  'review.eventType.run_reoffered': 'Run offered again',
  'review.eventType.debrief_opened': 'Debrief opened',
  'review.eventType.debrief_answer': 'Debrief answered',
  'review.eventType.probe_fired': 'Probe fired',

  // ---------------------------------------------------------------------------------------------
  // Package (UI-033, FR-253)
  // ---------------------------------------------------------------------------------------------
  'review.packageTitle': 'The package this run was drawn from',
  'review.packageDescription':
    'Which version the student met, and who signed off on each part of it.',
  'review.packageIdLabel': 'Package',
  'review.packageVersionLabel': 'Version',
  'review.packageStatusLabel': 'Status',
  'review.packageVariantLabel': 'Variant on this run',
  'review.packageOpen': 'Open the package version',
  'review.packageStatusDraft': 'Draft',
  'review.packageStatusConfirmed': 'Confirmed',
  'review.packageStatusRetired': 'Retired',
  'review.packageRecordTitle': 'Confirmation record',
  'review.packageRecordDescription':
    'Every decision an author took on this version, and how much was rewritten before they took it.',
  'review.packageRecordEmptyTitle': 'No confirmation record',
  'review.packageRecordEmptyBody': 'Nothing has been confirmed on this version yet.',
  'review.packageMeasuresTitle': 'Authoring measures',
  'review.packageRestrictedTitle': 'Only the measures are open to this seat',
  'review.packageRestrictedBody':
    'Who confirmed each element of this version is not open to this seat. The authoring measures below are.',
  'review.claimsTitle': 'Claims',
  'review.claimsDescription':
    'Every consequential claim of this package, with what each variant makes of it. The variant this run drew is marked.',
  'review.claimsEmptyTitle': 'No claims',
  'review.claimsEmptyBody': 'This version carries no consequential claim.',
  'review.claimsColumnKey': 'Key',
  'review.claimsColumnText': 'Claim',
  'review.claimsColumnEvidence': 'Evidence on this variant',
  'review.claimsColumnStance': 'Warranted stance on this variant',
  'review.claimsColumnOpen': 'Open the claim',
  'review.claimsCaption': 'The claims of this package version.',
  'review.claimOpen': 'Open {key}',
  'review.claimTitle': 'Claim {key}',
  'review.claimConfirmationTitle': 'How this claim was confirmed',
  'review.claimConfirmationNone': 'This claim carries no confirmation record of its own.',
  'review.claimConfirmationNoteLabel': 'What the author wrote',
  'review.claimNeutralizedHere': 'This claim carries a correction on this run.',
  'review.claimCurrentVariant': 'This run’s variant',

  // ---------------------------------------------------------------------------------------------
  // Actions: void, corrections, test controls, hand-banding (FR-002, FR-003, FR-008, FR-118, FR-140)
  // ---------------------------------------------------------------------------------------------
  // The guard marks a delegation can carry (10 §8), as sentences. `assistant` stores them as
  // snake_case identifiers because they are analytics keys; a reviewer weighing the Delegation band
  // against them must never be handed one raw.
  'review.guardMark.rebuilt':
    'Tassl reassembled the reply so every claim of the scenario appeared.',
  'review.guardMark.no_commentary':
    'The reply carried the claims and no words of the assistant’s own.',
  'review.guardMark.probe': 'The Sycophancy Probe fired on this request.',
  'review.guardMark.discarded_late':
    'The reply came back after the run had left the state that asked for it, so it was not kept.',
  'review.guardMark.out_of_scenario': 'A reviewer marked this request as outside the scenario.',

  // ---------------------------------------------------------------------------------------------
  // FR-055's mark, on the log where a reviewer reads the exchange
  //
  // Every word here is about the *material*, never about the student. The mark says one thing —
  // this exchange was about something the scenario does not cover — and does one thing: the
  // Delegation read leaves it out (10 §11.3). Nothing about it reaches the student, in any state,
  // and it takes nothing away from them: the band is read over what is left, and the count of
  // marked exchanges is the sentence `band.delegation.flagged` writes into the reason.
  // ---------------------------------------------------------------------------------------------
  'review.flagButton': 'Mark as outside the scenario',
  'review.flagPending': 'Marking…',
  'review.flagExplains':
    'Marking says the exchange was about something this scenario does not cover, so the Delegation read is taken over the exchanges that remain. It is a note about the material. The student is not told, and nothing is taken away from them.',
  'review.flagAlready': 'This exchange is already marked, and a mark is recorded once.',
  'review.flagRefused': 'The mark was not recorded. Try again.',
  /** A mark the log does not yet have a sentence for; the identifier is the honest fallback. */
  'review.guardMarkUnknown': 'An unrecognized guard mark: {flag}',

  // The Actions view for a seat that may take none of them. It is not the tab's own name: a panel
  // titled "Actions" whose body says you have none reads as a defect rather than an explanation.
  'review.actionsSeatTitle': 'What this seat can do',

  // A standing state, not a confirmation of something just done (the toast says that).
  'review.testForceArmed':
    'One assistant outage is already armed: the student’s next request will not come back.',
  'review.actionsInstructorOnly':
    'Voiding a run, entering a correction and the test controls are the instructor’s. A teaching-assistant seat decides bands.',

  'review.voidTitle': 'Void this run',
  'review.voidDescription':
    'A voided run carries no partial result, and no export written afterwards names it. Offer another run in its place when the student should still take one.',
  'review.voidOpen': 'Void this run…',
  'review.voidDialogTitle': 'Void this run?',
  'review.voidDialogBody':
    'Nothing partial survives a void: no export written afterwards names the run, and the student is shown that it was voided.',
  'review.voidExportedWarning':
    'This run is already exported. Voiding it withdraws that figure — no export version will name the run afterwards, so take the run out of the gradebook of record as well.',
  'review.voidReasonLegend': 'Why is the run being voided?',
  'review.voidReason.unscoreable': 'The run cannot be banded at all',
  'review.voidReason.held': 'Nothing could place the bands, and they could not be set by hand',
  'review.voidReason.walkthrough': 'It was a walkthrough run',
  'review.voidReason.other': 'Something else',
  'review.voidNoteLabel': 'Note (optional)',
  'review.voidNoteHint':
    'What you write is kept on the run’s own record. Only the reason above is used in any count of voided runs.',
  'review.voidReoffer': 'Offer the student another run',
  'review.voidReofferHint':
    'The new run uses the other variant of this scenario unless you choose one.',
  'review.voidVariantLabel': 'Variant for the new run',
  'review.voidVariantAuto': 'The other variant',
  'review.voidVariantDefective': 'Defective',
  'review.voidVariantSound': 'Sound',
  'review.voidCancel': 'Keep the run',
  'review.voidConfirm': 'Void the run',
  'review.voidPending': 'Voiding…',
  'review.voidDone': 'The run is voided.',
  'review.voidDoneWithReoffer': 'The run is voided and another has been offered.',

  'review.neutralizeTitle': 'Corrections',
  'review.neutralizeDescription':
    'Enter a correction when Tassl got a claim wrong. The claim leaves the stance matrix and counts neither for the student nor against them; Verification and Calibration are then read again. A correction can raise a band and never lowers one.',
  'review.neutralizeOpen': 'Enter a correction on {key}…',
  'review.neutralizeDialogTitle': 'Enter a correction on claim {key}?',
  'review.neutralizeDialogBody':
    'The claim leaves the stance matrix and counts neither for the student nor against them, and Verification and Calibration are read again. A correction can raise a band and never lowers one.',
  'review.neutralizeReasonLegend': 'What went wrong?',
  'review.neutralizeReason.unintendedDefect': 'The claim carried a defect nobody placed',
  'review.neutralizeReason.wrongVerification': 'A check came back with the wrong result',
  'review.neutralizeReason.misbehavingMaterial': 'The material misbehaved',
  'review.neutralizeReason.adaptation': 'The adaptation did not hold',
  'review.neutralizeReason.recordLost': 'The record of what the student did was lost',
  'review.neutralizeReason.other': 'Something else',
  'review.neutralizeCredit': 'Credit the student’s challenge as correct',
  'review.neutralizeCreditHint':
    'Check this when the student challenged the claim and was right: it then counts as a match in Verification and Calibration, on this run alone. Left unchecked, the claim counts neither for the student nor against them.',
  'review.neutralizeNoteLabel': 'Note (optional)',
  'review.neutralizeConfirm': 'Enter the correction',
  'review.neutralizeCancel': 'Cancel',
  'review.neutralizePending': 'Recomputing…',
  'review.neutralizeClose': 'Close',
  'review.recomputeTitle': 'What the correction moved',
  'review.recomputeNothing':
    'No band moved. The correction is on the record and the run keeps the bands it had.',
  'review.recomputeRow': '{dimension}: {before} → {after}',
  'review.recomputePoints': 'Points: {before} → {after}.',
  'review.recomputeKeeps': 'The run keeps {effective} points.',
  'review.recomputeFloor': 'A correction can raise a band and never lowers one.',
  'review.recomputeExport': 'Export version {version} was written.',
  'review.recomputeNoExport': 'No export was written: this run has no confirmed bands yet.',
  'review.neutralizationsTitle': 'Corrections on this run',
  'review.neutralizationsNone': 'No correction has been entered on this run.',
  'review.neutralizationsEffect':
    'What a correction moved is recorded on the band it raised, and the export it produced is in the export list on the Bands view.',
  'review.neutralizationAt': 'Entered {at}',
  'review.neutralizationCredited': 'The student’s challenge was credited.',
  'review.neutralizationNote': 'Note: {note}',
  'review.neutralizeAlreadyDone': 'This claim already carries a correction.',
  'review.neutralizeNoClaims': 'This package version carries no claim to correct.',

  'review.testTitle': 'Test controls',
  'review.testDescription':
    'One control, and it changes what happens inside a student’s live run. It appears only where test controls are turned on for this environment.',
  'review.testForceTitle': 'Arm one assistant outage',
  'review.testForceWhatItDoes':
    'The student’s next request to the assistant will not come back. Their run pauses, the clock stops, nothing they have written is lost, and the time is given back when they resume. One outage only: the request after it answers as usual.',
  'review.testForceWhyItExists':
    'It exists for step 7 of the walkthrough, where the run has to meet an outage the student did not ask for and carry on without the assistant.',
  'review.testForceStudentSees':
    'The student is never told that a control did this. They are shown that the assistant did not answer, that their clock stopped, and that nothing is lost.',
  'review.testForceButton': 'Arm the outage',
  'review.testForcePending': 'Arming…',
  'review.testForceDone': 'One assistant outage is armed for this run.',
  'review.testForceNotArmable':
    'This run is not in a state that can take an outage. One can be armed while the student is working, answering the Turn, or paused.',

  'review.manualTitle': 'Band this run by hand',
  'review.manualDescription':
    'Nothing could place this run’s bands, so the seven are yours to set. All seven are recorded together: every dimension needs a band, or Unassessed where the run holds nothing to place it.',
  'review.manualSubmit': 'Put these seven on the record',
  'review.manualPending': 'Recording…',
  'review.manualDone': 'The seven bands are on the record.',
  'review.manualIncompleteNamed': 'These still need a band or the word not assessed: {dimensions}.',

  'review.exportsTitle': 'Course exports',
  'review.exportsDescription': 'Every version written for this run, newest first.',
  'review.exportsEmptyTitle': 'No export yet',
  'review.exportsEmptyBody':
    'The first export is written when all seven bands carry a decision. Every correction after that writes another.',
  'review.exportsColumnVersion': 'Version',
  'review.exportsColumnReason': 'Why it was written',
  'review.exportsColumnCreated': 'Written',
  'review.exportsColumnFile': 'File',
  'review.exportsCaption': 'Every course export written for this run.',
  'review.exportDownload': 'Download version {version}',
  'review.exportReason.initial': 'The bands were confirmed',
  'review.exportReason.override': 'A band was decided again',
  'review.exportReason.neutralization': 'A correction was entered',
  'review.exportReason.mapping': 'The course changed its mapping',
  'review.exportReason.unassessed': 'A dimension was marked not assessed',

  // ---------------------------------------------------------------------------------------------
  // The queue (UI-034, FR-186, FR-254, D-035, D-096)
  //
  // Two lists that are never mixed, and the reason the wording keeps saying so: the illustrative
  // half describes nobody and the real half is a list of this reviewer's own students' work. A
  // reader who cannot tell the two apart at a glance is a reader who might act on the wrong one.
  // ---------------------------------------------------------------------------------------------
  'review.queueTitle': 'Review',
  'review.queueDescription':
    'Runs of your own sections that are waiting for a decision, and the shapes a queue takes once a course has run for a term.',
  'review.queueSampleTitle': 'Review queue (illustrative)',
  'review.queueSampleNote':
    'These five groupings describe no student and count no real run. They show how a queue is organised once a term’s worth of runs exists; the list below is the real one.',
  'review.queueSampleCountLabel': 'Runs in this grouping',
  'review.queueRealTitle': 'Runs waiting for you',
  'review.queueRealDescription':
    'Every run of a section you review that has bands to decide, newest first.',
  'review.queueEmptyTitle': 'Nothing waiting',
  'review.queueEmptyBody':
    'A run appears here once its bands have been drafted. Until then there is nothing on it to decide.',
  'review.queueCaption': 'Runs of your sections with bands to decide.',
  'review.queueColumnStudent': 'Student',
  'review.queueColumnAttempt': 'Attempt',
  'review.queueColumnState': 'State',
  'review.queueColumnDecisions': 'Decisions made',
  'review.queueColumnExport': 'Export',
  'review.queueColumnOpen': 'Replay',
  'review.queueDecisions': '{made} of 7',
  'review.queueNoExport': 'None',
  'review.queueExportVersion': 'v{version}',
  'review.queueOpen': 'Open the replay for {student}',
  // The variant is deliberately not a column here, for UI-032's reason: it would put "defective" or
  // "sound" beside every student's name on a screen an instructor may well project, and a student
  // who reads "sound" can accept every claim without doing the work the run measures (12 §8, D-228).
  // The replay is where a reviewer reads it.
  'review.queueVariantNote':
    'Which variant a student drew is on the replay rather than in this list, so this screen can be shown to a room.',

  // ---------------------------------------------------------------------------------------------
  // The assignment's export history (UI-035, FR-204, FR-184)
  // ---------------------------------------------------------------------------------------------
  'review.assignmentExportsTitle': 'Course exports',
  'review.assignmentExportsDescription':
    'Every export written for a run on this assignment, newest first.',
  'review.assignmentExportsGradebook':
    'Enter bands, mapping, and points in the gradebook of record; Tassl holds no grade.',
  'review.assignmentExportsEmptyTitle': 'No export yet',
  'review.assignmentExportsEmptyBody':
    'The first export for a run is written when all seven of its bands carry a decision. Every correction after that writes another.',
  'review.assignmentExportsCaption': 'Every course export written on this assignment.',
  'review.assignmentExportsColumnRun': 'Run',
  'review.assignmentExportsColumnStudent': 'Student seat',
  'review.assignmentExportsRunLink': 'Open the replay',
  'review.assignmentExportsBack': 'Back to the assignment',
  /** The panel's own title: the page's h1 already says what the screen is. */
  'review.assignmentExportsPanelTitle': 'Every version written',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(review)
