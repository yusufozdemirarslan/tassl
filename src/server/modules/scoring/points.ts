// Step six of the scoring pipeline — points (10-backend-spec-modules.md §11.4; PRD §7.19; FR-202,
// FR-203, FR-131, D-091).
//
// **Points are the course's arithmetic, not Tassl's judgment.** PRD §7.13 says it twice over: Tassl
// "produces no composite judgment score, rank, percentile, or validated trait claim about the
// student"; a course may convert *confirmed* bands into gradebook points through the mapping its
// instructor set, and Tassl "performs the arithmetic the instructor's mapping specifies and exports
// the result as the course's arithmetic". So this file computes a mean, and nothing here is named
// score, rank or percentile — a rule `tests/unit/scoring/field-names.test.ts` enforces by walking
// the schema, the event payloads and the export keys rather than by anyone remembering it (FR-131).
//
// Four rules, each of which decides a real case:
//
//   1. **The mean is over the dimensions that were assessed.** An unassessed dimension is excluded,
//      "never estimated and never counted as zero" (PRD §7.13 standing rules, FR-202). Counting it
//      as zero would make an unplottable graph or a lost stance record cost the student a grade,
//      which is the exact failure FR-004 exists to prevent.
//   2. **No dimension assessed gives `null`, not zero.** A run with nothing to average has no
//      points, and `run_scores.points_*` is nullable for that reason.
//   3. **Three decimals** (D-091), which is what `numeric(6,3)` stores and what the debrief and the
//      export print. Rounding once, here, is what keeps the number on the screen, the number in the
//      export and the number in the gradebook the same number.
//   4. **Draft and confirmed are different fields and never mix.** `points_draft` comes from the
//      draft bands and is labelled draft wherever it is shown; it never reaches an export, because
//      "no points are computed from a draft band, and no draft band reaches the gradebook of
//      record" (PRD §7.13, FR-203, D-091). `points_confirmed` exists only once every dimension has
//      a decision.
import { BANDS, type Band, type Dimension } from './rubric'

/** `courses.mapping`: what each band is worth in one course's gradebook (FR-202). */
export type BandMapping = Readonly<Record<Band, number>>

/** PRD §7.19's default. A course may set its own; nothing else in the codebase writes these four. */
export const DEFAULT_MAPPING: BandMapping = {
  novice: 1,
  developing: 2,
  proficient: 3,
  professional: 4,
}

/** One dimension's value for the arithmetic: a band, or unassessed however it got there. */
export type PointsInput = Band | 'unassessed' | null

/** D-091: three decimals, everywhere, once. */
export const round3 = (value: number): number => Math.round(value * 1000) / 1000

/**
 * The arithmetic mean of the assessed dimensions under one mapping, or `null` when none is assessed.
 *
 * Takes a partial record deliberately: a dimension the caller has no value for is the same thing as
 * an unassessed one — absent from the mean rather than zero in it — so a caller cannot accidentally
 * turn a missing band into a grade by forgetting a key.
 */
export function computePoints(
  bands: Partial<Readonly<Record<Dimension, PointsInput>>>,
  mapping: BandMapping,
): number | null {
  const assessed = Object.values(bands).filter(
    (value): value is Band => value !== null && value !== undefined && isBand(value),
  )
  if (assessed.length === 0) return null
  const total = assessed.reduce((sum, band) => sum + mapping[band], 0)
  return round3(total / assessed.length)
}

const isBand = (value: string): value is Band => (BANDS as readonly string[]).includes(value)

/**
 * FR-005's floor on the points: after any correction the run keeps the higher of its pre- and
 * post-correction points, and both are recorded (PRD §7.19 standing rules).
 *
 * `null` is not a low number, it is the absence of one, so it never beats a value and never loses
 * to one either: the higher of `null` and 2.5 is 2.5, and the higher of `null` and `null` is
 * `null`. That is what makes neutralizing the last assessed dimension of a run leave the points it
 * already had rather than erasing them.
 */
export function higherPoints(before: number | null, after: number | null): number | null {
  if (before === null) return after
  if (after === null) return before
  return Math.max(before, after)
}
