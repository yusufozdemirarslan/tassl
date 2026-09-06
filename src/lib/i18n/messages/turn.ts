// The Turn window (UI-025, `/runs/[runId]/turn`): the message from the world, the claims it raises,
// the reopened room, and the one response a student files against it (FR-110 to FR-115).
//
// It is its own namespace rather than more of `decision` for the reason `decision` is not more of
// `workspace` (D-221): the Turn screen's client components are the response form and the claim
// cards, and a Client Component ships the namespaces it reads and no others. `decision` is the
// vocabulary of a screen that has closed by the time this one opens.
//
// Three rules govern every sentence here.
//
//   * **Nothing says what the Turn deserves.** `scenario_turns.warrants_change` and
//     `proportionate_response` are the instrument this response is measured against and no student
//     payload carries either (D-336, 12 §8.1). So the three options are defined and never ranked:
//     hold, revise and reverse get one plain sentence each saying what the word means, and not one
//     word about which the new information calls for. The same rule that keeps the stance control
//     from hinting keeps this one from it (FR-073, FR-080).
//   * **The window is time being spent, and the screen says so once.** The countdown is in the
//     sticky band above (D-346); the prose here says what happens when it ends, which is that the
//     decision already filed stands (FR-113). It does not nag, and it does not repeat the number.
//   * **Nothing here evaluates the decision that was filed.** The frozen record is read back in the
//     student's own words with no mark on it, exactly as `/locked` reads it back.
import { scopedT } from '../scoped'

