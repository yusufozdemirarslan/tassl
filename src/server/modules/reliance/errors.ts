// Error codes of the `reliance` module (docs/tech/10-backend-spec-modules.md §8) and the throwers
// the service states its rules with. Every code is in the registry (`src/lib/errors.ts`), which
// owns the status and the default message; this file names the ones that belong to this module and
// gives each rule one call site, so a rule and its code cannot drift.
//
// 10 §8 lists six codes. Two of them — `CLOCK_EXPIRED` and its Turn-window twin — are not raised
// here: the clock is what runs out, so `runs/clock.ts`'s `chargeCost` raises them at the moment an
// action or an escalation is charged, and this module simply lets them travel (D-132). Only the
// window's ever arrives: from Step 8.2 a working clock at zero has already auto-locked the decision
// by the time `lockRunForMutation` hands the row over, so what a student meets on the working clock
// is `RUN_LOCKED` from the gate below (D-300). What is left is the four this module decides, plus
// the two state refusals every in-run write shares.
//
// The throwers return `never` and are function declarations: TypeScript narrows after a
// `never`-returning call only for declarations, which is what lets a caller read
// `if (!row) claimNotSurfaced()` and then use `row`.
import { AppError, type ErrorCode } from '@/lib/errors'
import { t } from '@/lib/i18n/t'

/** The codes of 10 §8 this module raises itself. */
export const RELIANCE_ERROR_CODES = [
  'CLAIM_NOT_SURFACED',
  'ACTION_NOT_AVAILABLE',
  'ESCALATION_LIMIT_REACHED',
  'ESCALATION_STATEMENT_INVALID',
  'STANCE_INVALID',
] as const satisfies readonly ErrorCode[]

/**
 * The run vanished between the permission check and the read that follows it.
 *
 * NOT_FOUND rather than a 500, and the same sentence `runs` answers with: 08 §4 gives a student no
 * read of a run that is not theirs, so every miss on a run id says the same thing however it arose.
 */
export function runNotFound(): never {
  throw new AppError('NOT_FOUND', t('run.notFound'))
}

/**
 * A stance, an action or an escalation on a claim this run has never put in front of the student.
 *
 * It is a conflict rather than a not-found, and the difference is the point: the claim exists, and
 * a delegation or a document open one second later would surface it. What has not happened is the
 * student meeting it — and a stance on a claim nobody was shown is a row in the matrix the run
 * cannot account for.
 *
 * The message says nothing about whether the id names a claim of this package at all. A student who
 * could tell "not surfaced yet" from "no such claim" could enumerate the claim set by probing
 * (12 §8.1), which is the map the run is asking them to draw.
 */
export function claimNotSurfaced(): never {
  throw new AppError('CLAIM_NOT_SURFACED', t('workspace.claimNotSurfaced'))
}

/**
 * An interrogation action the claim's confirmed verification paths do not offer (FR-071).
 *
 * `details.type` is the action asked for and nothing else. The available list is not echoed back:
 * it is already on the claim card, and a refusal that enumerated the alternatives would turn a
 * mistyped request into a probe of what the author authored on a claim the student is looking at.
 */
export function actionNotAvailable(type: string): never {
  throw new AppError('ACTION_NOT_AVAILABLE', t('workspace.actionNotAvailable'), {
    details: { type },
  })
}

/**
 * The run's two counted escalations are both spent (FR-092).
 *
 * `details` carries nothing. The count is on the claim card as `remainingEscalations`, and the one
 * fact a refusal must not add is *why this particular escalation counted* — that a claim carries an
 * authored reply is defect-adjacent authored knowledge (D-116, D-244), and a refusal that appeared
 * only on some claims would say it without a field.
 */
export function escalationLimitReached(): never {
  throw new AppError('ESCALATION_LIMIT_REACHED')
}

/** Which half of D-089's rule a statement broke, for a client with no form to mark up. */
export type EscalationStatementReason = 'too_short' | 'too_long'

/**
 * The escalation statement is not the one sentence FR-090 asks for: D-089 puts it at three words to
 * 280 characters, measured after markup is stripped.
 *
 * Both bounds are refused with this code, including the length the wire schema also bounds. The
 * route validates the shape and this validates the rule, and the rule is the one that has to hold
 * for a Server Action, a job, or any future caller that did not come through the route.
 */
export function escalationStatementInvalid(reason: EscalationStatementReason): never {
  throw new AppError('ESCALATION_STATEMENT_INVALID', undefined, {
    details: { field: 'statement', reason },
  })
}

/**
 * A stance that is not one of FR-080's five.
 *
 * The route and the action both parse the enum, so this is the same rule read a second time inside
 * the service — where the rule belongs (CLAUDE.md), and where it holds for every caller. It carries
 * no value in `details`: the client sent it and knows it.
 */
export function stanceInvalid(): never {
  throw new AppError('STANCE_INVALID')
}

// ---------------------------------------------------------------------------------------------
// The state gate every in-run write shares
// ---------------------------------------------------------------------------------------------

/** 10 §8: a stance, an action and an escalation are all `working` or `turn_open` and nowhere else. */
export const RELIANCE_STATES: readonly string[] = ['working', 'turn_open']

/**
 * States in which the decision is behind the student and nothing reopens the room (07 §7's
 * `RUN_LOCKED` on this module's rows). `voided` is deliberately not among them: a voided run is not
 * a locked one, and it answers the fall-through below.
 */
const LOCKED_STATES: readonly string[] = [
  'decision_locked',
  'turn_locked',
  'defense_pending',
  'defense_complete',
  'scored',
  'confirmed',
  'recorded',
]

/**
 * Refuses a stance, an action or an escalation outside `working` and `turn_open`, in the reader's
 * own terms (07 §7: `CLAIM_NOT_SURFACED`, `RUN_LOCKED`, `RUN_PAUSED` on the stance row).
 *
 * Three different situations, three answers, because the student's next act differs in each. A
 * paused run is waiting out a component failure and the answer is the Resume control, with the
 * clock stopped and nothing lost (FR-001). A locked run has moved on and nothing reopens it. Before
 * the frame there is no clock and no claim, which is neither of those and is the transition table's
 * refusal — `details.state` is what sends a stale screen to the run's own `links.next`.
 */
export function relianceNotWritable(state: string): never {
  if (state === 'paused') throw new AppError('RUN_PAUSED', undefined, { details: { state } })
  if (LOCKED_STATES.includes(state)) {
    throw new AppError('RUN_LOCKED', undefined, { details: { state } })
  }
  throw new AppError('ILLEGAL_TRANSITION', t('workspace.claimsNotOpen'), { details: { state } })
}
