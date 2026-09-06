// The defense (UI-026, `/runs/[runId]/defense`): the six to nine typed questions the run record
// selects, their answers, and the artifacts panel (FR-120 to FR-126).
//
// Step 9.2 adds only the strings the *server* writes into a question, because a rendered question
// is the one place in this product where authored prose and the run's own record are joined into a
// sentence a student reads (FR-122). The screen's own strings arrive with Step 9.3.
//
// Two rules govern them.
//
//   * **The figure is the student's own number, in the author's own unit.** `{figure}` is filled
//     from the value the student typed into a named field and the unit the author declared for it
//     (D-342), so a question about eleven months says eleven months and not `11`.
//   * **Nothing here evaluates anything.** A question quotes the run and asks; it never says a
//     figure was wrong, unsourced, or worth checking, because whether it was is precisely what the
//     defense is asking the student to say for themselves.
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
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(defense)
