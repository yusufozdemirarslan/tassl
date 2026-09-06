// The rubric registry (FR-142, DATA-053, D-033).
//
// D-033 makes the rubric a versioned code artifact: `run_scores.rubric_version` records the version
// a run was scored against, "editing produces `v2.ts` and a registry bump", and "scored runs keep
// their version". That is the whole of what this file is for. A scored run resolves the rubric it
// names, not the rubric that happens to be current, so re-reading a run a year later reads it
// against the standard it was actually read against — which is what makes a band a claim anyone can
// check and an appeal possible at all (PRD §7.13, §7.17).
//
// `CURRENT_RUBRIC` is what a *new* scoring run is drafted against, and it is the only place the
// current version is named. The builder's edit to the twenty-one boundary sentences (Appendix A.0)
// adds `v2.ts`, adds a line to `RUBRICS`, and moves this one constant; nothing else changes and no
// scored run moves with it.
import { AppError } from '@/lib/errors'
import { v1, type Rubric } from './v1'

export {
  BANDS,
  BOUNDARIES,
  DIMENSIONS,
  bandRank,
  higherBand,
  lowerBand,
  v1,
  type Band,
  type Boundary,
  type Dimension,
  type DimensionRubric,
  type Rubric,
} from './v1'

/** Every rubric version this build can score a run against, or read a scored run back through. */
export const RUBRICS = { v1 } as const

export type RubricVersion = keyof typeof RUBRICS

/** The version a run scored today is drafted against (FR-142). One line to bump; see D-033. */
export const CURRENT_RUBRIC: RubricVersion = 'v1'

/**
 * The rubric a version names.
 *
 * Throws `RUBRIC_VERSION_UNKNOWN` (500, 10 §11.5) rather than falling back to the current version:
 * a run whose recorded version this build no longer carries cannot be re-read honestly, and
 * silently substituting a different standard would make the debrief and the export disagree with
 * the band the instructor confirmed. It is a 500 because it can only mean a deployment lost a file
 * a stored row still points at — nothing the reader did, and nothing they can act on.
 */
export function rubricFor(version: string): Rubric {
  const found = (RUBRICS as Record<string, Rubric | undefined>)[version]
  if (!found) {
    throw new AppError('RUBRIC_VERSION_UNKNOWN', undefined, { details: { version } })
  }
  return found
}

/** The rubric a new scoring run is drafted against. */
export const currentRubric = (): Rubric => RUBRICS[CURRENT_RUBRIC]
