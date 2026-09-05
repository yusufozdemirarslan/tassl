// A student's run: the lifecycle, the clock, the policy display and the screens that read them
// (UI-020 to UI-027, FR-201, FR-231, FR-233, FR-235). Phase 6 opens the namespace with the
// sentences the runs service answers with; the screens of step 6.5 add their own.
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
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(run)
