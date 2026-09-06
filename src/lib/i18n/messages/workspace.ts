// The run workspace (UI-023): the Scenario Brief, the Evidence Room, the frame, and the two panels
// that are not open yet (FR-020 to FR-024, FR-040 to FR-044, FR-117).
//
// It is its own namespace rather than more of `run` because of who carries it. `run` is read by the
// runs list, the policy display, the status screen and the reviewer's table; the workspace is one
// screen, three of whose components are client components under a clock, and D-221's rule is that a
// Client Component ships the namespaces it reads and no others. Splitting the two keeps the room and
// the frame form off every other run screen's bundle, and keeps the runs list off theirs.
//
// Two rules govern every sentence here, and both are product invariants rather than preferences.
//
//   * **The room says nothing about the room.** FR-023 forbids hints, highlighting, a recommended
//     order and summaries, so no string here characterises a document, ranks one, suggests where to
//     start, or says how many are worth reading. What the room tells a student is what a filing
//     cabinet tells them: what each thing is called, who wrote it, and when.
//   * **Nothing observed is misconduct, and nothing is scored here.** A skimmed document, an
//     unopened room and a low confidence are all permitted (FR-024, PRD §7.4), so nothing warns
//     about them. The one number the student writes — confidence — is described as something that
//     is read, never as something that is marked.
import { scopedT } from '../scoped'

