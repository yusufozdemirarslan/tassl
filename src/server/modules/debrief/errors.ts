// Error codes of the `debrief` module (docs/tech/10-backend-spec-modules.md §13) and the throwers the
// service states its rules with. Every code is in the registry (`src/lib/errors.ts`), which owns the
// status and the default message; this file names the two that belong to this module and gives each
// rule one call site, so a rule and its code cannot drift.
//
// The throwers return `never` and are function declarations: TypeScript narrows after a
// `never`-returning call only for declarations, which is what lets a caller read
// `if (!row) runNotFound()` and then use `row`.
import { AppError, type ErrorCode } from '@/lib/errors'
import { t } from '@/lib/i18n/t'

/** The codes 10 §13 names for this module. */
export const DEBRIEF_ERROR_CODES = [
  'DEBRIEF_NOT_AVAILABLE',
  'DEBRIEF_ANSWERED',
] as const satisfies readonly ErrorCode[]

/** The run vanished between the permission check and the read that follows it. */
export function runNotFound(): never {
  throw new AppError('NOT_FOUND', t('run.notFound'))
}

/**
 * The debrief asked for on a run that has no bands to walk (10 §13's "state ≥ `scored`").
 *
 * `details.state` is the run's own state, the shape `TURN_NOT_OPEN`, `DEFENSE_NOT_OPEN` and
 * `RECORD_NOT_AVAILABLE` already use, so a tab left open while the run moved follows the run rather
 * than sitting on a page it has left. A held run lands here too: it is still `defense_complete`
 * (D-405) and what it is waiting for is a faculty seat, which `runs.getRunStatus` says in words.
 */
export function debriefNotAvailable(state: string): never {
  throw new AppError('DEBRIEF_NOT_AVAILABLE', undefined, { details: { state } })
}

/**
 * FR-152: one answer per run.
 *
 * The two questions are the record of what the student thought at the end of *this* run, and the
 * transition to Recorded is made on the strength of them. A second submission would be a different
 * answer written over the one the run closed on, so the row's primary key on `run_id` refuses it and
 * this is the sentence that refusal reads as.
 */
export function debriefAnswered(): never {
  throw new AppError('DEBRIEF_ANSWERED')
}
