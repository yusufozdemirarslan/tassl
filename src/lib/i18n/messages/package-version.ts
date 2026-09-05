// Package version view (UI-044): the version header, the confirmation record, the authoring
// record and the case behind it, the FR-198 measures, and the claims table.
import { scopedT } from '../scoped'

export const packageVersion = {
  'packageVersion.metaTitle': '{title}, version {version}',
  'packageVersion.backToPackages': 'All packages',
  'packageVersion.export': 'Export package JSON',
  'packageVersion.draftDescription':
    'Version {version} is a draft. Its elements can still be edited, and no assignment can run on it until every one of them is confirmed.',
  'packageVersion.confirmedDescription':
    'Version {version} was confirmed on {date} and is frozen. An assignment runs on exactly this text; changing anything means a new version.',
  'packageVersion.confirmedDescriptionNoDate':
    'Version {version} is confirmed and frozen. An assignment runs on exactly this text; changing anything means a new version.',
  'packageVersion.retiredDescription':
    'Version {version} is retired. Assignments already on it keep running; nothing new can be pointed at it.',
  'packageVersion.identityTitle': 'This version',
  'packageVersion.versionLabel': 'Version',
  'packageVersion.statusLabel': 'Status',
  'packageVersion.calibrationLabel': 'Calibration',
  // 09-frontend-spec-screens.md §UI-044 gives this sentence verbatim; it is the one line that says
  // what an uncalibrated difficulty figure is worth, so it is not paraphrased (FR-196).
  'packageVersion.uncalibratedNote':
    "uncalibrated: no field calibration; difficulty profile is the authority's estimate",
  'packageVersion.familyKeyLabel': 'Family key',
  'packageVersion.packageIdLabel': 'Package id',
  'packageVersion.versionIdLabel': 'Version id',
  'packageVersion.workingClockLabel': 'Working clock',
  'packageVersion.turnDelayLabel': 'Turn delay',
  'packageVersion.difficultyLabel': 'Difficulty estimate',
  // The concept set is what a course matches its taught concepts against, so it is the fact a
  // faculty member reads before pointing an assignment at this version (FR-180).
  'packageVersion.conceptsTitle': 'Concepts it exercises',
  'packageVersion.conceptsDescription':
    'A course matches the concepts it teaches against these. An assignment on this version exercises them, and the defects a run turns on stay inside the set.',
  'packageVersion.countsTitle': 'What it holds',
  'packageVersion.countDocuments': 'Documents',
  'packageVersion.countStakeholders': 'Stakeholders',
  'packageVersion.countPositions': 'Answer-space positions',
  'packageVersion.countNamedFields': 'Named fields',
  'packageVersion.countClaims': 'Claims',
  'packageVersion.countVariants': 'Variants',
  'packageVersion.countQuestions': 'Defense questions',
  'packageVersion.countReadinessItems': 'Readiness items',
  'packageVersion.rulesTitle': 'Package rules',
  'packageVersion.rulesPass':
    'Every package rule passes. Confirm each element to freeze the version.',
  // The failures are listed under this sentence with their rule codes, so it says what the state
  // is and stops; it no longer sends the author somewhere else to find out which rules broke.
  'packageVersion.rulesFailing':
    '{count} package rules still fail. The version stays a draft until each one passes.',
  'packageVersion.ruleElements': 'elements {keys}',
  'packageVersion.warningsTitle': 'Warnings',
  'packageVersion.openWorkspace': 'Open the confirmation workspace',
  'packageVersion.draftReadOnly':
    'Only an instructor or a scenario author edits and confirms the elements of a draft.',
  'packageVersion.durationSeconds': '{seconds} s',
  'packageVersion.durationMinutes': '{minutes} min',
  'packageVersion.durationMinutesSeconds': '{minutes} min {seconds} s',
  'packageVersion.durationHours': '{hours} h {minutes} min',
  'packageVersion.durationDays': '{days} d {hours} h',

  // Program lead (08 §4, D-211): admitted to the measures and nothing else, and told so.
  'packageVersion.restrictedTitle': 'Measures only',
  'packageVersion.restrictedBody':
    'Your seat reads how this version was built — how long confirmation took, how much was rewritten, who signed it — and not what it contains. The brief, the claims, the element-by-element record and the rule report stay with the people who author and teach the scenario.',

  'packageVersion.recordTitle': 'Confirmation record',
  'packageVersion.recordDescription':
    'Every decision an author took on an element of this version, newest first.',
  'packageVersion.recordCaption': 'Element decisions, newest first',
  'packageVersion.columnElement': 'Element',
  'packageVersion.columnDecision': 'Decision',
  'packageVersion.columnBy': 'By',
  'packageVersion.columnWhen': 'When',
  'packageVersion.columnRevision': 'Revision',
  // A confirmed version carries a decision per element — around a hundred rows, nearly all of them
  // the same authority confirming the same way in the same minute. The record is read as a summary
  // by element type, then the decisions that were not a plain first-revision confirmation, then
  // every row in full: FR-198 asks for the record, so nothing here is out of reach.
  'packageVersion.recordByTypeCaption': 'Decisions by element type',
  'packageVersion.columnElementType': 'Element type',
  'packageVersion.columnDecisions': 'Decisions',
  'packageVersion.columnLatest': 'Latest decision',
  'packageVersion.recordConfirmedCount': '{count} confirmed',
  'packageVersion.recordEditedCount': '{count} edited',
  'packageVersion.recordRejectedCount': '{count} rejected',
  'packageVersion.recordExceptionsTitle': 'Decisions that were not a plain confirmation',
  'packageVersion.recordExceptionsCaption':
    'Edits, rejections, later revisions, notes and second deciders',
  'packageVersion.recordExceptionsNone':
    'Every element was confirmed once, on its first revision, by the authority named above. Nothing was edited, rejected or revisited.',
  'packageVersion.recordAllSummary': 'All {count} decisions, newest first',
  'packageVersion.recordEmptyTitle': 'Nothing has been decided yet',
  'packageVersion.recordEmptyBody':
    'Every element starts undecided. As an author confirms, edits or rejects one, the decision is written here with the revision it was taken on.',
  'packageVersion.decision.confirmed': 'Confirmed',
  'packageVersion.decision.edited': 'Edited',
  'packageVersion.decision.rejected': 'Rejected',
  'packageVersion.element.brief': 'Brief',
  'packageVersion.element.document': 'Document',
  'packageVersion.element.stakeholder': 'Stakeholder',
  'packageVersion.element.answerSpacePosition': 'Answer-space position',
  'packageVersion.element.namedField': 'Named field',
  'packageVersion.element.claim': 'Claim',
  'packageVersion.element.variantClaimState': 'Variant claim state',
  'packageVersion.element.probe': 'Sycophancy probe',
  'packageVersion.element.turn': 'Turn',
  'packageVersion.element.defenseQuestion': 'Defense question',
  'packageVersion.element.readinessItem': 'Readiness item',
  'packageVersion.element.counterfactual': 'Counterfactual',
  'packageVersion.element.generalEscalationReply': 'General escalation reply',
  'packageVersion.element.clockAndDifficulty': 'Clock and difficulty',
  'packageVersion.element.seedReskin': 'Seed and re-skin',

  'packageVersion.authoringTitle': 'Authoring record',
  'packageVersion.authoringDescription':
    'How this version came to be, and the case it was adapted from.',
  'packageVersion.modelLabel': 'Generating model',
  'packageVersion.modelNone': 'None; written by hand or imported',
  'packageVersion.generatedAtLabel': 'Generated',
  'packageVersion.notGenerated': 'Never generated',
  'packageVersion.confirmedByLabel': 'Confirmed by',
  'packageVersion.confirmedAtLabel': 'Confirmed',
  'packageVersion.notConfirmed': 'Not yet',
  'packageVersion.seedTitle': 'The seed case',
  'packageVersion.seedWithheld':
    'The case this package was adapted from, its publisher and the license terms behind it are read by the instructor and the scenario author only.',
  'packageVersion.caseTitleLabel': 'Case title',
  'packageVersion.publisherLabel': 'Publisher',
  'packageVersion.licenseTermsLabel': 'License terms relied on',
  'packageVersion.licenseConfirmed':
    'The author confirmed that these terms permit adaptation before the package was built.',
  'packageVersion.licenseNotConfirmed':
    'This seed record carries no confirmation that the terms permit adaptation.',
  'packageVersion.reskinTitle': 'Re-skin log',
  'packageVersion.reskinCaption': 'What was changed from the licensed case',
  'packageVersion.reskinColumnKind': 'Change',
  'packageVersion.reskinColumnFrom': 'From',
  'packageVersion.reskinColumnTo': 'To',
  'packageVersion.reskinColumnNote': 'Note',
  'packageVersion.reskinNoNote': 'No note',
  'packageVersion.reskinEmpty':
    'This seed record names nothing that was changed from the case. A version cannot be confirmed until it does.',
  'packageVersion.reskin.renamedEntity': 'Renamed entity',
  'packageVersion.reskin.alteredNumber': 'Altered number',
  'packageVersion.reskin.restructuredDocument': 'Restructured document',

  'packageVersion.measuresTitle': 'Authoring measures',
  'packageVersion.measuresDescription':
    'What building this version cost, read off the seed record and the element decisions.',
  'packageVersion.seedToConfirmed': 'Seed to confirmed',
  'packageVersion.seedToConfirmedHelp':
    'From the moment the seed case was recorded to the moment the version was frozen.',
  'packageVersion.editRate': 'Edit rate',
  'packageVersion.editRateHelp':
    'The share of elements whose latest decision was an edit rather than a plain confirmation.',
  'packageVersion.rejectedShare': 'Rejected share',
  'packageVersion.rejectedShareHelp': 'The share of elements an author rejected at least once.',
  'packageVersion.generationPasses': 'Generation passes',
  'packageVersion.generationPassesHelp':
    'How many times a generation step ran for this version. Tassl cannot draft elements for you yet, so a hand-written or imported version reads zero.',
  'packageVersion.reviewPerElement': 'Review time per element',
  'packageVersion.reviewPerElementHelp':
    'The average time between opening an element and deciding on it.',
  'packageVersion.measureNotConfirmed': 'Not confirmed yet',
  'packageVersion.measureNoDecisions': 'No decisions yet',

  'packageVersion.claimsTitle': 'Claims',
  'packageVersion.claimsDescription':
    'Every claim the assistant can state in this scenario, and what each variant makes of it. Open a claim to see its source, what it deserved, and how a student could have checked it.',
  'packageVersion.claimsCaption': 'Claims and their per-variant states',
  'packageVersion.columnClaim': 'Claim',
  'packageVersion.columnImportance': 'Importance',
  'packageVersion.columnConsequence': 'Consequence',
  'packageVersion.columnCost': 'Verification cost',
  'packageVersion.columnVariant': '{variant} variant',
  'packageVersion.openClaim': 'Open claim',
  'packageVersion.claimsScrollHint':
    'The claim stays in place while the variant columns scroll sideways.',
  'packageVersion.claimNoState': 'This variant says nothing about this claim',
  'packageVersion.claimsEmptyTitle': 'No claims yet',
  'packageVersion.claimsEmptyBody':
    'A claim is something the assistant states and a student takes a stance on. Write them in the confirmation workspace, or bring in a package export that already has them.',
  'packageVersion.claimsWithheldTitle': 'The claims are not open to your seat',
  'packageVersion.claimsWithheldBody':
    'Reading a claim means reading the defect placement and the stance each one deserved. An instructor, a scenario author or a teaching assistant of this institution can open them.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(packageVersion)
