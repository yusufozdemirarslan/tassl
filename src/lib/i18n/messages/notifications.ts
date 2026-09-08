// Notifications (UI-011)
import { scopedT } from '../scoped'

export const notifications = {
  'notifications.title': 'Notifications',
  'notifications.description': 'What Tassl has told you, newest first.',
  'notifications.listLabel': 'Notifications',
  'notifications.markAllRead': 'Mark all read',
  'notifications.markRead': 'Mark read',
  'notifications.markReadLabel': 'Mark "{title}" read',
  'notifications.markedAllRead': 'Everything is marked read.',
  'notifications.loadMore': 'Load more',
  'notifications.unread': 'Unread',
  'notifications.open': 'Open',
  'notifications.emptyTitle': 'Nothing yet',
  'notifications.emptyBody':
    'Tassl writes here when a run is scored, a package finishes generating, or an instructor confirms your bands.',
  'notifications.notFound': 'That notification no longer exists.',
  'notifications.type.generation_complete': 'Package generated',
  'notifications.type.generation_failed': 'Generation failed',
  'notifications.type.run_scored': 'Run scored',
  'notifications.type.run_held': 'Run held for review',
  'notifications.type.bands_confirmed': 'Bands confirmed',
  'notifications.type.invitation': 'Invitation',
  'notifications.type.export_ready': 'Export ready',
  'notifications.type.package_confirmed': 'Package confirmed',
  'notifications.packageConfirmedTitle': 'A scenario package is ready to assign',
  'notifications.packageConfirmedBody':
    '{title} version {version} is confirmed and frozen, so it can be set on an assignment.',

  // -------------------------------------------------------------------------------------------
  // Authoring (AI-001, FR-191, 10 §5)
  //
  // Both are delivered by e-mail as well as in the app (10 §15), so neither carries any part of the
  // package: not a brief, not a document title, not the sentence a rule failed with. The author
  // opens the generation screen, which is where all of that lives and where the seat is checked.
  // -------------------------------------------------------------------------------------------
  'notifications.generationComplete.title': 'Your scenario package has been drafted',
  'notifications.generationComplete.bodyValid':
    'All seven generation steps finished and the draft meets every scenario rule. Open it to confirm the elements one at a time.',
  'notifications.generationComplete.bodyWithFailures':
    'All seven generation steps finished. The draft still breaks {count} scenario rules, which are listed on the generation screen.',
  'notifications.generationFailed.title': 'A generation step could not be completed',
  'notifications.generationFailed.body':
    'One step did not meet the scenario rules after a second attempt, so it has stopped. The generation screen names the rules; you can run the step again or author that part by hand.',

  // -------------------------------------------------------------------------------------------
  // Scoring (FR-130, FR-140, SYS-010)
  //
  // Three notices, and no two of them say the same thing. The student's copy says what happened to
  // their run and where to look; the instructor's says a run in their section is waiting for a
  // decision. Neither carries a band, a placement, a count or a rate: a notification is delivered
  // by e-mail as well as in the app (D-015), and nothing about how a run was read travels that far.
  // A held run has no student copy at all — the run's own status already reads "under review"
  // (FR-140), and a student told their run could not be scored is a student told about an internal
  // failure they cannot act on.
  // -------------------------------------------------------------------------------------------
  'notifications.runScored.title': 'Your run has been scored',
  'notifications.runScored.body':
    'Tassl has drafted the bands for your run. Your instructor reviews and confirms them, and your debrief opens once they do.',
  'notifications.runScoredReviewer.title': 'A run is ready to review',
  'notifications.runScoredReviewer.body':
    'A run in one of your sections has draft bands waiting for your decision. Open the replay to confirm, change, or set a dimension unassessed.',
  'notifications.runHeld.title': 'A run is held for review',
  'notifications.runHeld.body':
    'Tassl could not draft the bands for a run in one of your sections, so nothing has been placed. Band it by hand from the replay, or void the run.',

  // -------------------------------------------------------------------------------------------
  // Review (FR-181, FR-184, SYS-010)
  //
  // The student is told their instructor has finished, and where their debrief is. No band, no
  // count and no number: the same rule as the scoring notices above, and for the same reason — a
  // notification is delivered by e-mail as well as in the app (D-015).
  //
  // `export_ready` goes to the section's instructors and TAs, never to the student: the course
  // export is the reviewer's document for the gradebook of record (12 §8.1), and the student's own
  // copy is the Judgment Record they download from their run.
  // -------------------------------------------------------------------------------------------
  'notifications.bandsConfirmed.title': 'Your bands are confirmed',
  'notifications.bandsConfirmed.body':
    'Your instructor has finished reviewing your run. Your debrief now shows the confirmed bands and any note they left.',
  'notifications.exportReady.title': 'A course export is ready',
  'notifications.exportReady.body':
    'A run in one of your sections has a new course export. Open the assignment’s export history to download it and enter the result in your gradebook.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(notifications)
