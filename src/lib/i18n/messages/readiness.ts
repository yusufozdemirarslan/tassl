// The Readiness Check and the concept map that closes it (UI-022, FR-010 to FR-018).
//
// Its own namespace rather than more of `run.ts` for the reason 16 §3.4 gives: the check screen is
// a Client Component that renders sixteen items, four options each, under a clock, and it should
// carry the sixteen sentences it uses rather than the run vocabulary of every other screen. The
// four strings the *server* refuses a check with stay in `run.ts`, beside the service that throws
// them.
//
// Two product invariants shape every line below, and both are at their sharpest here, because a
// sixteen-question check is the one place in Tassl a student expects a mark.
//
//   * **No score, no total, no percentage, no rank, anywhere** (CLAUDE.md, FR-012, PRD §7.1).
//     Nothing here counts correct answers. The one number the check does say out loud is how many
//     items have *no answer* — which is progress through a form, not a result — and it is said
//     because the submit has to be honest about what it is closing.
//   * **Nothing is disclosed early.** No sentence names a warranted stance, an evidence status, a
//     failure family, a planted flag, a verification result or a variant. The item's own category
//     (`foundation`, `defect_concept`, `ai_behavior`) has no string here either: the screen does not
//     render it, because naming a group of questions "defect concept" tells a student what to go
//     looking for in the Evidence Room.
//
// The register is the product's: say what is true, say what happens next, and do not reassure past
// what is known. A student reads all of this with eight minutes running.
import { scopedT } from '../scoped'

export const readiness = {
  // ---------------------------------------------------------------------------------------------
  // The check (/runs/[runId]/readiness)
  // ---------------------------------------------------------------------------------------------
  'readiness.metaTitle': 'Readiness Check',
  'readiness.title': 'Readiness Check',
  'readiness.description':
    'Sixteen questions in eight minutes. Answer them in any order, and change any answer while the clock runs. The check is not scored and it never blocks the run; it closes with a short reading of the ideas the scenario turns on.',

  // The eight-minute clock. It counts down to an instant the server set when the run entered the
  // check (D-042): the browser displays it and announces the last minute, and decides nothing.
  'readiness.timerLabel': 'Readiness Check clock',
  'readiness.timerOneMinute': 'One minute left on the Readiness Check.',
  'readiness.timerExpired':
    'Time is up. The check submitted itself with the answers you had given.',
  'readiness.expiredTitle': 'Time is up',
  'readiness.expiredBody':
    'The check submitted itself with the answers you had given. The reading it produced is on its way.',

  // The navigator: sixteen numbered buttons, each saying whether its item has an answer yet.
  'readiness.navigatorLabel': 'Items',
  'readiness.navigatorHint':
    'The arrow keys move between items. An item you have answered is filled in.',
  'readiness.itemAnswered': 'Item {position}, answered',
  'readiness.itemUnanswered': 'Item {position}, not answered',
  'readiness.progress': '{answered} of {total} answered',

  // One item.
  'readiness.itemPosition': 'Item {position} of {total}',
  'readiness.previous': 'Previous item',
  'readiness.next': 'Next item',
  'readiness.answerFailed': 'That answer was not recorded. Choose it again.',

  // The submit, and the confirmation that says what is being closed.
  'readiness.submit': 'Submit the check',
  'readiness.submitPending': 'Submitting…',
  'readiness.confirmTitle': 'Submit the Readiness Check?',
  'readiness.confirmAllAnswered':
    'Every item has an answer. Submitting closes the check and opens the scenario.',
  'readiness.confirmOneUnanswered':
    'One item has no answer. Submitting closes the check and opens the scenario; an item left blank simply leaves its idea unread.',
  'readiness.confirmUnanswered':
    '{count} items have no answer. Submitting closes the check and opens the scenario; an item left blank simply leaves its idea unread.',
  'readiness.confirmSubmit': 'Submit',
  'readiness.confirmCancel': 'Keep answering',
  'readiness.submitFailed': 'The check was not submitted. Try again.',

  // FR-018. The skip exists for a submission that failed on our side, and it is offered nowhere
  // else: the result never blocks the run, so there is nothing to be gained by refusing the check.
  'readiness.skipTitle': 'If the check will not submit',
  'readiness.skipBody':
    'That failure was ours, not yours. Try the submit once more; if it fails again, you can skip the check and go straight to the scenario. Skipping costs you nothing — the check is not scored, and every idea it asked about is simply left unread.',
  'readiness.skip': 'Skip the check',
  'readiness.skipPending': 'Skipping…',
  'readiness.skipFailed': 'The check was not skipped. Try again.',

  // ---------------------------------------------------------------------------------------------
  // The result (/runs/[runId]/readiness/result)
  //
  // The concept map, in the plain language 09 §UI-022 sets. One row per idea the check asked
  // about, and no row that adds them up.
  // ---------------------------------------------------------------------------------------------
  'readiness.resultMetaTitle': 'Readiness Check result',
  'readiness.resultTitle': 'What the check read',
  'readiness.resultDescription':
    'One line for each idea the sixteen questions asked about. There is no score here, no total and no comparison with anyone else, and nothing on this page counts toward your grade. The run ahead is what counts.',
  'readiness.resultPanel': 'The ideas this scenario turns on',
  'readiness.conceptHeld': 'You showed a working grasp of {concept}.',
  'readiness.conceptNotHeld': '{concept} looks thin.',
  'readiness.conceptUnknown': 'We could not tell about {concept}.',
  'readiness.resultIncompleteTitle': 'The check did not finish',
  'readiness.resultIncompleteBody':
    'It closed before every item was answered, so the ideas it could not read are marked as such below. Nothing follows from that: the scenario opens exactly as it would have.',
  'readiness.resultEmptyBody':
    'This check recorded no ideas to report. The scenario opens all the same.',
  'readiness.openScenario': 'Open the scenario',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(readiness)