export const workspace = {
  // ---------------------------------------------------------------------------------------------
  // The screen (UI-023)
  // ---------------------------------------------------------------------------------------------
  'workspace.metaTitle': 'The scenario',
  'workspace.title': 'The scenario',
  /** `framing`: the room is open, the clock has not started, and the frame is the next thing. */
  'workspace.descriptionFraming':
    'Read the brief and as much of the Evidence Room as you want to. The working clock starts when you lock your frame, so reading now costs you nothing.',
  /** `working`: the frame is behind them and the clock is running. */
  'workspace.descriptionWorking':
    'Your frame is locked and the working clock is running. The Evidence Room stays open for the rest of the decision.',
  /** `paused`: the clock is stopped and the room is shut until it resumes (10 §6). */
  'workspace.descriptionPaused':
    'The run is paused and the clock is stopped. Nothing is lost; the room opens again when the run resumes.',

  // ---------------------------------------------------------------------------------------------
  // The Scenario Brief (FR-020)
  // ---------------------------------------------------------------------------------------------
  'workspace.briefTitle': 'Scenario brief',
  'workspace.briefEmpty': 'This scenario has no brief.',

  // ---------------------------------------------------------------------------------------------
  // The Evidence Room (FR-021 to FR-024, D-082)
  //
  // The description says the two true things a student is owed: everything is readable, and reading
  // is recorded. It recommends nothing and characterises nothing.
  // ---------------------------------------------------------------------------------------------
  'workspace.roomTitle': 'Evidence Room',
  'workspace.roomDescription':
    'Every document in this scenario. All of them are open to you, in any order, for as long as you like. Tassl records which ones you open and how long each stays open; it draws no conclusion from that.',
  'workspace.roomEmptyTitle': 'Nothing to read here',
  'workspace.roomEmptyBody':
    'This scenario carries no documents. The brief above is the whole of what you have been given.',
  'workspace.roomListLabel': 'Documents in the Evidence Room',
  'workspace.documentMeta': '{author} · {date}',
  'workspace.documentNoAuthor': 'No attribution',
  'workspace.openDocument': 'Open',
  'workspace.closeDocument': 'Close',
  /** The room is shut in `paused` alone on this screen; after the lock the student is elsewhere. */
  'workspace.roomPausedNote': 'A document cannot be opened while the run is paused.',
  'workspace.roomOpenFailed': 'That document did not open. Try it again.',

  // ---------------------------------------------------------------------------------------------
  // The document reader (FR-022, FR-024, FR-117)
  // ---------------------------------------------------------------------------------------------
  'workspace.readerOpening': 'Opening the document…',
  'workspace.readerFailedTitle': 'The document did not open',
  'workspace.readerRetry': 'Try again',
  /**
   * The reading stopped being recorded while the document was still on screen: the tab came back
   * from the background and the run had moved on, or the network refused the second open. The
   * student is told rather than left reading something Tassl has stopped counting.
   */
  'workspace.readerReopenFailed':
    'Tassl is no longer recording this reading. {message} You can keep reading; close the document and open it again to start a new reading.',

  // ---------------------------------------------------------------------------------------------
  // The frame (FR-040 to FR-043)
  //
  // The four fields are the student's own words, so the hints say what each field is for and never
  // how to answer it. The word limits are named in the hint and counted under the field.
  // ---------------------------------------------------------------------------------------------
  'workspace.frameTitle': 'Your frame',
  'workspace.frameDescription':
    'What you are deciding, what you are taking as given, and where you stand — written before the assistant is in the room. Tassl locks it without evaluating it or commenting on it.',
  'workspace.decisionLabel': 'The decision',
  'workspace.decisionHint':
    'The decision you are actually making, in your own words. At most 50 words.',
  'workspace.assumptionsLegend': 'Load-bearing assumptions',
  'workspace.assumptionsHint':
    'Three things you are taking as true. Load-bearing means the decision would change if one of them turned out to be false. At most 25 words each.',
  'workspace.assumptionLabel': 'Assumption {number}',
  'workspace.positionLabel': 'Your position now',
  'workspace.positionHint':
    'Where you stand before you have used the assistant. A lean is a position; say what it rests on. At most 100 words.',
  'workspace.confidenceLegend': 'Confidence',
  'workspace.confidenceHint':
    'How sure you are of that position, from 0 to 100. A low number with a reason behind it reads better than a confident guess.',
  'workspace.confidenceSlider': 'Confidence, 0 to 100',
  'workspace.confidenceNumber': 'Confidence as a number',
  'workspace.wordCount': '{count} of {limit} words',
  /** The count is on the line beside it, so the sentence names the limit and not the number typed. */
  'workspace.wordLimit': 'This is over the limit. Cut it back to {limit} words to lock the frame.',
  'workspace.requiredField': 'This is part of the frame. Write something in it.',
  'workspace.confidenceInvalid': 'Confidence is a whole number from 0 to 100.',

  'workspace.lock': 'Lock the frame',
  'workspace.lockPending': 'Locking…',
  'workspace.lockFailed': 'The frame was not locked. Try again.',
  'workspace.lockMoved': 'This run has already moved on. The screen is catching up.',
  'workspace.lockConfirmTitle': 'Lock the frame permanently?',
  'workspace.lockConfirmBody':
    'A locked frame is never edited, replaced, or restored — not by you, and not by your instructor. Locking it unlocks the assistant and starts the working clock.',
  'workspace.lockConfirm': 'Lock it',
  'workspace.lockCancel': 'Keep writing',
  /**
   * The confirmation is fetched on the first focus inside the frame (B4), so by the press it has
   * normally been in hand for minutes. These two are the press that got there first, and the press
   * the confirmation never reached — an irreversible act is never taken unconfirmed, so the second
   * one locks nothing and says so.
   */
  'workspace.lockConfirmLoading': 'Opening the confirmation…',
  'workspace.lockConfirmUnavailable':
    'The confirmation could not be loaded, so nothing was locked. Your frame is as you left it. Press “Lock the frame” again.',

  // ---------------------------------------------------------------------------------------------
  // The locked frame, read back (FR-041): the RunFrame's disclosure, and the panel beside the room
  // ---------------------------------------------------------------------------------------------
  'workspace.framePanelTitle': 'Your frame',
  'workspace.framePanelDecision': 'The decision',
  'workspace.framePanelAssumptions': 'Load-bearing assumptions',
  'workspace.framePanelPosition': 'Your position at the frame',
  'workspace.framePanelConfidence': 'Confidence at the frame',
  'workspace.framePanelConfidenceValue': '{value} of 100',
  'workspace.framePanelLockedAt': 'Locked {when}',
  'workspace.framePanelPermanent':
    'This is what you locked. It is not edited again, and the rest of the run is read against it.',

  // ---------------------------------------------------------------------------------------------
  // What is not open yet
  //
  // Both panels keep their name and their place so the screen a student learns in `framing` is the
  // screen they come back to, and each says plainly what Tassl cannot do rather than when it will.
  // Neither carries a control: a button that cannot act is worse than no button (UI-041's reading).
  // ---------------------------------------------------------------------------------------------
  // ---------------------------------------------------------------------------------------------
  // The assistant, once it answers (FR-050 to FR-056, 11 §3)
  //
  // Three sentences the server writes rather than the screen, so they are here rather than beside
  // the panel that renders them.
  //
  //   * `assistantNoCommentary` is 11 §3's content-policy path, word for word. It is what the log
  //     stores and what the student reads when the provider returned nothing usable: the claims are
  //     still there, and the connective prose is not. It says what happened and nothing about the
  //     claims — a sentence that apologised for "this kind of request" would be the assistant
  //     characterising what was asked, which is the one thing it must never do (FR-056).
  //   * `assistantPaused` is the refusal a second request meets while the run is paused. The
  //     registry's own `ASSISTANT_LOCKED` sentence is about the point in the run; this one is about
  //     a component failure that is being waited out, and the two are different things to be told.
  //   * `assistantBeforeFrame` is the same refusal before the frame is locked (FR-050).
  //   * `assistantDiscardedLate` is what the log stores in place of a reply that came back after the
  //     run had moved on — the decision locked in another tab, the clock auto-locking, a component
  //     failure pausing the run (D-280). The row stays, because the student asked and the clock was
  //     running when they did; the answer is thrown away, because nothing may be written to a run
  //     that has moved on. It is four short clauses and the last one is the one that matters: this
  //     cost them nothing. It is deliberately not `logFailed`, which promises a pause and a credit
  //     that a locked run never had.
  // ---------------------------------------------------------------------------------------------
  'workspace.assistantNoCommentary': 'The assistant could not add commentary on this request.',
  'workspace.assistantPaused':
    'The run is paused, so the assistant is not answering. Resume the run and ask again.',
  'workspace.assistantBeforeFrame':
    'The assistant unlocks when you lock your frame, and closes again when you lock your decision.',
  'workspace.assistantDiscardedLate':
    'No answer reached you. The run had moved on by the time the assistant replied, so the reply was discarded and nothing from it was recorded against your run.',

  'workspace.assistantTitle': 'AI assistant',
  'workspace.assistantLockedBody':
    'The assistant unlocks the moment you lock your frame. It stays locked until then so that the position you write is yours.',
  'workspace.briefEditorTitle': 'Your decision brief',
  'workspace.briefEditorLockedBody':
    'The brief is what you hand in: a recommendation, the reasoning under it, and what would change your mind. It opens after you lock your frame.',
  // `briefEditorUnlockedBody` stood here until Step 8.3 and is gone with the seat it filled: the
  // working screen draws the editor now, so a sentence saying Tassl cannot take a brief would be
  // a string describing a state the product no longer has.

  // ---------------------------------------------------------------------------------------------
  // The assistant panel (UI-023 middle column; FR-050 to FR-053, FR-056)
  //
  // The panel describes the *mechanics* of delegating and never the assistant's reliability. It
  // does not say the assistant is trustworthy, and it does not warn that it may not be: either
  // sentence would be the product taking a position on claims the student is the one being asked
  // to take a position on (FR-056, PRD §7.5). What it may say — and what the closing sentences of
  // every reply also say — is where the evidence is and that checking is free.
  // ---------------------------------------------------------------------------------------------
  'workspace.assistantDescription':
    'Ask for anything inside this scenario. Claims the assistant raises arrive as their own cards, and every request is kept in the Delegation Log.',
  'workspace.assistantRequestLabel': 'Your request',
  'workspace.assistantRequestHint':
    'Ask in your own words. Asking costs you no clock time. At most {limit} characters.',
  'workspace.assistantCharCount': '{count} of {limit} characters',
  'workspace.assistantSend': 'Ask the assistant',
  'workspace.assistantSending': 'Asking…',
  'workspace.assistantRequestRequired': 'Write a request before sending it.',
  'workspace.assistantRequestTooLong':
    'This is over the limit. Cut it back to {limit} characters to send it.',
  /** The reply's own region, and the sentence a student sees before they have asked anything. */
  'workspace.assistantReplyLabel': 'The assistant’s reply',
  'workspace.assistantAsked': 'You asked',
  'workspace.assistantEmptyTitle': 'Nothing asked yet',
  'workspace.assistantEmptyBody':
    'The reply appears here as it arrives. Everything you ask is recorded in the Delegation Log, and asking costs you no clock time.',
  'workspace.assistantStreaming': 'The assistant is answering…',
  /**
   * The one announcement (UI-023 A11y): made when the reply is finished, never per segment. Three
   * sentences rather than one with a count in it, so "1 claims" is never read out.
   */
  'workspace.assistantReplyComplete': 'Reply complete. {count} claims surfaced.',
  'workspace.assistantReplyCompleteOne': 'Reply complete. One claim surfaced.',
  'workspace.assistantReplyCompleteNone': 'Reply complete. No claims surfaced.',
  'workspace.assistantFailed': 'The assistant did not answer. Try the request again.',
  /** 429 on the `llm` bucket (D-026); the seconds come from the envelope's `retryAfterSeconds`. */
  'workspace.assistantRateLimited':
    'That is a lot of requests in a short time. Try again in {seconds} seconds.',

  // ---------------------------------------------------------------------------------------------
  // Claim cards (FR-051, FR-052, DATA-033)
  //
  // A card carries the claim as the author wrote it and says nothing about it. There is no
  // reliability mark, no source badge, no "verified" tick and no ordering by anything: what a claim
  // deserved is the debrief's to say, after the run is scored (12 §8.1).
  // ---------------------------------------------------------------------------------------------
  'workspace.claimHeading': 'Claim {key}',
  // `claimStancePending` stood here until Step 8.3 filled the seat it described. The card carries
  // the five stances now, so the sentence that said Tassl could not take one has gone with it.
  'workspace.claimUsed': 'Used',
  'workspace.claimUsedExplain': 'You marked this claim used in the Delegation Log.',

  // ---------------------------------------------------------------------------------------------
  // Unverified numbers (D-068, D-281)
  //
  // A mark about *provenance*, and the wording is the whole of the care here: it says where the
  // figure came from, never whether it is right. The assistant does not tell a student which of its
  // sentences to distrust (FR-056) — it tells them which figures have a source in the room, which
  // is a fact they could establish themselves and the reason the Evidence Room is open.
  //
  // `Label` is read after the figure by a screen reader, in place of the tooltip nobody hovers, so
  // it is written to be read mid-sentence and parenthetically: "…a payback of 14 (this figure is
  // not in a claim or a document you have opened) months." `Withheld` is what stands where the
  // figure itself was, under `ASSISTANT_NUMERIC_GUARD=block`.
  // ---------------------------------------------------------------------------------------------
  'workspace.unverifiedNumberLabel':
    '(this figure is not in a claim or a document you have opened)',
  'workspace.unverifiedNumberTooltip':
    'This figure is not in a claim or in a document you have opened. That says where it came from, not whether it is right.',
  'workspace.unverifiedNumberWithheld': 'Figure withheld',

  // ---------------------------------------------------------------------------------------------
  // The Delegation Log (FR-060, FR-063, FR-084)
  // ---------------------------------------------------------------------------------------------
  'workspace.logTitle': 'Delegation Log',
  'workspace.logDescription':
    'What you asked, what came back, and what you did with it. Your instructor reads this beside the rest of the run.',
  'workspace.logEmptyTitle': 'Nothing delegated yet',
  'workspace.logEmptyBody':
    'Each request you make to the assistant is listed here with the claims it raised.',
  'workspace.logEntryTitle': 'Delegation {seq}',
  'workspace.logAsked': 'You asked',
  'workspace.logAnswered': 'The assistant answered',
  'workspace.logInTurnWindow': 'In the Turn window',
  /** A delegation whose provider never answered (FR-001): the row exists so the gap is named. */
  'workspace.logFailed':
    'No answer came back. The run paused, your clock stopped, and the time was given back when you resumed.',
  'workspace.logClaimsTitle': 'Claims in this reply',
  'workspace.logNoClaims': 'No claim came back with this reply.',
  'workspace.logMarkUsed': 'Mark as used',
  'workspace.logMarkUsedFor': 'Mark claim {key} as used',
  /** D-270: reliance is not taken back, so the control says what it does before it is pressed. */
  'workspace.logUsedNote':
    'Marking a claim used records that you leaned on it. A mark stays on the record.',
  'workspace.logWhyLabel': 'Why you asked',
  'workspace.logWhyLabelFor': 'Why you asked, delegation {seq}',
  'workspace.logWhyHint':
    'One line in your own words, if you want one. You can change it while the run is open. At most {limit} characters.',
  'workspace.logWhyTooLong':
    'This is over the limit. Cut it back to {limit} characters to save it.',
  'workspace.logWhySave': 'Save',
  'workspace.logWhySaving': 'Saving…',
  'workspace.logWhySaved': 'Saved.',
  'workspace.logWriteFailed': 'That did not save. Try it again.',
  'workspace.logPausedNote': 'The log cannot be written to while the run is paused.',

  // ---------------------------------------------------------------------------------------------
  // The outside-tool declaration (FR-061, FR-062, FR-006)
  //
  // The no-penalty sentence is beside the control rather than behind it, because it is the reason
  // the control is safe to use. Nothing here asks whether the tool was allowed, and nothing here
  // reports what the course's policy is: the policy was stated before the run began (UI-021), and
  // a declaration has the same effect under all three of them, which is none.
  // ---------------------------------------------------------------------------------------------
  'workspace.declarationTitle': 'Declare outside-tool use',
  'workspace.declarationOpen': 'Declare outside-tool use',
  'workspace.declarationBody':
    'Say what you used outside Tassl and what for. It is recorded with your run and has no other effect.',
  'workspace.declarationPurposeLabel': 'What you used, and what for',
  'workspace.declarationPurposeHint': 'One sentence is enough. At most {limit} characters.',
  'workspace.declarationNoPenalty':
    'A declaration never lowers a band or a point. Tassl does not detect, infer, or estimate outside use, and nothing it records is treated as misconduct.',
  'workspace.declarationSubmit': 'Record it',
  'workspace.declarationSubmitting': 'Recording…',
  'workspace.declarationCancel': 'Cancel',
  'workspace.declarationRecorded': 'Recorded. It sits with the run and changes nothing about it.',
  'workspace.declarationRequired': 'Write what you used it for.',
  'workspace.declarationTooLong':
    'This is over the limit. Cut it back to {limit} characters to record it.',
  'workspace.declarationFailed': 'That was not recorded. Try it again.',

  // ---------------------------------------------------------------------------------------------
  // The paused overlay (FR-001, UI-023)
  //
  // A component failed, which is Tassl's fault and not the student's, so the overlay says what
  // happened, what it cost them (nothing), and offers the one control that matters. The cause is in
  // plain language and names no internals: which delegation, which document and which provider are
  // the reviewer's replay to carry, not a sentence to read under a stopped clock.
  // ---------------------------------------------------------------------------------------------
  'workspace.pausedTitle': 'The run is paused',
  'workspace.pausedCauseAssistantFailure': 'The assistant did not answer.',
  'workspace.pausedCauseDocumentFailure': 'A document did not open.',
  'workspace.pausedCauseActionFailure': 'A check you asked for did not finish.',
  'workspace.pausedCauseConnection': 'The connection to Tassl dropped.',
  'workspace.pausedBody':
    'Your clock stopped when it happened, and the time this pause takes is given back to you when you resume. Nothing you have done is lost.',
  'workspace.pausedResume': 'Resume the run',
  'workspace.pausedResuming': 'Resuming…',
  'workspace.pausedFailed': 'The run did not resume. Try it again.',

  // ---------------------------------------------------------------------------------------------
  // Stances, interrogation actions and escalations (FR-070 to FR-074, FR-080, FR-090 to FR-093)
  //
  // Two rules govern every sentence here, and both are the product invariant of CLAUDE.md.
  //
  //   * **Nothing says whether a claim is right.** FR-073 is explicit that Tassl never says a claim
  //     is wrong, so no refusal, hint or label below characterises a claim, its evidence, or the
  //     stance it deserves. A check shows what the author wrote and stops there.
  //   * **Nothing says what the author authored about *this* claim.** Which claims carry an
  //     escalation reply is the map the run is asking the student to draw (D-244), so the escalation
  //     sentences speak about the run's own two escalations and never about the claim.
  // ---------------------------------------------------------------------------------------------
  'workspace.claimNotSurfaced':
    'That claim has not come up in this run yet, so there is nothing to take a position on.',
  'workspace.claimsNotOpen':
    'Claims are yours to work on from the moment your frame is locked until you lock your decision, and again during the Turn.',
  'workspace.actionNotAvailable':
    'This claim does not offer that check. The ones it does offer are on the claim card.',

  // ---------------------------------------------------------------------------------------------
  // The stance control (FR-080, FR-085, UI-023)
  //
  // Five options, one legend, and not one word about which of them a claim deserves. The hint says
  // the two facts a student acts on: it costs nothing, and it can be changed — and that both are
  // kept, which is the plain statement of FR-085 rather than a warning.
  // ---------------------------------------------------------------------------------------------
  'workspace.stanceLegend': 'Your stance',
  'workspace.stanceLegendFor': 'Your stance on claim {key}',
  /**
   * One line, under every claim card, so it is short on purpose: a screen with five claims on it
   * carries five copies, and the two facts a student acts on at the moment of the press are that it
   * is free and that it can be changed. "Both are kept" is FR-085 stated plainly rather than as a
   * caution — changing your mind is the move the run is measuring, not a confession.
   */
  'workspace.stanceHint':
    'It costs no clock time, and you can change it while the run is open; both are kept.',
  'workspace.stanceChanged': 'Changed from {stance}.',
  'workspace.stanceSaved': 'Stance on claim {key}: {stance}.',
  'workspace.stanceFailed': 'That stance was not recorded. Try it again.',
  'workspace.stanceClosed': 'Stances are yours to set while the working clock runs.',

  // ---------------------------------------------------------------------------------------------
  // The interrogation actions (FR-070 to FR-073, UI-023)
  //
  // The menu lists what this claim's author wrote a result for and nothing else, with what each one
  // costs in front of the press. Nothing here says a check is worth running and nothing says what
  // running one would show: a menu that recommended a check on some claims and not others would be
  // the product pointing at the claims worth doubting.
  // ---------------------------------------------------------------------------------------------
  'workspace.actionsMenu': 'Check it',
  'workspace.actionsMenuFor': 'Check claim {key}',
  'workspace.actionsMenuLabel': 'Checks on claim {key}',
  'workspace.actionsNone': 'This claim offers no checks.',
  'workspace.actionSourceTrace': 'Source Trace',
  'workspace.actionReplicationCheck': 'Replication Check',
  'workspace.actionDecompositionCheck': 'Decomposition Check',
  /** The cost, in the words UI-023 puts on the menu: "1 min", "3 min", "4 min", "5 min". */
  'workspace.actionCost': '{minutes} min',
  'workspace.actionCostSpoken': 'costs {minutes} minutes of your working clock',
  'workspace.actionCostSpokenOne': 'costs one minute of your working clock',
  'workspace.actionRunning': 'Running the check…',
  'workspace.actionFailed': 'That check did not run. Try it again.',
  'workspace.actionRan': 'Check finished: {action} on claim {key}.',
  'workspace.actionsReadAgain': 'Read it again',

  // The result sheet. The author's own words, and a sentence saying exactly that: Tassl adds
  // nothing to a result and draws no conclusion from one (FR-073).
  'workspace.actionResultTitle': '{action} on claim {key}',
  'workspace.actionResultDescription':
    'What the author of this scenario wrote for this check, as they wrote it. Tassl adds nothing to it and draws no conclusion from it.',
  'workspace.actionResultCost': 'This check cost {minutes} minutes of your working clock.',
  'workspace.actionResultCostOne': 'This check cost one minute of your working clock.',
  'workspace.actionResultEmpty': 'The check returned nothing.',
  /** The keys a `verification_paths` result uses; an unlisted key is shown as the author wrote it. */
  'workspace.actionResultDocument': 'Document',
  'workspace.actionResultPassage': 'Passage',
  'workspace.actionResultDate': 'Date',
  'workspace.actionResultAuthor': 'Author',
  'workspace.actionResultFinding': 'Result',
  'workspace.actionResultSteps': 'Steps',
  'workspace.actionResultMethod': 'Method',
  'workspace.actionResultNote': 'Note',

  // ---------------------------------------------------------------------------------------------
  // Escalation (FR-090 to FR-093, D-116, D-244)
  //
  // Every sentence here is about the *run* and never about the claim: how many escalations are
  // left, what one costs, and what came back. Never whether this claim is one worth escalating,
  // which is exactly the authored knowledge the run asks the student to work out for themselves.
  // ---------------------------------------------------------------------------------------------
  'workspace.escalate': 'Escalate',
  'workspace.escalateFor': 'Escalate claim {key}',
  'workspace.escalateTitle': 'Escalate to a colleague',
  'workspace.escalateBody':
    'Say in one sentence what you cannot settle yourself. A colleague reads the claim and answers you. It costs five minutes of your working clock.',
  'workspace.escalateStatementLabel': 'What you cannot settle',
  'workspace.escalateStatementHint':
    'One sentence, at least three words, at most {limit} characters.',
  'workspace.escalateSubmit': 'Send it',
  'workspace.escalateSending': 'Sending…',
  'workspace.escalateCancel': 'Cancel',
  'workspace.escalateTooShort': 'Write at least three words.',
  'workspace.escalateTooLong':
    'This is over the limit. Cut it back to {limit} characters to send it.',
  'workspace.escalateFailed': 'The escalation did not go through. Try it again.',
  'workspace.escalateRemaining': 'You have {count} escalations left in this run.',
  'workspace.escalateRemainingOne': 'You have one escalation left in this run.',
  'workspace.escalateNoneLeft': 'You have used both escalations in this run.',
  'workspace.escalationTitle': 'The colleague’s reply',
  'workspace.escalationYouWrote': 'You wrote',
  'workspace.escalationAnswered': 'They answered',
  /**
   * What it cost, from the charge the service actually applied rather than from the price list.
   *
   * They are the same number in every ordinary case. They are not when the clock had less than five
   * minutes left: `chargeCost` applies what there was, the action still completes (FR-072), and a
   * sentence that said "five minutes" would be telling the student something about their own clock
   * that is not true.
   */
  'workspace.escalationCost': 'This escalation cost {minutes} minutes of your working clock.',
  'workspace.escalationCostOne': 'This escalation cost one minute of your working clock.',
  'workspace.escalationCostPartial':
    'This escalation cost what was left of your working clock, which was under a minute.',
  'workspace.escalationDone': 'The reply to your escalation on claim {key} has arrived.',

  // ---------------------------------------------------------------------------------------------
  // The Decision Brief editor (FR-100, FR-101, FR-103, FR-108, UI-023 right column)
  //
  // The brief is what the student hands in, so the hints say what each field is for and never how
  // to answer it, which is the rule the frame's hints follow. The named numeric fields carry the
  // author's own labels and the unit the figure is entered in; nothing says which of them a claim
  // holds a matching number for, because FR-101 is decided on the server, at the lock.
  // ---------------------------------------------------------------------------------------------
  'workspace.briefDescription':
    'What you recommend, what it rests on, and what would change your mind. It saves as you type; nothing is filed until you lock the decision.',
  'workspace.briefRecommendationLabel': 'Your recommendation',
  'workspace.briefRecommendationHint':
    'The decision you are actually recommending, in your own words. At most {limit} words.',
  'workspace.briefRationaleLabel': 'Why',
  'workspace.briefRationaleHint':
    'The reasoning under the recommendation, including what you checked and what you did not. At most {limit} words.',
  'workspace.briefAssumptionsLegend': 'Load-bearing assumptions',
  'workspace.briefAssumptionsHint':
    'Three things the recommendation rests on. Load-bearing means it would change if one of them turned out to be false. At most {limit} words each.',
  'workspace.briefAssumptionLabel': 'Assumption {number}',
  'workspace.briefChangeMyMindLabel': 'What would change your mind',
  'workspace.briefChangeMyMindHint':
    'What you would have to see to recommend something else. At most {limit} words.',
  'workspace.briefConfidenceLegend': 'Confidence',
  'workspace.briefConfidenceHint':
    'How sure you are of the recommendation, from 0 to 100. A low number with a reason behind it reads better than a confident guess.',
  'workspace.briefConfidenceSlider': 'Confidence in the recommendation, 0 to 100',
  'workspace.briefConfidenceNumber': 'Confidence as a number',
  'workspace.briefNamedFieldsLegend': 'The figures you are betting on',
  'workspace.briefNamedFieldsHint':
    'The numbers this decision rests on. Numbers only: digits, a decimal point and a minus sign.',
  'workspace.briefNamedFieldLabel': '{label}, in {unit}',
  'workspace.briefNumberInvalid':
    'This field takes a number. Digits, a decimal point, a minus sign.',
  'workspace.briefWordLimit':
    'This is over the limit. Cut it back to {limit} words to file the decision.',
  'workspace.briefRequiredField': 'This is part of the brief. Write something in it.',
  'workspace.briefConfidenceInvalid': 'Confidence is a whole number from 0 to 100.',
  'workspace.briefSaving': 'Saving…',
  'workspace.briefSaved': 'Saved.',
  'workspace.briefSaveFailed':
    'The last change did not save. What is on screen is not lost; it saves again as you type.',
  'workspace.briefClosedNote': 'The brief cannot be written while the run is paused.',

  /** The units a named field is entered in (`named_fields.unit`, 06 §3.1). */
  'workspace.unitPercent': 'percent',
  'workspace.unitRatio': 'a ratio',
  'workspace.unitMonths': 'months',
  'workspace.unitUsd': 'dollars',
  'workspace.unitCount': 'a count',
  'workspace.unitOther': 'the scenario’s own unit',

  // ---------------------------------------------------------------------------------------------
  // The Decision Lock and its refusal (FR-084, FR-102, FR-103, FR-108, UI-024)
  //
  // The confirmation says what filing does, in the order it happens to the student, because the act
  // is irreversible. The refusal names the claim by the words the student already read and asks for
  // a stance — not for a particular stance, and with nothing said about why the claim matters.
  // ---------------------------------------------------------------------------------------------
  'workspace.decisionLock': 'Lock the decision',
  'workspace.decisionLocking': 'Filing…',
  'workspace.decisionLockConfirmTitle': 'File this decision?',
  'workspace.decisionLockConfirmBody':
    'Filing is irreversible. The brief is frozen as it stands, the working clock ends, the assistant and the Evidence Room close, and the Turn follows. You may add one short addendum afterwards, which is kept apart from the decision.',
  'workspace.decisionLockConfirm': 'File it',
  'workspace.decisionLockCancel': 'Keep working',
  'workspace.decisionLockFailed': 'The decision was not filed. Try it again.',
  'workspace.decisionLockLoading': 'Opening the confirmation…',
  'workspace.decisionLockUnavailable':
    'The confirmation could not be loaded, so nothing was filed. Your brief is as you left it. Press “Lock the decision” again.',
  'workspace.lockRefusedTitle': 'A claim you leaned on has no stance',
  'workspace.lockRefusedBody':
    'You leaned on this claim and you have not taken a position on it. Take one, then file the decision.',
  'workspace.lockRefusedClaimLabel': 'The claim',
  'workspace.lockRefusedGoToClaim': 'Go to the claim',
  'workspace.lockRefusedClose': 'Back to the brief',
  'workspace.lockRefusedNotOnScreen':
    'The claim is in the Delegation Log, under the request that raised it.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(workspace)
