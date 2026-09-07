// Error codes of the `review` module (docs/tech/10-backend-spec-modules.md §12) and the throwers the
// service states its rules with. Every code is in the registry (`src/lib/errors.ts`), which owns the
// status and the default message; this file names the five that belong to this module and gives each
// rule one call site, so a rule and its code cannot drift.
//
// The throwers return `never` and are function declarations: TypeScript narrows after a
// `never`-returning call only for declarations, which is what lets a caller read
// `if (!row) runNotFound()` and then use `row`.
import { AppError, type ErrorCode } from '@/lib/errors'
import { t } from '@/lib/i18n/t'

/** The codes 10 §12 names for this module. */
export const REVIEW_ERROR_CODES = [
  'BAND_DECISION_INVALID',
  'RUN_NOT_SCORED',
  'BAND_LOCKED_BY_INSTRUCTOR',
  'RUN_NOT_CONFIRMED',
  'NEUTRALIZATION_EXISTS',
] as const satisfies readonly ErrorCode[]

/** The run vanished between the permission check and the read that follows it. */
export function runNotFound(): never {
  throw new AppError('NOT_FOUND', t('run.notFound'))
}

/**
 * A band decision whose shape does not settle a band (FR-181).
 *
 * `overridden` without one is the whole of it: confirming takes the draft and `unassessed` takes
 * nothing, so the only way to leave a dimension undecided while claiming to have decided it is to
 * override with no band. `details.reason` says which rule, because the control that sent it is a
 * radio group and a form can say which control to go back to.
 */
export function bandDecisionInvalid(reason: 'band_required' | 'band_not_allowed'): never {
  throw new AppError('BAND_DECISION_INVALID', undefined, { details: { reason } })
}

/**
 * A decision, a confirmation or a neutralization asked for on a run that has no bands to decide.
 *
 * `details.state` is the run's own state, in the shape `TURN_NOT_OPEN` and `DEFENSE_NOT_OPEN`
 * already use, so a replay tab left open while the run moved follows the run rather than sitting on
 * a screen it has left. A held run is one of these: it is still `defense_complete` (D-405) and it
 * is banded by hand rather than decided, which is `bandHeldRunManually`'s job and not this one's.
 */
export function runNotScored(state: string): never {
  throw new AppError('RUN_NOT_SCORED', undefined, { details: { state } })
}

/**
 * 08 §4's TA row: "not a band the instructor already decided".
 *
 * FORBIDDEN rather than NOT_FOUND, and 403 rather than 409, because everything about this refusal is
 * about the seat: the TA may read the band, may decide the other six, and may see exactly what the
 * instructor put here. What they may not do is change it — FR-182 makes an instructor's decision
 * final for their students, and a TA overriding one would make it final until somebody else looked.
 */
export function bandLockedByInstructor(dimension: string): never {
  throw new AppError('BAND_LOCKED_BY_INSTRUCTOR', undefined, { details: { dimension } })
}

/**
 * The export history of a run whose bands nobody has confirmed (07 §8).
 *
 * There is no file to list, and saying so is more useful than an empty array: nothing was written
 * because nothing has been decided, and `details.state` names the step the run is waiting on.
 */
export function runNotConfirmed(state: string): never {
  throw new AppError('RUN_NOT_CONFIRMED', undefined, { details: { state } })
}

/**
 * FR-003: one correction per claim per run.
 *
 * A second neutralization of the same claim would recompute a matrix the first one already took the
 * row out of, and the floor of FR-005 would then be applied to a band the correction itself set —
 * which is not a correction of Tassl's error but an edit of the result. `details.neutralizationId`
 * names the row that already exists, so the replay can show what was entered and when.
 */
export function neutralizationExists(neutralizationId: string): never {
  throw new AppError('NEUTRALIZATION_EXISTS', undefined, { details: { neutralizationId } })
}

/**
 * Manual banding asked for on a run nothing is holding (FR-140, 10 §12).
 *
 * `RUN_NOT_SCORABLE` is the code 07 §8 gives this endpoint, and it is the `scoring` module's — one
 * meaning per code, and this is the same meaning: a run the pipeline cannot draft bands for. What
 * makes a run hand-bandable is `scoring_status = 'held'` and nothing else, because a hold moves
 * nothing (D-405) and the state alone would admit every run that has finished its defense.
 */
export function runNotHeld(state: string, scoringStatus: string): never {
  throw new AppError('RUN_NOT_SCORABLE', undefined, {
    details: { state, scoringStatus, reason: 'not_held' },
  })
}

/** A claim id that is not one of the run's package version. */
export function claimNotFound(): never {
  throw new AppError('NOT_FOUND', t('run.claimNotFound'))
}
