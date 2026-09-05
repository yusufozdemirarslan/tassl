// Error codes of the `assistant` module (docs/tech/10-backend-spec-modules.md §7) and the throwers
// the service states its rules with. Every code is in the registry (`src/lib/errors.ts`), which
// owns the status and the default message; this file names the four that belong to this module and
// gives each rule one call site, so a rule and its code cannot drift.
//
// The throwers return `never` and are function declarations: TypeScript narrows after a
// `never`-returning call only for declarations, which is what lets a caller read
// `if (!row) delegationNotFound()` and then use `row`.
import { AppError, type ErrorCode } from '@/lib/errors'
import { t } from '@/lib/i18n/t'

/** The codes of 10 §7. */
export const ASSISTANT_ERROR_CODES = [
  'ASSISTANT_LOCKED',
  'ASSISTANT_REQUEST_TOO_LONG',
  'ASSISTANT_UNAVAILABLE',
  'DELEGATION_NOT_FOUND',
] as const satisfies readonly ErrorCode[]

/**
 * The assistant is not in the room: FR-050 gives it from frame lock to Decision Lock and again in
 * the Turn window, and nowhere else.
 *
 * Three different things are true in the three states this can refuse, so three sentences. Before
 * the frame the student's next act is to lock it; while the run is paused a component failure is
 * being waited out and the answer is the Resume control; after the Decision Lock nothing reopens
 * the room. `details.state` carries the state either way, which is what sends a stale screen to the
 * run's own `links.next`.
 */
export function assistantLocked(state: string): never {
  const message =
    state === 'paused'
      ? t('workspace.assistantPaused')
      : state === 'framing' || state === 'readiness' || state === 'assigned'
        ? t('workspace.assistantBeforeFrame')
        : undefined
  throw new AppError('ASSISTANT_LOCKED', message, { details: { state } })
}

/**
 * The request is longer than 11 §3's 2,000 characters, measured after markup is stripped — the
 * length the model would have read (10 §5).
 *
 * A refusal rather than a truncation: the student wrote it, and answering three quarters of a
 * question without saying so would be worse than saying the question is too long.
 */
export function requestTooLong(limit: number, length: number): never {
  throw new AppError('ASSISTANT_REQUEST_TOO_LONG', undefined, { details: { limit, length } })
}

/**
 * The provider did not answer (FR-001). By the time this is thrown the delegation is marked failed,
 * the run is paused and the clock is stopped, so the reader's next act is the Resume control — and
 * the resume credits the delegation nothing, because a delegation charges no clock (10 §10).
 *
 * 503 rather than 500: nothing about the request was wrong, and the state the run is now in is one
 * the student can act on.
 */
export function assistantUnavailable(delegationId: string): never {
  throw new AppError('ASSISTANT_UNAVAILABLE', undefined, { details: { delegationId } })
}

/** A delegation id that is not on this run — another run's entry, or a stale screen. */
export function delegationNotFound(): never {
  throw new AppError('DELEGATION_NOT_FOUND')
}

/**
 * A used mark naming a claim the delegation did not surface.
 *
 * `VALIDATION_ERROR` rather than reliance's `CLAIM_NOT_SURFACED`: the log marks a claim used *in a
 * delegation*, so the claim being absent from that delegation is a malformed request from the log's
 * own screen rather than a statement about the run's stance matrix.
 */
export function claimNotInDelegation(claimIds: readonly string[]): never {
  throw new AppError('VALIDATION_ERROR', 'Those claims are not part of this delegation.', {
    details: { claimIds: [...claimIds] },
  })
}

/**
 * A write to the Delegation Log outside `working` and `turn_open`.
 *
 * Two different sentences, because a stale screen and a finished run are different situations. Past
 * the Decision Lock the log is a record and nothing reopens it, which is `RUN_LOCKED` (07 §7). Before
 * the frame there is no log to write to, which is the assistant's own refusal.
 */
export function logNotWritable(state: string): never {
  const locked =
    state === 'decision_locked' ||
    state === 'turn_locked' ||
    state === 'defense_pending' ||
    state === 'defense_complete' ||
    state === 'scored' ||
    state === 'confirmed' ||
    state === 'recorded'
  if (locked) throw new AppError('RUN_LOCKED', undefined, { details: { state } })
  assistantLocked(state)
}
