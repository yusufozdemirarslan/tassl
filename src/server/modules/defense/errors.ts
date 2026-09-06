// Error codes of the `defense` module (docs/tech/10-backend-spec-modules.md §9) and the throwers the
// service states its rules with. Every code is in the registry (`src/lib/errors.ts`), which owns the
// status and the default message; this file names the three that belong to this module and gives
// each rule one call site, so a rule and its code cannot drift.
//
// The throwers return `never` and are function declarations: TypeScript narrows after a
// `never`-returning call only for declarations, which is what lets a caller read
// `if (!row) questionNotFound()` and then use `row`.
import { AppError, type ErrorCode } from '@/lib/errors'
import { t } from '@/lib/i18n/t'

/** The codes of 10 §9. */
export const DEFENSE_ERROR_CODES = [
  'DEFENSE_NOT_OPEN',
  'QUESTION_ALREADY_ANSWERED',
  'DEFENSE_INCOMPLETE',
] as const satisfies readonly ErrorCode[]

/** The run vanished between the permission check and the read that follows it. */
export function runNotFound(): never {
  throw new AppError('NOT_FOUND', t('run.notFound'))
}

/**
 * A read, an answer or a completion outside the states the defense lives in.
 *
 * `details.state` is the run's own state, in the shape `TURN_NOT_OPEN` uses, so a stale tab follows
 * the run's `links.next` rather than sitting on a screen the run has left. It says nothing else: a
 * refusal is not the place to describe what the run did instead.
 *
 * It is also the answer for a *completion* of a defense that was never opened. Nothing selected the
 * questions, so "every question is answered" is vacuously true and `DEFENSE_INCOMPLETE` would be a
 * lie about a run with no interview in it.
 */
export function defenseNotOpen(state: string): never {
  throw new AppError('DEFENSE_NOT_OPEN', undefined, { details: { state } })
}

/**
 * A question id that is not one of this run's.
 *
 * NOT_FOUND rather than FORBIDDEN, and deliberately the same answer for a question of another
 * student's run: a question id that could be probed for existence would say that a run somewhere
 * asked it, which is the one thing a student may never learn about another student's run (08 §4).
 */
export function questionNotFound(): never {
  throw new AppError('NOT_FOUND', t('run.notFound'))
}

/**
 * FR-124: one answer per question, and it is the record.
 *
 * A second submission is refused rather than overwriting, because the answer is evidence of what the
 * student could say at the moment they were asked — the `defense_answer` event carries the duration
 * from focus to submit — and a second attempt after thinking about it is a different fact.
 */
export function questionAlreadyAnswered(): never {
  throw new AppError('QUESTION_ALREADY_ANSWERED')
}

/**
 * `completeDefense` with questions that have no answer row at all (10 §9).
 *
 * An **empty** answer is an answer (FR-124) and passes: the student pressed submit on a question
 * they had nothing to say to, and that is a fact about the run worth recording. What is refused is
 * finishing while a question has never been submitted, which UI-026 turns into the confirm dialog
 * that offers to file the remainder empty.
 *
 * `details.unanswered` is the count and not the ids: the screen is holding the list already, and a
 * refusal that enumerated it would be a second copy of what the student is looking at.
 */
export function defenseIncomplete(unanswered: number): never {
  throw new AppError('DEFENSE_INCOMPLETE', undefined, { details: { unanswered } })
}

/**
 * An answer longer than the 5,000 characters 10 §9 allows.
 *
 * `VALIDATION_ERROR` with `details { field, reason }`, the shape `FRAME_INVALID` and `BRIEF_INVALID`
 * already use, because 10 §9 gives this module three codes and none of them is this one — a fourth
 * would be a rule with no entry in the spec's own list (the reading D-335 makes of the same choice
 * one module along). The rule is applied in the service so it holds for every caller (D-287).
 */
export function answerTooLong(): never {
  throw new AppError('VALIDATION_ERROR', undefined, {
    details: { field: 'text', reason: 'too_long' },
  })
}
