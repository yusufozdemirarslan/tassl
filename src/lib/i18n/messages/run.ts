// A student's run: the lifecycle, the clock, the policy display and the screens that read them
// (UI-020 to UI-027, FR-201, FR-231, FR-233, FR-235). Phase 6 opens the namespace with the
// sentences the runs service answers with; the screens of step 6.5 add their own.
//
// Nothing in this file names a warranted stance, an evidence status, a failure family, a planted
// flag, a verification result or a variant, and nothing names a score, a rank or a percentile. The
// student reads every string here, and several of them are read while a clock they cannot pause is
// running, so each one says what to do next in the fewest words that stay true.
import { scopedT } from '../scoped'

export const run = {
  // Server-side refusals (10-backend-spec-modules.md §6). A run the actor neither owns nor reviews
  // is answered "no longer exists" rather than "not yours": 08 §4 gives a classmate no read of
  // another student's run at all, so the sentence must not confirm that the id resolves.
  'run.notFound': 'That run no longer exists.',
  'run.assignmentNotFound': 'That assignment no longer exists.',
  'run.notSectionStudent': 'Only a student on this assignment’s section can start a run.',
  'run.notOpenYet': 'This assignment has not opened yet.',

  // The Readiness Check (FR-010 to FR-018). None of these sentences says anything about whether an
  // answer was right: correctness is computed server-side and never returned (FR-012).
  'run.readinessNotOpen': 'The Readiness Check is not open on this run.',
  'run.readinessClosed': 'The Readiness Check has closed.',
  'run.readinessItemNotFound': 'That item is not on this check.',
  'run.readinessOptionNotOffered': 'Choose one of the options offered.',
  'run.readinessSetUnavailable': 'This run’s scenario has no confirmed Readiness Check.',

  // The Evidence Room and the frame (FR-020 to FR-024, FR-040 to FR-044). None of these sentences
  // says anything about a document beyond whether it can be opened: the room has no hints, no
  // recommended order and no summary (FR-023), and a refusal is a place where a system is tempted
  // to give one.
  'run.workspaceNotOpen': 'This run is not in the workspace.',
  'run.roomNotOpen': 'The Evidence Room is not open on this run yet.',
  'run.documentNotInRoom': 'That document is not in this run’s Evidence Room.',
  'run.documentOpenNotFound': 'That reading was not recorded on this run.',
  'run.frameInvalid': 'The frame is not ready to lock.',

  // ---------------------------------------------------------------------------------------------
  // The run's state, in the student's words (06 §3.4). One label per state of the machine, so a
  // state added to the enum is a missing key rather than a blank chip. They name the step the
  // student is on, not the row the database holds: `decision_locked` is "Decision locked" because
  // that is the thing that happened to them, and `defense_pending` is "Defense" because that is
  // where they are.
  // ---------------------------------------------------------------------------------------------
  'run.stateAssigned': 'Not started',
  'run.stateReadiness': 'Readiness Check',
  'run.stateFraming': 'Framing',
  'run.stateWorking': 'Working',
  'run.statePaused': 'Paused',
  'run.stateDecisionLocked': 'Decision locked',
  'run.stateTurnOpen': 'Turn open',
  'run.stateTurnLocked': 'Turn locked',
  'run.stateDefensePending': 'Defense',
  'run.stateDefenseComplete': 'Defense complete',
  'run.stateScored': 'Scored',
  'run.stateConfirmed': 'Confirmed',
  'run.stateRecorded': 'Recorded',
  'run.stateVoided': 'Voided',
  'run.stateAbandoned': 'Abandoned',
  'run.stateDefenseMissed': 'Defense missed',
  'run.stateUnderAppeal': 'Under appeal',
  'run.stateExpired': 'Expired',
  /** `scoring_status = 'held'`: the one thing about scoring a student is told (FR-140, 10 §6). */
  'run.stateUnderReview': 'Under review',

  // ---------------------------------------------------------------------------------------------
  // UI-020 the runs list (/runs, FR-235)
  // ---------------------------------------------------------------------------------------------
  'run.listTitle': 'Runs',
  'run.listDescription':
    'Every assignment in your sections, and where your run on it has got to. A run keeps its place: leave it and come back to the same step.',
  'run.listCaption': 'Your assignments and the runs you have taken on them',
  'run.columnAssignment': 'Assignment',
  'run.columnAttempt': 'Attempt',
  'run.columnState': 'State',
  'run.columnNext': 'Next',
  'run.attemptNone': 'Not started',
  'run.listEmptyTitle': 'No assignments yet',
  'run.listEmptyBody':
    'A Decision Run is one consequential business decision, taken with an AI assistant in the room and under a clock you cannot pause. Tassl records what you did and your instructor reads it back. When a course assigns you one, it appears here.',
  'run.noInstitutionTitle': 'Waiting for an invitation',
  'run.noInstitutionBody':
    'Runs belong to a course at an institution. Once you accept an invitation, the assignments in your sections appear here.',
  'run.listShowMore': 'Show more assignments',

  // The next action, one per resting place the student can be in.
  'run.actionStart': 'Start',
  'run.actionStarting': 'Starting…',
  'run.actionStartName': 'Start {label}',
  'run.actionContinue': 'Continue',
  'run.actionRespondToTurn': 'Respond to the Turn',
  'run.actionDefend': 'Defend the decision',
  'run.actionReadDebrief': 'Read the debrief',
  'run.actionOpenRecord': 'Open the Judgment Record',
  'run.actionOpenRun': 'Open the run',
  'run.actionName': '{action} · {label}',
  'run.startFailed': 'The run could not be started. Try again.',
  'run.opensAt': 'Opens {when}',

  // A voided attempt stays on the list, struck through, because it happened; what the student does
  // about it is the re-offer, which is its own run on the same assignment (FR-183).
  'run.voidedRow': 'This attempt was voided.',
  'run.reoffered': 'Continue on attempt {number}',
  'run.reofferPending': 'Your instructor will say whether it is re-offered.',
  'run.underReviewRow': 'Your instructor is reviewing this run.',

  // ---------------------------------------------------------------------------------------------
  // UI-021 the policy display (/runs/[runId]/start, FR-201)
  //
  // Everything the student is owed before a run that counts begins: what they may use, what it is
  // worth, how a confirmed band becomes points, and how long the working clock runs.
  // ---------------------------------------------------------------------------------------------
  'run.startTitle': 'Before you begin',
  'run.startDescription':
    'What this run counts for, what you may use while you take it, and how long the clock runs.',
  'run.startMetaTitle': 'Start a run',
  'run.policyTitle': 'Outside AI tools',
  'run.policyOpen': 'You may use any AI tool',
  'run.policyOpenBody':
    'This course lets you use any AI tool you like, inside Tassl or outside it, and you do not have to say so.',
  'run.policyDeclared': 'Declare what you use outside Tassl',
  'run.policyDeclaredBody':
    'This course lets you use outside AI tools and asks you to say when you do and what for. There is a place to write it down during the run.',
  'run.policyInEnvironment': 'Work with the assistant inside Tassl',
  'run.policyInEnvironmentBody':
    'This course asks you to work only with the assistant inside Tassl. If you use something else, say so during the run.',
  'run.policyNoPenalty':
    'A declaration never lowers a band or a point. Tassl does not detect, infer, or estimate outside use, and nothing it records is treated as misconduct.',
  'run.runTypeLabel': 'Run type',
  'run.runTypeDecision': 'Decision Run',
  'run.runTypeCritique': 'Critique Run',
  'run.weightLabel': 'Weight',
  'run.weightValue': '{weight} percent of the course grade',
  'run.mappingTitle': 'What a confirmed band is worth',
  'run.mappingCaption': 'Points per confirmed band in this course',
  'run.mappingColumnBand': 'Band',
  'run.mappingColumnPoints': 'Points',
  'run.mappingNote':
    'Your instructor confirms a band on each dimension after the run. Your points are the mean over the dimensions assessed; a dimension left unassessed is excluded, never counted as zero. There is no total score, no rank, and no percentile anywhere in Tassl.',
  'run.clockTitle': 'The working clock',
  'run.clockLengthMinutes': '{minutes} minutes',
  'run.clockLengthMinutesSeconds': '{minutes} minutes {seconds} seconds',
  'run.clockStartNote':
    'The clock starts when you lock your frame, not now. Reading the brief and the Evidence Room beforehand costs you nothing.',
  'run.clockUncalibratedNote':
    'No cohort has run this scenario yet, so this length is the author’s estimate rather than a calibrated one.',
  'run.readinessTitle': 'The Readiness Check comes first',
  'run.readinessBody':
    'Sixteen short questions with an eight-minute limit. It is not scored, it never blocks the run, and you can skip past it if it will not submit.',
  'run.beginReadiness': 'Begin the Readiness Check',
  'run.beginPending': 'Beginning…',
  'run.beginFailed': 'The run could not be opened. Try again.',

  // ---------------------------------------------------------------------------------------------
  // UI-027 the RunFrame (every /runs/[runId] screen) and the clock
  // ---------------------------------------------------------------------------------------------
  'run.frameRegion': 'Run',
  'run.frameAssignmentLabel': 'Assignment',
  'run.frameToggle': 'Frame',
  'run.clockLabel': 'Working clock',
  'run.clockPaused': 'Paused',
  // Announced once, at the moment the clock reads it, and never on the seconds in between
  // (DESIGN.md §The clock, 09 §6).
  'run.clockFiveMinutes': 'Five minutes left on the working clock.',
  'run.clockOneMinute': 'One minute left on the working clock.',
  'run.clockExpired': 'The working clock has run out.',

  // ---------------------------------------------------------------------------------------------
  // UI-027 the run status screen (/runs/[runId], FR-140)
  //
  // What a student is told between the defense and the debrief. There is no progress bar, no
  // estimate and no queue position: none of them is a thing Tassl knows, and the honest sentence is
  // that the page will change by itself.
  // ---------------------------------------------------------------------------------------------
  'run.statusTitle': 'Run status',
  'run.statusScoringTitle': 'Your run is being scored',
  'run.statusScoringBody':
    'This takes a moment. The page updates itself when your debrief is ready; you do not have to wait on it.',
  'run.statusUnderReviewTitle': 'Your run is under review by your instructor',
  'run.statusUnderReviewBody':
    'Something in this run needs a person to read it before the bands are set. Your instructor will confirm them; the debrief opens when they do.',
  'run.statusScoredTitle': 'Your debrief is ready',
  'run.statusScoredBody':
    'The bands in it are drafts until your instructor confirms them, and each one is shown with the evidence it was read from.',
  'run.statusConfirmedTitle': 'Your instructor has confirmed the bands',
  'run.statusConfirmedBody':
    'The debrief now shows the confirmed bands and any note left with them.',
  'run.statusRecordedTitle': 'Your Judgment Record is ready',
  'run.statusRecordedBody':
    'The record holds the four graphs, the confirmed bands and the evidence behind them. It is yours to download.',
  'run.statusDefenseCompleteTitle': 'Your defense is in',
  'run.statusDefenseCompleteBody':
    'Nothing more is asked of you. Scoring starts on its own and this page changes when it does.',
  'run.statusVoidedTitle': 'This attempt was voided',
  'run.statusVoidedBody':
    'A voided attempt is not scored and counts for nothing. If your instructor re-offers the assignment, the new attempt appears in your runs.',
  'run.statusEndedTitle': 'This run has ended',
  'run.statusEndedBody':
    'It did not reach a debrief. Your instructor can say what happens next on this assignment.',
  'run.statusAppealTitle': 'This run is under appeal',
  'run.statusAppealBody': 'Your instructor is looking at it again. Nothing is asked of you.',
  'run.statusOpenDebrief': 'Read the debrief',
  'run.statusOpenRecord': 'Open the Judgment Record',
  'run.statusBackToRuns': 'All runs',

  // ---------------------------------------------------------------------------------------------
  // UI-032 the reviewer's list of an assignment's runs (/assignments/[assignmentId])
  //
  // The reviewer's table, so its wording lives beside the run vocabulary it reports rather than in
  // the assignment namespace, which is the configuration form's. `variant` is deliberately absent:
  // it is on `RunReviewSummary` and it is on the replay, and a column of it on the configuration
  // screen would put the planted defect of every student's run one screenshot away from them.
  // ---------------------------------------------------------------------------------------------
  'run.reviewCaption': 'Runs taken on this assignment',
  'run.reviewColumnStudent': 'Student',
  'run.reviewColumnAttempt': 'Attempt',
  'run.reviewColumnState': 'State',
  'run.reviewColumnDecisions': 'Bands decided',
  'run.reviewColumnExport': 'Export',
  'run.reviewColumnActions': 'Actions',
  'run.reviewDecisions': '{count} of 7',
  'run.reviewExportVersion': 'v{version}',
  'run.reviewNoExport': 'None yet',
  'run.reviewWalkthroughDelete': 'Delete',
  'run.reviewWalkthroughDeleteName': 'Delete the walkthrough run of {name}',
  'run.reviewDeleteTitle': 'Delete this walkthrough run?',
  'run.reviewDeleteBody':
    'The run, its trace and everything written in it are removed for good. Only a run on a walkthrough assignment can be deleted; a run that counts is voided instead, which keeps the record.',
  'run.reviewDeleteConfirm': 'Delete the run',
  'run.reviewDeletePending': 'Deleting…',
  'run.reviewDeleteCancel': 'Keep the run',
  'run.reviewDeleted': 'The walkthrough run was deleted.',
  /** The confirmation is fetched on the press that opens it (B4); this is the press it never reached. */
  'run.reviewDeleteUnavailable': 'The confirmation could not be loaded. Try the delete again.',
  'run.reviewReplayNote':
    'The replay of a scored run, with its trace and its band decisions, arrives with the review screens.',

  // ---------------------------------------------------------------------------------------------
  // UI-009 the home panel (Your runs)
  // ---------------------------------------------------------------------------------------------
  'run.homeMore': 'All runs',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(run)
