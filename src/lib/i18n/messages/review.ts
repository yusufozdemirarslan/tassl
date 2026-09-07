// The faculty replay and the decisions taken on it (UI-033 to UI-035, FR-180 to FR-186, FR-003,
// FR-008). Phase 11.1 opens the namespace with the sentences the review service answers with; the
// screens of steps 11.3 and 11.4 add their own.
//
// Two rules govern every string here. None of them describes a student — a refusal is about the
// seat and the run, never about the person who took it — and none of them says "cheat",
// "misconduct" or anything of that shape: nothing Tassl observes is treated as misconduct (PRD §7
// standing rules), and a sentence a reviewer reads while deciding a band is exactly the wrong place
// to imply otherwise.
import { scopedT } from '../scoped'

export const review = {
  // 08 §4's TA row, in the two places it bites. The first is per dimension and travels as
  // `BAND_LOCKED_BY_INSTRUCTOR`; the second is the whole screen once the run is confirmed, and is a
  // plain FORBIDDEN because there is no single band to name.
  'review.taCannotRedecide':
    'The bands on this run are confirmed. Changing one after that is the instructor’s decision.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(review)
