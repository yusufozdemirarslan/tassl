// Error codes of the `runs` module (docs/tech/10-backend-spec-modules.md §6) and the throwers the
// service, the state machine and the clock state their rules with. Every code is in the registry
// (`src/lib/errors.ts`), which owns the status and the default message; this file names the ones
// that belong to this module and gives each rule one call site, so a rule and its code cannot drift.
//
// 10 §6 lists thirteen codes for this module. Four are here — the lifecycle's and the clock's — and
// the rest arrive with the steps that throw them (the frame, the brief, the Turn, the test
// controls), so no code sits in the registry without the rule that raises it.
//
// The throwers return `never` and are function declarations: TypeScript narrows after a
// `never`-returning call only for declarations, which is what lets a caller read
// `if (!run) runNotFound()` and then use `run`.
import { AppError, type ErrorCode } from '@/lib/errors'
import { t } from '@/lib/i18n/t'

/** The codes of 10 §6 this phase raises. */
export const RUNS_ERROR_CODES = [
  'RUN_ACTIVE_EXISTS',
  'ILLEGAL_TRANSITION',
  'CLOCK_EXPIRED',
  'TURN_WINDOW_EXPIRED',
] as const satisfies readonly ErrorCode[]

/**
 * A run the actor neither owns nor reviews. NOT_FOUND rather than FORBIDDEN even for a classmate
 * who can see the section: 08 §4 gives a student no read of another student's run at all, so
 * saying the id resolves is already more than they may know (07 §1 "Tenancy").
 */
export function runNotFound(): never {
  throw new AppError('NOT_FOUND', t('run.notFound'))
}

/** An assignment outside the actor's institutions, or one they hold no membership on. */
export function assignmentNotFound(): never {
  throw new AppError('NOT_FOUND', t('run.assignmentNotFound'))
}

/** Someone who can see the assignment but does not take it: an instructor, a TA (08 §4). */
export function notSectionStudent(): never {
  throw new AppError('FORBIDDEN', t('run.notSectionStudent'))
}

/** The assignment's `opens_at` is in the future, so there is nothing to start yet (10 §6). */
export function assignmentNotOpen(): never {
  throw new AppError('FORBIDDEN', t('run.notOpenYet'))
}

/**
 * The student already has a run on this assignment that is not voided (D-041). A second attempt
 * exists only through a re-offer, which creates the run itself rather than coming through here.
 */
export function runActiveExists(): never {
  throw new AppError('RUN_ACTIVE_EXISTS')
}

/**
 * The pair is not in the transition table of 10 §9. It carries the states it refused so the log
 * says which move was attempted; the message stays the registry's, because the reader's answer is
 * always the same — the run has already moved on, and the screen should re-read it.
 */
export function illegalTransition(from: string, to: string): never {
  throw new AppError('ILLEGAL_TRANSITION', undefined, { details: { from, to } })
}

/** The working clock has no time left, so an action that would charge it cannot start (FR-072). */
export function clockExpired(): never {
  throw new AppError('CLOCK_EXPIRED')
}

/** The Turn window has no time left, so an action inside it cannot start (D-132). */
export function turnWindowExpired(): never {
  throw new AppError('TURN_WINDOW_EXPIRED')
}

/**
 * A charge was asked of a run with no clock running — before the frame is locked, or after the
 * decision is. It is a defect in the caller, not a request a reader can fix, so it is a 500.
 */
export function noClockRunning(state: string): never {
  throw new AppError('INTERNAL_ERROR', 'No clock is running on this run.', { details: { state } })
}
