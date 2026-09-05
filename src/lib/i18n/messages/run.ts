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
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(run)
