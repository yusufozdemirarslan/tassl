// Error codes of the `runs` module (docs/tech/10-backend-spec-modules.md §6) and the throwers the
// service, the state machine and the clock state their rules with. Every code is in the registry
// (`src/lib/errors.ts`), which owns the status and the default message; this file names the ones
// that belong to this module and gives each rule one call site, so a rule and its code cannot drift.
//
// 10 §6 lists thirteen codes for this module. Six are here — the lifecycle's, the clock's, and the
// frame's — and the rest arrive with the steps that throw them (the brief, the Turn, the test
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
  'READINESS_SKIP_NOT_ALLOWED',
  'FRAME_INVALID',
  'RUN_LOCKED',
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

// ---------------------------------------------------------------------------------------------
// The Readiness Check (FR-010 to FR-018)
//
// Not one of these sentences mentions an answer, a key, or a score. A refusal is a place where a
// system is tempted to explain itself, and there is nothing about correctness a student may be told
// before their run is scored (FR-012, 12 §8).
// ---------------------------------------------------------------------------------------------

/**
 * The run is not in `readiness`: it has not reached the check, or the check has already closed. It
 * is the same code a second submit would meet from the transition table (10 §9), raised before the
 * table so the sentence names the check rather than "that step"; `details` says which state the run
 * was actually in, which is what the screen needs to send the student to the right place.
 */
export function readinessNotOpen(state: string): never {
  throw new AppError('ILLEGAL_TRANSITION', t('run.readinessNotOpen'), { details: { state } })
}

/**
 * An answer arrived after the check closed. 07 §7 names `CLOCK_EXPIRED` as this row's refusal, and
 * the eight-minute timer is how a check closes without the student closing it: a submit or a skip
 * takes them off the screen, an expiry does not. The registry's own message is about the working
 * clock, so this one says which clock ran out.
 */
export function readinessClosed(): never {
  throw new AppError('CLOCK_EXPIRED', t('run.readinessClosed'))
}

/** An item id that is not on this run's check — another package's item, or a stale screen. */
export function readinessItemNotFound(): never {
  throw new AppError('NOT_FOUND', t('run.readinessItemNotFound'))
}

/** An answer key the item does not offer. The client sends one of the four it was given. */
export function readinessOptionNotOffered(answerKey: string): never {
  throw new AppError('VALIDATION_ERROR', t('run.readinessOptionNotOffered'), {
    details: { field: 'answerKey', answerKey },
  })
}

/**
 * The run's package version has no confirmed set of items (FR-011): an unconfirmed item is never
 * drawn. An assignment already refuses an unconfirmed version (`PACKAGE_NOT_CONFIRMED`, 10 §3), so
 * this is the second reading of the same rule at the moment the items are drawn.
 */
export function readinessSetUnavailable(): never {
  throw new AppError('PACKAGE_NOT_CONFIRMED', t('run.readinessSetUnavailable'))
}

/**
 * A skip before a submission has failed (FR-018, 10 §6). The check is eight minutes of warm-up that
 * never blocks entry (FR-013), so the skip exists for the student whose submit did not go through,
 * and for nobody else.
 */
export function readinessSkipNotAllowed(): never {
  throw new AppError('READINESS_SKIP_NOT_ALLOWED')
}

// ---------------------------------------------------------------------------------------------
// The Evidence Room and the frame (FR-020 to FR-024, FR-040 to FR-044)
// ---------------------------------------------------------------------------------------------

/**
 * The workspace was asked for on a run that is not in it: before the Readiness Check closes, or
 * after the room has been left behind. `details.state` is what the screen needs to follow the run's
 * own `links.next` from there, which is the same shape `readinessNotOpen` answers with.
 */
export function workspaceNotOpen(state: string): never {
  throw new AppError('ILLEGAL_TRANSITION', t('run.workspaceNotOpen'), { details: { state } })
}

/**
 * A document was asked for before the room opened (10 §6: the open is allowed in `framing`,
 * `working` and `turn_open`). The Readiness Check has to close first — the brief and the room open
 * together when it does (FR-020) — and a paused run has no clock running to read against, so it
 * waits for the resume.
 */
export function roomNotOpen(state: string): never {
  throw new AppError('ILLEGAL_TRANSITION', t('run.roomNotOpen'), { details: { state } })
}

/**
 * The decision is locked, so the room is closed (07 §7's `RUN_LOCKED` on the open row). It is a
 * different refusal from `roomNotOpen` and deserves its own sentence: nothing about this run will
 * open the room again, and the student's next step is the Turn.
 */
export function runLocked(): never {
  throw new AppError('RUN_LOCKED')
}

/** A document id that is not in this run's Evidence Room — another package's, or a stale screen. */
export function documentNotInRoom(): never {
  throw new AppError('NOT_FOUND', t('run.documentNotInRoom'))
}

/** An open id that does not belong to this run. A close of one already closed is not this: it is a no-op. */
export function documentOpenNotFound(): never {
  throw new AppError('NOT_FOUND', t('run.documentOpenNotFound'))
}

/**
 * The frame does not meet FR-040 (10 §6: `FRAME_INVALID` (400) with `details.field`).
 *
 * The field is the path the form binds to — `decision`, `assumptions.1`, `position`, `confidence` —
 * so the refusal lands on the control that caused it. `reason` says which rule it broke, for a
 * client that has no form: `required` (empty once markup is stripped, or an assumption missing),
 * `word_limit` (over 50, 25 or 100 words), `invalid` (anything else the shape allows and the rule
 * does not, such as a confidence outside 0 to 100).
 *
 * The message says one thing and stays out of the form's way: the word limits are in
 * `LockFrameSchema`, which the form validates against as it types, so a sentence here restating
 * them would be a second copy of the rule (CLAUDE.md).
 */
export type FrameInvalidReason = 'required' | 'word_limit' | 'invalid'

export function frameInvalid(field: string, reason: FrameInvalidReason): never {
  throw new AppError('FRAME_INVALID', t('run.frameInvalid'), { details: { field, reason } })
}

/**
 * A test-only route reached outside `APP_ENV=test` (D-109). NOT_FOUND, with the registry's own
 * "Not found." — the answer an unmounted path gives, because outside a test process that is what
 * this path is.
 */
export function testRouteUnavailable(): never {
  throw new AppError('NOT_FOUND')
}
