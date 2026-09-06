// Error codes of the `scoring` module (docs/tech/10-backend-spec-modules.md §11.5) and the throwers
// the service states its rules with. Every code is in the registry (`src/lib/errors.ts`), which owns
// the status and the default message; this file names the two that belong to this module and gives
// each rule one call site, so a rule and its code cannot drift.
//
// The throwers return `never` and are function declarations: TypeScript narrows after a
// `never`-returning call only for declarations, which is what lets a caller read
// `if (!run) runNotFound()` and then use `run`.
import { AppError, type ErrorCode } from '@/lib/errors'
import { t } from '@/lib/i18n/t'

/** The codes of 10 §11.5. */
export const SCORING_ERROR_CODES = [
  'RUN_NOT_SCORABLE',
  'RUBRIC_VERSION_UNKNOWN',
] as const satisfies readonly ErrorCode[]

/** The run vanished between the job's payload and the row the pipeline reads. */
export function runNotFound(): never {
  throw new AppError('NOT_FOUND', t('run.notFound'))
}

/**
 * A run the pipeline cannot draft bands for.
 *
 * Two shapes reach it, and both carry the state so a caller can act on the answer rather than guess:
 * a run that is not at `defense_complete` (nothing has finished happening to it yet, or it has
 * already been scored and the job is a repeat, which the service handles before it gets here), and
 * a run whose stance records are lost past FR-087's one third — for which the job holds the run and
 * a faculty seat voids it, rather than a band being estimated from a record that is not there.
 */
export function runNotScorable(state: string, reason: string): never {
  throw new AppError('RUN_NOT_SCORABLE', undefined, { details: { state, reason } })
}
