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
  'workspace.assistantTitle': 'AI assistant',
  'workspace.assistantLockedBody':
    'The assistant unlocks the moment you lock your frame. It stays locked until then so that the position you write is yours.',
  'workspace.assistantUnlockedBody':
    'Your frame is locked, so the assistant is unlocked. Tassl cannot carry a request to it yet. The Evidence Room stays open, and everything you read there is recorded.',
  'workspace.briefEditorTitle': 'Your decision brief',
  'workspace.briefEditorLockedBody':
    'The brief is what you hand in: a recommendation, the reasoning under it, and what would change your mind. It opens after you lock your frame.',
  'workspace.briefEditorUnlockedBody':
    'Tassl cannot take your decision brief yet, so there is nothing to lock. Read the room and work with what you have.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(workspace)
