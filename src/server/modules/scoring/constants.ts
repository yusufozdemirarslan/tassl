// The four numbers the band rules turn on (10-backend-spec-modules.md §11.3; PRD Appendix A.4, A.8;
// FR-106, FR-134).
//
// **This file exists to keep one distinction visible, and the distinction is carried in the type.**
// A number in scoring is one of exactly two things, and confusing them is how an unvalidated cut
// score becomes a fact about a student:
//
//   * A `Hypothesis` **decides a band**. It is a cut point on an uncalibrated scale, and PRD
//     Appendix A.8 is explicit about it: "No numeric threshold in this appendix other than the 15
//     percent False Challenge Rate reference band (itself a hypothesis) comes from the PRD. Any
//     number the builder adds while editing should be labeled a hypothesis." Moving one moves a
//     band, and a band moves the points a course computes from it (PRD §7.19), so every one of
//     them is a draft the pilot calibrates — never a validated cut score (A.0).
//   * An `ArchitectConstant` **decides no band**. It fixes an observation, a shape or a threshold
//     the specification already settled; changing it changes what the debrief reports, never what
//     the run is scored. It needs no calibration because nothing about a student turns on it.
//
// The two are branded number types rather than a comment, so a call site reads
// `fcr < FCR_PROFESSIONAL` exactly as it would with a bare number while the declaration says which
// kind of number it is, and a future constant cannot be added without choosing. Arithmetic and
// comparison work unchanged: the brand is erased at run time and the value is a `number`.
//
// Nothing else in `scoring` writes any of these as a literal — the same rule
// `src/server/modules/runs/limits.ts` keeps for the clock.

// ---------------------------------------------------------------------------------------------
// The two kinds
// ---------------------------------------------------------------------------------------------

declare const HYPOTHESIS: unique symbol
declare const ARCHITECT_CONSTANT: unique symbol

/** A number that decides a band. Uncalibrated, drafted, and the pilot's to move (PRD A.0, A.8). */
export type Hypothesis = number & { readonly [HYPOTHESIS]: true }

/** A number that decides no band. Fixed by a specification; nothing about a student turns on it. */
export type ArchitectConstant = number & { readonly [ARCHITECT_CONSTANT]: true }

const hypothesis = (value: number): Hypothesis => value as Hypothesis
const architectConstant = (value: number): ArchitectConstant => value as ArchitectConstant

// ---------------------------------------------------------------------------------------------
// Hypotheses: the three False Challenge Rate cut points
// ---------------------------------------------------------------------------------------------

/**
 * The professional reference band (PRD §10, Appendix A.4).
 *
 * A.4's Professional descriptor gives the number and labels it in the same breath: "False Challenge
 * Rate below the professional reference band of 15 percent, **a hypothesis to calibrate**". It is
 * the only threshold in Appendix A that comes from the PRD at all (A.8), and it is still a draft.
 */
export const FCR_PROFESSIONAL: Hypothesis = hypothesis(0.15)

/**
 * Where "false challenges are few" (A.4 Proficient) stops being few.
 *
 * A.4 says "few" and 10 §11.3 makes it a number: Proficient wants the rate under 0.30 with the
 * false challenges that remain falling on claims a challenge was defensible on. The PRD fixes no
 * such number, so by A.8 it is a hypothesis the builder added and the pilot calibrates.
 */
export const FCR_FEW: Hypothesis = hypothesis(0.3)

/**
 * Where a rate is "far above the professional reference band" (A.4 Novice).
 *
 * A.4 places Novice at a rate "far above the professional reference band, as in Marco's 73
 * percent", and 10 §11.3 makes "far above" 0.5 — more than half of the run's consequential claims
 * challenged wrongly. Marco's 0.727 clears it by a distance, which is the placement the number has
 * to reproduce (FR-139). The PRD fixes no such number, so A.8 makes it a hypothesis too.
 */
export const FCR_NOVICE: Hypothesis = hypothesis(0.5)

// ---------------------------------------------------------------------------------------------
// Architect constants: numbers that report rather than score
// ---------------------------------------------------------------------------------------------

/**
 * Four minutes of working time, under which a Decision Lock is a speed outlier (FR-106, PRD §7.10).
 *
 * It is an architect constant here and a pilot parameter in `runs/limits.ts`, and both are true of
 * it: the clock may retune it, and scoring never scores on it. A.5's fixed modifiers say what it is
 * — "A 4-minute lock is a speed outlier, **a signal rather than a penalty**" — so no band rule in
 * `bands.ts` reads it. It travels with the facts so the debrief and the faculty replay can say the
 * lock was quick, which is an observation an instructor reads and not a finding about the student.
 *
 * The value restates `PILOT_PARAMETERS.SPEED_OUTLIER_MS` in `src/server/modules/runs/limits.ts`
 * rather than importing it, because a module-internal file may not reach another module (CLAUDE.md;
 * a module is reachable only through its `index.ts`, which an internal file may not import either).
 * `tests/unit/scoring/facts.test.ts` asserts the two are equal, so the restatement cannot drift.
 */
export const SPEED_OUTLIER_MS: ArchitectConstant = architectConstant(240_000)

/**
 * FR-087's one third: above this share of consequential claims losing their stance record the run
 * cannot be scored at all, and at or below it the run stands with Verification and Calibration
 * unassessed.
 *
 * An architect constant because the PRD fixes the fraction itself ("more than a third", §7.8 and
 * the Section 7 standing rules) and because it moves no band: on either side of it the answer is
 * *no band*, unassessed or unscoreable, never a lower one. `facts.ts` compares in integers rather
 * than against this float, so a run that loses exactly a third is never rounded onto the wrong side
 * of it; the constant is the documented value the comparison implements.
 */
export const STANCE_RECORD_LOSS_LIMIT: ArchitectConstant = architectConstant(1 / 3)