export const turn = {
  // ---------------------------------------------------------------------------------------------
  // The screen
  // ---------------------------------------------------------------------------------------------
  'turn.metaTitle': 'The Turn',
  'turn.title': 'The Turn',
  'turn.description':
    'Something has arrived from the world since you filed. The run is open again for the length of the window: work with it, then say what you are doing about the decision.',

  /**
   * Announced on arrival, in the screen's one polite region.
   *
   * UI-024's countdown says the Turn is due and this says it has landed, because the two are
   * different facts and they happen on different screens: `/locked` redirects the moment the state
   * changes, so the arrival can only be spoken here, after the navigation (D-321, D-347).
   */
  'turn.arrived': 'The Turn has arrived and the window is open.',

  // ---------------------------------------------------------------------------------------------
  // The message, in the voice of the world (FR-110)
  //
  // The voice is a chip because it is a fact about the form the news took, not a judgement of it:
  // a corrected number and a competitor move are read differently, and the label is what says
  // which one a student is looking at.
  // ---------------------------------------------------------------------------------------------
  'turn.messageTitle': 'What arrived',
  'turn.messageArrivedAt': 'Arrived {when}',
  'turn.voiceStakeholderMessage': 'Stakeholder message',
  'turn.voiceCorrectedNumber': 'Corrected number',
  'turn.voiceSupplierNotice': 'Supplier notice',
  'turn.voiceCompetitorMove': 'Competitor move',
  'turn.voiceRetractedSource': 'Retracted source',
  'turn.voiceRegulatoryNote': 'Regulatory note',

  // ---------------------------------------------------------------------------------------------
  // The claims the window raised (FR-111, FR-114)
  //
  // The cards are the workspace's own `ClaimCard`s, so their strings stay in `workspace`; what this
  // namespace carries is why they are on this screen and what filing will ask for.
  // ---------------------------------------------------------------------------------------------
  'turn.claimsTitle': 'What this puts in front of you',
  'turn.claimsDescription':
    'The window raised these claims. Filing a response asks for a position on each of them, and taking one costs nothing.',
  'turn.claimsNoneTitle': 'The window raised no claims',
  'turn.claimsNoneBody':
    'Nothing on this Turn needs a position of its own. Read it, use the room if you want it, and file your response.',

  // ---------------------------------------------------------------------------------------------
  // The room, reopened for the window (FR-111)
  // ---------------------------------------------------------------------------------------------
  'turn.referenceRegion': 'What you can work with',
  'turn.reopenedNote':
    'The assistant and the Evidence Room are open again until the window closes. Checks and escalations cost window time exactly as they cost clock time before the lock.',

  // ---------------------------------------------------------------------------------------------
  // The frozen record (UI-025's "frozen pre-Turn record beside")
  // ---------------------------------------------------------------------------------------------
  'turn.frozenTitle': 'What you filed before this arrived',
  'turn.frozenDescription':
    'The frame you locked and the decision you filed, exactly as they stand. Neither changes from here; the response below is what you add to them.',

  // ---------------------------------------------------------------------------------------------
  // The response (FR-112)
  //
  // Three categories with one defining sentence each, a justification, and the confidence the
  // student now holds. The descriptions define; they do not recommend.
  // ---------------------------------------------------------------------------------------------
  'turn.responseTitle': 'Your response',
  'turn.responseDescription':
    'One of the three, why, and where your confidence now stands. It is filed once and is not edited again, and the defense follows it.',
  /**
   * Shown only when a draft was actually put back, and it claims nothing more than what is true
   * (D-360).
   *
   * A hundred and fifty words written under a running window are not something a reload should be
   * allowed to take. What closes that is a copy kept in the browser tab — not a save, not a record,
   * and nothing the server ever sees — so the sentence says where the copy is, that it is not the
   * response, and when it goes. A line reading "Draft saved" would promise a durability this does
   * not have, on the one screen in the run where a false promise costs the most.
   */
  'turn.draftRestored':
    'What you had entered here was put back from this browser tab. It is kept there only, it is not filed, and it goes when the tab closes.',
  'turn.responseLegend': 'What you are doing about the decision',
  'turn.responseHold': 'Hold',
  'turn.responseHoldDescription': 'The decision you filed stands as it is.',
  'turn.responseRevise': 'Revise',
  'turn.responseReviseDescription':
    'The decision holds in direction, and something inside it changes.',
  'turn.responseReverse': 'Reverse',
  'turn.responseReverseDescription':
    'The decision you filed no longer holds, and you are taking a different one.',
  'turn.justificationLabel': 'Why',
  'turn.justificationHint': 'At most {limit} words.',
  'turn.justificationWordCount': '{count} of {limit} words',
  'turn.confidenceLabel': 'Confidence as a number',
  'turn.confidenceHint': 'Where you stand now, 0 to 100.',
  'turn.confidenceUnit': 'of 100',
  'turn.submit': 'File the response',
  'turn.submitting': 'Filing…',
  /**
   * FR-113, beside the control it is about (D-354).
   *
   * The window's last minute is a red wash in the band, which on the working clock meant "your
   * decision is about to be filed for you, possibly mid-sentence". Here it means something benign,
   * and the screen has to say so: the decision the student already filed stands, and the run goes
   * on. Without this line the alarm is the only thing speaking, and a student reads the second red
   * clock of their run as the first one.
   */
  'turn.windowEndsNote':
    'If the window closes before you file, the decision you already filed stands and the defense opens next.',

  // Refusals. Each names the field or the claim it is about and nothing else (FR-073, D-306).
  'turn.responseRequired': 'Choose one of the three.',
  'turn.justificationRequired': 'Say why. This is part of the response.',
  'turn.justificationTooLong': 'This is over the limit. Cut it back to {limit} words to file it.',
  'turn.confidenceInvalid': 'A whole number from 0 to 100.',
  'turn.claimsUnstanced': 'A claim the Turn put in front of you has no stance yet.',
  'turn.claimsUnstancedOne':
    'A claim the Turn put in front of you has no stance yet: “{text}” Take one on it and file again.',
  'turn.claimsUnstancedMany':
    '{count} claims the Turn put in front of you have no stance yet. Take one on each and file again.',
  'turn.goToClaim': 'Go to the claim',
  'turn.failed': 'The response was not filed. Try it again.',
  /** The label on the request id a refusal carries, so a student can quote it (D-322). */
  'turn.errorReference': 'Reference',
  'turn.filed': 'Your response is filed. The defense opens next.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(turn)
