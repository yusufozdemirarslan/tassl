// The defense (UI-026, `/runs/[runId]/defense`): the six to nine typed questions the run record
// selects, their answers, and the artifacts panel (FR-120 to FR-126).
//
// Step 9.2 added the strings the *server* writes into a question, because a rendered question is the
// one place in this product where authored prose and the run's own record are joined into a sentence
// a student reads (FR-122). Step 9.3 adds the screen's own.
//
// Three rules govern them.
//
//   * **The figure is the student's own number, in the author's own unit.** `{figure}` is filled
//     from the value the student typed into a named field and the unit the author declared for it
//     (D-342), so a question about eleven months says eleven months and not `11`.
//   * **Nothing here evaluates anything.** A question quotes the run and asks; it never says a
//     figure was wrong, unsourced, or worth checking, because whether it was is precisely what the
//     defense is asking the student to say for themselves. The same holds of the follow-up: it is
//     labelled "Follow-up" and nothing on the screen says why it was asked, because the reason
//     (D-031, D-090) is the instrument.
//   * **The empty answer is a real answer and the screen says so before it is given.** FR-124 keeps
//     an empty answer as evidence, so nothing here scolds a student for one, and the confirm dialog
//     states the consequence in one sentence rather than warning about it twice.
import { scopedT } from '../scoped'

export const defense = {
  // A named-field value rendered into `{figure}` (10 §9 step 4). `ratio`, `count` and `other` are
  // the bare number: "0.4 a ratio" is not a thing anyone says, and the author's own sentence around
  // the placeholder is what gives those units their meaning.
  'defense.figurePercent': '{value} percent',
  'defense.figureRatio': '{value}',
  'defense.figureMonths': '{value} months',
  'defense.figureUsd': '{value} dollars',
  'defense.figureCount': '{value}',
  'defense.figureOther': '{value}',

  // ---------------------------------------------------------------------------------------------
  // The screen (UI-026)
  // ---------------------------------------------------------------------------------------------
  'defense.metaTitle': 'The defense',
  'defense.title': 'The defense',
  'defense.description':
    'Questions about the run you just made. There is no assistant here and no Evidence Room: this is what you can say about your own decision with your own work in front of you.',
  /**
   * It said "nothing is being timed", and that was not true: `durationMs` is measured from the
   * question taking focus to the press of submit and stored on the answer (UI-026). What is true is
   * the thing the sentence was reaching for — there is no clock running out on this stage — and this
   * product's voice describes what happened rather than what would be reassuring (D-354).
   */
  'defense.noRoomNote':
    'There is no clock on this stage; nothing runs out and nothing is taken away. Answer in your own words; “I do not know” is an answer, and so is leaving one empty.',

  // ---------------------------------------------------------------------------------------------
  // The interview
  // ---------------------------------------------------------------------------------------------
  'defense.questionsTitle': 'Questions',
  'defense.questionsProgress': '{answered} of {total} answered',
  'defense.questionHeading': 'Question {number}',
  'defense.followUpHeading': 'Follow-up',
  'defense.answerLabel': 'Your answer',
  /** Said before the press, not discovered after it: `QUESTION_ALREADY_ANSWERED` refuses a second. */
  'defense.answerHint':
    'At most {limit} characters. An answer is filed once and is not edited again.',
  'defense.answerCount': '{count} of {limit} characters',
  'defense.answerSubmit': 'Submit answer',
  'defense.answerSubmitting': 'Submitting…',
  'defense.answerTooLong':
    'This is over the limit. Cut it back to {limit} characters to submit it.',
  'defense.answerFailed': 'The answer was not recorded. Try it again.',
  'defense.answerEmpty': 'Nothing was written.',
  'defense.answeredAt': 'Answered {when}',
  'defense.answerRecorded': 'Answer recorded.',
  'defense.followUpAsked': 'A follow-up was added under that question.',
  'defense.emptyTitle': 'There is nothing to answer',
  'defense.emptyBody':
    'This run has no defense questions on it. Your instructor can say what happens next on this assignment.',
  'defense.emptyAction': 'All runs',

  // ---------------------------------------------------------------------------------------------
  // Finishing (FR-120, FR-124)
  // ---------------------------------------------------------------------------------------------
  'defense.finish': 'Finish the defense',
  'defense.finishing': 'Finishing…',
  'defense.finishConfirmTitle': 'Finish the defense?',
  'defense.finishConfirmBody':
    'The defense is filed once and is not reopened. Your run goes to scoring from here.',
  'defense.finishConfirmUnansweredOne':
    'One question has no answer. Unanswered questions count as no answer, and are filed empty.',
  'defense.finishConfirmUnansweredMany':
    '{count} questions have no answer. Unanswered questions count as no answer, and are filed empty.',
  'defense.finishCancel': 'Keep answering',
  'defense.finishConfirmAction': 'Finish it',
  'defense.finishFailed': 'The defense was not finished. Try it again.',
  /**
   * Finishing files an empty answer on everything still unanswered before it completes, so a
   * failure part-way through leaves some of them filed. The student is told, because the alternative
   * is pressing again and wondering what the first press did.
   */
  'defense.finishPartial':
    'Some answers were filed before this stopped. Nothing you had already answered has changed.',

  // ---------------------------------------------------------------------------------------------
  // The artifacts (UI-026): what the questions are about
  // ---------------------------------------------------------------------------------------------
  'defense.artifactsRegion': 'What you filed',
  'defense.artifactsTitle': 'What you filed',
  'defense.artifactsDescription':
    'Your own work, as it stands on the record. It is here to answer from; nothing on it can be changed.',
  'defense.addendumTitle': 'Your addendum',
  'defense.addendumAt': 'Added {when}',
  'defense.turnTitle': 'Your Turn response',
  'defense.turnHold': 'Hold',
  'defense.turnRevise': 'Revise',
  'defense.turnReverse': 'Reverse',
  'defense.turnImplicit':
    'The window closed without a response, so the decision you had already filed stands.',
  'defense.turnJustification': 'Why',
  'defense.turnConfidence': 'Confidence after the Turn',
  'defense.turnConfidenceValue': '{value} of 100',
  'defense.turnFiledAt': 'Filed {when}',
  'defense.turnNone': 'No Turn response is on this run.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(defense)
