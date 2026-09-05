// UI-043, the element confirmation workspace (FR-192, FR-027, FR-198).
//
// One namespace because one Client Component reads all of it: the workspace is the only screen in
// the product where an author signs sixty-odd elements one at a time, and every label, every enum
// word and every refusal below belongs to that room alone (16 §3.4).
//
// Two rules govern the wording here.
//
// The field labels name the thing, not the column. `superseded_by_document_id` is "Superseded by",
// `is_minimum_commitment` is "The minimum defensible commitment" — an author is reading a scenario,
// not a schema, and the mono key is already on screen beside the label wherever the key matters.
//
// No rule is restated. `validatePackage` writes its own sentences and `wordLimit` counts its own
// words; this file names the field and the limit and stops. The one exception is `WORD_LIMIT`,
// which crosses the wire as a code rather than a sentence (see `src/lib/words.ts`), so the sentence
// a reader sees for it is written here.
import { scopedT } from '../scoped'

export const packageConfirm = {
  // ---------------------------------------------------------------------------------------
  // The screen
  // ---------------------------------------------------------------------------------------
  'confirm.metaTitle': 'Confirm {title}, version {version}',
  'confirm.backToVersion': 'Back to version {version}',
  'confirm.draftDescription':
    'Read each element, edit what needs it, and record a decision. When every element has a decision, the teaching-note check is ticked and the package rules pass, version {version} can be confirmed — and is then frozen for good.',
  'confirm.frozenDescription':
    'Version {version} was confirmed on {date}. This is the record of what was signed, element by element; nothing here can be changed.',
  'confirm.frozenDescriptionNoDate':
    'Version {version} is confirmed. This is the record of what was signed, element by element; nothing here can be changed.',
  'confirm.readOnlyTitle': 'This version is not yours to edit',
  'confirm.readOnlyBody':
    'Only an instructor or a scenario author of this institution edits and confirms a package. You can read every element below.',
  'confirm.emptyTitle': 'This version has no elements yet',
  'confirm.emptyBody':
    'A version created from a seed carries only the case behind it. Import a package document on the packages screen, or wait for generation, and the elements to confirm appear here.',

  // ---------------------------------------------------------------------------------------
  // Progress and the version decision
  // ---------------------------------------------------------------------------------------
  'confirm.progressTitle': 'Confirming version {version}',
  'confirm.progressLabel': 'Elements decided',
  'confirm.progressCount': '{decided} of {total} confirmed',
  'confirm.progressRemaining': '{count} left to decide',
  'confirm.progressRemainingOne': '1 left to decide',
  'confirm.progressComplete': 'Every element has a decision.',
  'confirm.progressRejected': '{count} rejected',
  'confirm.nextUndecided': 'Next undecided element',
  'confirm.teachingNoteLabel': 'Teaching note checked against the answer space and claims',
  'confirm.teachingNoteHint':
    'Confirming records that you have read the teaching note and that it matches the positions in the answer space and the claims below. The tick is kept with the confirmation.',
  'confirm.confirmVersion': 'Confirm version',
  'confirm.confirmVersionPending': 'Confirming…',
  'confirm.confirmedToast': 'Version {version} is confirmed and frozen.',
  'confirm.confirmDialogTitle': 'Confirm version {version}?',
  'confirm.confirmDialogBody':
    'Confirming freezes version {version} for good. No element in it can be edited afterwards, and a change means a new version.',
  'confirm.confirmDialogElements': 'Elements',
  'confirm.confirmDialogElementsValue': '{decided} of {total} decided',
  'confirm.confirmDialogRejected': 'Rejected',
  'confirm.confirmDialogRejectedValue': '{count} of them',
  'confirm.confirmDialogRules': 'Package rules',
  'confirm.confirmDialogRulesFailing': '{count} not met yet',
  'confirm.confirmDialogRulesPass': 'All met',
  'confirm.confirmDialogTeachingNote': 'Teaching note',
  'confirm.confirmDialogTeachingNoteChecked':
    'Checked against the answer space and the claims, and kept with the confirmation',
  'confirm.confirmDialogTeachingNoteUnchecked': 'Not checked yet',
  'confirm.confirmDialogSubmit': 'Confirm and freeze',
  'confirm.confirmDialogCancel': 'Not yet',
  'confirm.unconfirmedTitle': 'Waiting on a decision',
  'confirm.rulesTitle': 'Rules this package does not meet yet',
  'confirm.ruleElements': 'elements {keys}',

  // ---------------------------------------------------------------------------------------
  // The element list
  // ---------------------------------------------------------------------------------------
  'confirm.listTitle': 'Elements',
  'confirm.treeLabel': 'Elements of this version',
  'confirm.selectLabel': 'Element to review',
  'confirm.groupProgress': '{decided} of {total}',
  'confirm.onlyUndecided': 'Show only what is undecided',
  'confirm.onlyUndecidedEmpty': 'Nothing is left undecided.',
  'confirm.unsavedMark': 'Unsaved edits',
  'confirm.statusUndecided': 'Undecided',
  'confirm.statusConfirmed': 'Confirmed',
  'confirm.statusEdited': 'Edited',
  'confirm.statusRejected': 'Rejected',

  // ---------------------------------------------------------------------------------------
  // The editor
  // ---------------------------------------------------------------------------------------
  'confirm.editorNoneTitle': 'No element open',
  'confirm.editorNoneBody': 'Choose an element on the left to read it and record a decision.',
  'confirm.editorHeading': '{type} · {key}',
  'confirm.decidedBy': 'Decided by {name} on {date}',
  'confirm.decidedByUnknown': 'Decided on {date}',
  'confirm.revision': 'revision {revision}',
  'confirm.lockedBody':
    'This element carries a decision that stands. Reopen it to change a field; saving the change records a new decision on top of this one.',
  'confirm.reopen': 'Reopen for editing',
  'confirm.rejectedTitle': 'Rejected, and waiting to be re-authored',
  'confirm.rejectedBody':
    'A rejected element is queued for regeneration and keeps the version from being confirmed. Generation is not built yet, so this one has to be authored by hand: edit the fields below and save, which records the edit as its decision.',
  'confirm.rejectedNote': 'Note on the rejection: {note}',
  'confirm.frozenTitle': 'Frozen',
  'confirm.frozenBody':
    'This element is part of a confirmed version. It is shown as it was signed and cannot be edited.',
  'confirm.elementRulesTitle': 'Rules this element does not meet',
  'confirm.contextTitle': 'What this element belongs to',

  // ---------------------------------------------------------------------------------------
  // The confirm bar
  // ---------------------------------------------------------------------------------------
  'confirm.toolbarLabel': 'Decision on this element',
  'confirm.save': 'Save edits',
  'confirm.savePending': 'Saving…',
  'confirm.saveNothing': 'Nothing has changed in this element yet.',
  // Three sentences because a save has three outcomes, and the toast is the only place they are
  // told apart. `updateElement` writes an `edited` confirmation only for the institution's own
  // confirming authority (10 §4); anyone else's edit is stored and decides nothing, and so is an
  // edit the schema normalised away to no change at all.
  'confirm.savedToast': '{name} saved. The edit is recorded as its decision.',
  'confirm.savedUndecidedToast': '{name} saved. It still needs a decision.',
  'confirm.savedDecisionStandsToast': '{name} saved. The decision already on it is unchanged.',
  'confirm.confirmElement': 'Confirm',
  'confirm.confirmPending': 'Confirming…',
  'confirm.confirmedElementToast': '{name} confirmed.',
  'confirm.reject': 'Reject',
  'confirm.rejectDialogTitle': 'Reject {name}',
  'confirm.rejectDialogBody':
    'Say what is wrong with it. The note is kept with the decision, and the element stays in the version until it is re-authored.',
  'confirm.rejectNoteLabel': 'Why this element is rejected',
  'confirm.rejectNoteRequired': 'Say what is wrong with it before rejecting.',
  'confirm.rejectSubmit': 'Reject element',
  'confirm.rejectPending': 'Rejecting…',
  'confirm.rejectedToast': '{name} rejected.',
  'confirm.cancel': 'Cancel',
  'confirm.unsavedBeforeDecide':
    'Save or discard the edits in this element before recording a decision on it.',
  'confirm.discard': 'Discard edits',
  'confirm.discardedToast': 'Edits to {name} discarded.',

  // ---------------------------------------------------------------------------------------
  // Field chrome
  // ---------------------------------------------------------------------------------------
  'confirm.fieldRequired': 'This field needs a value.',
  'confirm.wordLimit': 'At most {limit} words; there are {count}.',
  'confirm.wordCount': '{count} of {limit} words',
  'confirm.optionNone': 'None',
  'confirm.addRow': 'Add {name}',
  'confirm.removeRow': 'Remove {name}',
  'confirm.rowLabel': '{name} {index}',
  'confirm.emptyRows': 'None yet.',
  'confirm.jsonInvalid': 'This has to be a JSON object, for example {"stance":"accept"}.',

  // ---------------------------------------------------------------------------------------
  // Element type names — singular (the editor heading) and plural (the list group)
  // ---------------------------------------------------------------------------------------
  'confirm.type.brief': 'Brief',
  'confirm.type.document': 'Document',
  'confirm.type.stakeholder': 'Stakeholder',
  'confirm.type.answer_space_position': 'Answer space position',
  'confirm.type.named_field': 'Named field',
  'confirm.type.claim': 'Claim',
  'confirm.type.variant_claim_state': 'Variant state',
  'confirm.type.probe': 'Sycophancy probe',
  'confirm.type.turn': 'The Turn',
  'confirm.type.defense_question': 'Question',
  'confirm.type.readiness_item': 'Readiness item',
  'confirm.type.counterfactual': 'Debrief counterfactual',
  'confirm.type.general_escalation_reply': 'General escalation reply',
  'confirm.type.clock_and_difficulty': 'Clock and difficulty',
  'confirm.type.seed_reskin': 'Seed re-skin log',

  'confirm.group.brief': 'Brief',
  'confirm.group.document': 'Documents',
  'confirm.group.stakeholder': 'Stakeholders',
  'confirm.group.answer_space_position': 'Answer space',
  'confirm.group.named_field': 'Named fields',
  'confirm.group.claim': 'Claims',
  'confirm.group.variant_claim_state': 'Variant states',
  'confirm.group.probe': 'Sycophancy probe',
  'confirm.group.turn': 'The Turn',
  'confirm.group.defense_question': 'Question bank',
  'confirm.group.readiness_item': 'Readiness items',
  'confirm.group.counterfactual': 'Counterfactual',
  'confirm.group.general_escalation_reply': 'General escalation reply',
  'confirm.group.clock_and_difficulty': 'Clock and difficulty',
  'confirm.group.seed_reskin': 'Seed re-skin log',

  'confirm.claimBase': 'Claim fields',
  'confirm.claimVariant': '{variant} variant',
  'confirm.variantDefective': 'Defective',
  'confirm.variantSound': 'Sound',
  'confirm.variantsTitle': 'What each variant makes of this claim',
  'confirm.variantsBody':
    'The two readings are elements of their own and are confirmed separately. Open one to change what it says.',
  'confirm.openVariant': 'Open the {variant} variant',

  // ---------------------------------------------------------------------------------------
  // Fields — brief, documents, stakeholders, answer space, named fields
  // ---------------------------------------------------------------------------------------
  'confirm.field.brief': 'The brief a student reads',
  'confirm.field.briefHint':
    'The decision, its stakes and what is being asked for, in the world’s own voice.',

  'confirm.field.position': 'Order',
  'confirm.field.positionHint': 'Where this sits among the others of its kind; lowest first.',
  'confirm.field.title': 'Title',
  'confirm.field.author': 'Author',
  'confirm.field.datedOn': 'Dated',
  'confirm.field.role': 'Role in the Evidence Room',
  'confirm.field.body': 'Body',
  'confirm.field.supersededBy': 'Superseded by',
  'confirm.field.supersededByHint':
    'The later document that replaces this one. Required when the role is Superseded.',
  'confirm.field.documentStakeholder': 'Belongs to',
  'confirm.field.documentStakeholderHint': 'The stakeholder this document came from, if any.',

  'confirm.field.name': 'Name',
  'confirm.field.roleTitle': 'Role',
  'confirm.field.positionStatement': 'Position',
  'confirm.field.incentives': 'Incentives',
  'confirm.field.blindSpots': 'Blind spots',
  'confirm.field.contradictionPoint': 'Contradiction',
  'confirm.field.contradictionPointHint':
    'What this stakeholder says that the one below cannot also be true of.',
  'confirm.field.contradictsStakeholder': 'Contradicts',

  'confirm.field.positionKind': 'Kind',
  'confirm.field.summary': 'Summary',
  'confirm.field.ignoredEvidence': 'Evidence it ignores',
  'confirm.field.ignoredEvidenceHint':
    'Required for an evidence-inconsistent position: what a student taking it has to walk past.',
  'confirm.field.isMinimumCommitment': 'The minimum defensible commitment',
  'confirm.field.supportingDocuments': 'Documents that support it',

  'confirm.field.label': 'Label',
  'confirm.field.unit': 'Unit',

  // ---------------------------------------------------------------------------------------
  // Fields — claims and variant states
  // ---------------------------------------------------------------------------------------
  'confirm.field.text': 'Claim',
  'confirm.field.sourceKind': 'Stated by',
  'confirm.field.sourceDocument': 'Source document',
  'confirm.field.sourcePassage': 'Source passage',
  'confirm.field.importance': 'Importance',
  'confirm.field.consequenceLevel': 'Consequence',
  'confirm.field.verificationCost': 'Cost to verify',
  'confirm.field.weaklySourced': 'Weakly sourced',
  'confirm.field.volatile': 'Volatile',
  'confirm.field.conceptKey': 'Concept',
  'confirm.field.conceptKeyHint':
    'One of the concepts this package declares: {concepts}. A claim outside the set fails CLAIM_CONCEPT_UNKNOWN.',
  'confirm.field.carriedValues': 'Figures it carries',
  'confirm.field.carriedValue': 'figure',
  'confirm.field.carriedFieldKey': 'Named field',
  'confirm.field.carriedValueNumber': 'Value',
  'confirm.field.triggerPhrases': 'Trigger phrases',
  'confirm.field.triggerPhrase': 'phrase',
  'confirm.field.triggerPhrasesHint':
    'What a student can say that brings the assistant to this claim.',
  'confirm.field.triggerDescription': 'When it comes up',
  'confirm.field.escalatable': 'Can be escalated',
  'confirm.field.escalationReply': 'Escalation reply',
  'confirm.field.escalationReplyHint':
    'What the world answers when a student escalates this claim. Required once it can be escalated.',
  'confirm.field.rationale': 'What it deserved, and why',
  'confirm.field.rationaleHint': 'Read in the debrief; never before the run is scored.',

  'confirm.field.evidenceStatus': 'Evidence',
  'confirm.field.failureFamily': 'Failure family',
  'confirm.field.failureFamilyHint': 'Required when the evidence is defective.',
  'confirm.field.warrantedStance': 'Warranted stance',
  'confirm.field.planted': 'The planted defect of this variant',
  'confirm.field.plantedHint':
    'Exactly one defective claim state in the defective variant carries this, and none in the sound one.',
  'confirm.field.verificationPaths': 'Verification paths',
  'confirm.field.verificationPathsHint':
    'What an interrogation returns for this claim in this variant. Leave a path empty to say it is not available.',
  'confirm.field.sourceTrace': 'Source Trace',
  'confirm.field.traceDocument': 'Document it leads to',
  'confirm.field.tracePassage': 'Passage',
  'confirm.field.traceDatedOn': 'Dated',
  'confirm.field.traceAuthor': 'Author',
  'confirm.field.replicationCheck': 'Replication Check',
  'confirm.field.replicationResult': 'Result',
  'confirm.field.decompositionCheck': 'Decomposition Check',
  'confirm.field.decompositionStep': 'step',
  'confirm.field.stepLabel': 'Step',
  'confirm.field.stepResult': 'Result',
  'confirm.field.pathOn': 'Available',

  // ---------------------------------------------------------------------------------------
  // Fields — probe, Turn, question bank, readiness items
  // ---------------------------------------------------------------------------------------
  'confirm.field.probeClaim': 'Claim it probes',
  'confirm.field.originalPosition': 'What the assistant said first',
  'confirm.field.scriptedReversal': 'What it says when pushed',

  'confirm.field.turnText': 'The message',
  'confirm.field.voice': 'Voice',
  'confirm.field.turnStakeholder': 'From',
  'confirm.field.warrantsChange': 'It warrants a change of decision',
  'confirm.field.proportionateResponse': 'Proportionate response',
  'confirm.field.evidence': 'Evidence behind it',
  'confirm.field.disruptedAssumptionKeys': 'Assumptions it disrupts',
  'confirm.field.disruptedAssumption': 'assumption',
  'confirm.field.windowClaims': 'Claims inside the window',

  'confirm.field.questionKind': 'Kind',
  'confirm.field.questionClaim': 'About the claim',
  'confirm.field.assumptionIndex': 'Frame assumption',
  'confirm.field.assumptionIndexHint': 'Which of the three frame assumptions, 0 to 2.',
  'confirm.field.template': 'Question',
  'confirm.field.templateHint':
    'Placeholders: {claim_text}, {figure}, {stance}, {document_title}, {assumption}.',
  'confirm.field.condition': 'Condition',
  'confirm.field.conditionHint':
    'A JSON object narrowing when this question is asked. Leave it as {} to always allow it.',
  'confirm.field.followUp': 'Follow-up',
  'confirm.field.expectedAnswerNotes': 'Expected answer',
  'confirm.field.expectedAnswerNotesHint': 'For the reviewer only; a student never reads it.',
  'confirm.field.isDefault': 'A default question',

  'confirm.field.category': 'Category',
  'confirm.field.stem': 'Stem',
  'confirm.field.options': 'Options',
  'confirm.field.option': 'option',
  'confirm.field.optionKey': 'Key',
  'confirm.field.optionText': 'Text',
  'confirm.field.answerKey': 'Correct option',

  // ---------------------------------------------------------------------------------------
  // Fields — the version singletons
  // ---------------------------------------------------------------------------------------
  'confirm.field.counterfactual': 'The counterfactual',
  'confirm.field.counterfactualHint':
    'Exactly three sentences, read in the debrief: what would have happened had one thing been different.',
  'confirm.field.generalEscalationReply': 'The reply',
  'confirm.field.generalEscalationReplyHint':
    'What the assistant answers when a student escalates a claim with no reply of its own.',
  'confirm.field.workingClockSeconds': 'Working clock',
  'confirm.field.workingClockSecondsHint': 'Seconds, between 300 and 7200. {readable}',
  'confirm.field.turnDelaySeconds': 'Turn delay',
  'confirm.field.turnDelaySecondsHint':
    'Seconds after the decision is locked before the Turn arrives, between 60 and 120.',
  'confirm.field.difficultyProfile': 'Difficulty profile',
  'confirm.field.difficultyEstimate': 'Difficulty estimate',
  'confirm.field.difficultyNote': 'Note on the estimate',
  'confirm.field.difficultyUncalibrated': 'Uncalibrated',
  'confirm.field.difficultyUncalibratedHint':
    'No cohort has run this version, so the estimate is the authority’s own.',

  'confirm.field.caseTitle': 'Case title',
  'confirm.field.publisher': 'Publisher',
  'confirm.field.licenseTerms': 'Licence terms relied on',
  'confirm.field.licensePermitsAdaptation': 'The licence permits adaptation',
  'confirm.field.seedText': 'Seed text',
  'confirm.field.reskinLog': 'Re-skin log',
  'confirm.field.reskinEntry': 'entry',
  'confirm.field.reskinKind': 'What changed',
  'confirm.field.reskinFrom': 'From',
  'confirm.field.reskinTo': 'To',
  'confirm.field.reskinNote': 'Note',

  // ---------------------------------------------------------------------------------------
  // Enumerated values
  // ---------------------------------------------------------------------------------------
  'confirm.documentRole.supporting': 'Supporting',
  'confirm.documentRole.superseded': 'Superseded',
  'confirm.documentRole.interpretation_as_fact': 'Interpretation as fact',
  'confirm.documentRole.irrelevant': 'Accurate and irrelevant',

  'confirm.positionKind.defensible': 'Defensible',
  'confirm.positionKind.evidence_inconsistent': 'Inconsistent with the evidence',

  'confirm.unit.percent': 'Percent',
  'confirm.unit.ratio': 'Ratio',
  'confirm.unit.months': 'Months',
  'confirm.unit.usd': 'US dollars',
  'confirm.unit.count': 'Count',
  'confirm.unit.other': 'Other',

  'confirm.claimSource.assistant': 'The assistant',
  'confirm.claimSource.document': 'A document',

  'confirm.importance.load_bearing': 'Load-bearing',
  'confirm.importance.supporting': 'Supporting',

  'confirm.consequence.low': 'Low',
  'confirm.consequence.medium': 'Medium',
  'confirm.consequence.high': 'High',

  'confirm.cost.cheap': 'Cheap',
  'confirm.cost.moderate': 'Moderate',
  'confirm.cost.expensive': 'Expensive',

  'confirm.evidence.sound': 'Sound',
  'confirm.evidence.defective': 'Defective',

  'confirm.family.near_neighbor': 'Near neighbour',
  'confirm.family.unstated_assumption': 'Unstated assumption',
  'confirm.family.stale_evidence': 'Stale evidence',
  'confirm.family.uncomputed_number': 'Uncomputed number',
  'confirm.family.extrapolation': 'Extrapolation',
  'confirm.family.reversal_to_agree': 'Reversal to agree',
  'confirm.family.omitted_alternative': 'Omitted alternative',
  'confirm.family.misapplied_method': 'Misapplied method',
  'confirm.family.misattributed_source': 'Misattributed source',
  'confirm.family.unacceptable_route': 'Unacceptable route',

  'confirm.voice.stakeholder_message': 'Stakeholder message',
  'confirm.voice.corrected_number': 'Corrected number',
  'confirm.voice.supplier_notice': 'Supplier notice',
  'confirm.voice.competitor_move': 'Competitor move',
  'confirm.voice.retracted_source': 'Retracted source',
  'confirm.voice.regulatory_note': 'Regulatory note',

  'confirm.turnResponse.hold': 'Hold',
  'confirm.turnResponse.revise': 'Revise',
  'confirm.turnResponse.reverse': 'Reverse',

  'confirm.questionKind.provenance': 'Provenance',
  'confirm.questionKind.figure_provenance': 'Figure provenance',
  'confirm.questionKind.verification': 'Verification',
  'confirm.questionKind.assumption': 'Assumption',
  'confirm.questionKind.confidence': 'Confidence',
  'confirm.questionKind.frame_vs_response': 'Frame against response',
  'confirm.questionKind.counterfactual': 'Counterfactual',
  'confirm.questionKind.default': 'Default',

  'confirm.category.foundation': 'Foundation',
  'confirm.category.defect_concept': 'Defect concept',
  'confirm.category.ai_behavior': 'AI behaviour',

  'confirm.reskinKind.renamed_entity': 'Renamed entity',
  'confirm.reskinKind.altered_number': 'Altered number',
  'confirm.reskinKind.restructured_document': 'Restructured document',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(packageConfirm)
