// The locked decision (UI-024, `/runs/[runId]/locked`): the filed brief, the frozen frame, the wait
// for the Turn, and the one addendum (FR-102, FR-107, FR-110).
//
// It is its own namespace rather than more of `workspace` for the reason `workspace` is not more of
// `run`: the only client component on this screen is the addendum dialog, and D-221's rule is that
// a Client Component ships the namespaces it reads and no others. The workspace namespace is three
// hundred strings about a room that has closed.
//
// Two rules govern every sentence here.
//
//   * **Nothing is offered that the lock took away.** The decision is irreversible (FR-102), so no
//     string suggests an edit, a retry, a correction or an appeal. What is offered is the addendum,
//     and it is described as what it is: a note beside the decision, never part of it.
//   * **Nothing is evaluated.** The brief is read back in the student's own words with no mark, no
//     summary and no comment — not whether it was quick (FR-106's speed outlier is the
//     instructor's, and telling the student would make a signal into a penalty), not whether a
//     field was left empty by the clock, and not what any claim deserved.
import { scopedT } from '../scoped'

export const decision = {
  // ---------------------------------------------------------------------------------------------
  // The screen
  // ---------------------------------------------------------------------------------------------
  'decision.metaTitle': 'Decision locked',
  'decision.title': 'Decision locked',
  'decision.description':
    'Your decision is filed and cannot be changed. The next thing that happens is the Turn: a message from the world, arriving on its own.',

  // ---------------------------------------------------------------------------------------------
  // The filed brief (FR-102, FR-103)
  //
  // An auto-locked run files whatever was written, empty fields and all (FR-105), so every field
  // has an empty reading — and it says the field was empty when the clock ended, which is what
  // happened, rather than anything about the student.
  // ---------------------------------------------------------------------------------------------
  'decision.briefTitle': 'The decision you filed',
  'decision.briefPermanent':
    'This is what was filed. It is not edited again, and the rest of the run is read against it.',
  'decision.briefLockedAt': 'Filed {when}',
  'decision.briefRecommendation': 'Your recommendation',
  'decision.briefRationale': 'Why',
  'decision.briefAssumptions': 'Load-bearing assumptions',
  'decision.briefAssumption': 'Assumption {number}',
  'decision.briefChangeMyMind': 'What would change your mind',
  'decision.briefConfidence': 'Confidence at the lock',
  'decision.briefConfidenceValue': '{value} of 100',
  'decision.briefFigures': 'The figures you were betting on',
  'decision.briefFigureUnit': '{label}, in {unit}',
  'decision.briefEmptyField': 'Left empty.',
  'decision.briefEmptyValue': 'No figure.',
  'decision.briefMissingTitle': 'Nothing was filed in the brief',
  'decision.briefMissingBody':
    'The working clock ended before anything was written, so the decision was filed as it stood. The frame you locked is below.',

  // The units a named field is entered in (`named_fields.unit`, 06 §3.1).
  'decision.unitPercent': 'percent',
  'decision.unitRatio': 'a ratio',
  'decision.unitMonths': 'months',
  'decision.unitUsd': 'dollars',
  'decision.unitCount': 'a count',
  'decision.unitOther': 'the scenario’s own unit',

  // ---------------------------------------------------------------------------------------------
  // The frozen frame (FR-041)
  // ---------------------------------------------------------------------------------------------
  'decision.frameTitle': 'The frame you locked',
  'decision.frameBody':
    'What you wrote before the assistant was in the room. It is here so the decision above can be read beside the position you started from.',

  // ---------------------------------------------------------------------------------------------
  // Waiting for the Turn (FR-110, UI-024)
  //
  // The countdown is a plain reading, not a warning: nothing is being lost while it runs, and the
  // student has nothing to do until it ends. The screen moves on by itself when the Turn lands.
  // ---------------------------------------------------------------------------------------------
  'decision.turnTitle': 'The Turn',
  'decision.turnBody':
    'A message from the world arrives shortly, and the run reopens for twelve minutes so you can hold, revise or reverse. You do not need to do anything until then; this page moves on by itself.',
  'decision.turnCountdownLabel': 'Time until the Turn',
  'decision.turnDue': 'The Turn is due now. This page opens it as soon as it lands.',
  'decision.turnArrived': 'The Turn has arrived. Opening it now.',

  // ---------------------------------------------------------------------------------------------
  // The addendum (FR-107)
  //
  // Fifty words, once, and the sentence that says what it is for: reviewers read it, and it is
  // never folded into the decision. "Once" is said before the press, not discovered after it.
  // ---------------------------------------------------------------------------------------------
  'decision.addendumTitle': 'Addendum',
  'decision.addendumBody':
    'One short note beside the filed decision — something you meant to say, or something you noticed as the clock ended. Your instructor reads it with the run. It is never folded into the decision itself, and you may add one.',
  'decision.addendumOpen': 'Add an addendum',
  'decision.addendumDialogTitle': 'Add an addendum',
  'decision.addendumDialogBody':
    'Up to fifty words, added once. It sits beside the decision you filed and never becomes part of it; reviewers see it marked as an addendum, with the time you wrote it.',
  'decision.addendumLabel': 'Your addendum',
  'decision.addendumHint': 'At most {limit} words. You can add one addendum per run.',
  'decision.addendumWordCount': '{count} of {limit} words',
  'decision.addendumSubmit': 'Add it',
  'decision.addendumSubmitting': 'Adding…',
  'decision.addendumCancel': 'Cancel',
  'decision.addendumRequired': 'Write the addendum before adding it.',
  'decision.addendumTooLong': 'This is over the limit. Cut it back to {limit} words to add it.',
  'decision.addendumFailed': 'The addendum was not added. Try it again.',
  'decision.addendumAdded': 'Added. It sits beside the decision and changes nothing about it.',
  'decision.addendumUsedTitle': 'Your addendum',
  'decision.addendumUsedNote':
    'One addendum per run, and this run has its one. It is kept apart from the decision above.',
  'decision.addendumWrittenAt': 'Added {when}',
  'decision.addendumClosed':
    'An addendum can be added from the lock until the run is recorded. That window has closed.',
  'decision.addendumLoading': 'Opening the addendum…',
  'decision.addendumUnavailable':
    'The addendum form could not be loaded, so nothing was added. Press “Add an addendum” again.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(decision)
