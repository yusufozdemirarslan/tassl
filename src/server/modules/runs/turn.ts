// The Turn's arithmetic (docs/tech/10-backend-spec.md §8 branches 3 and 4; 10-backend-spec-modules.md
// §6; FR-110 to FR-115; D-043, D-077, D-132, D-297).
//
// The Turn is the one part of a run with **two instants that are not the same instant**, and every
// rule below is about keeping them apart.
//
//   * It **fires** at `turn_due_at`, which the Decision Lock stamped as `decision_locked_at +
//     turn_delay_seconds` (FR-110, D-297). That instant is a fact about the run and not about who
//     was looking: `turn_delivered` is stamped there however long afterwards the read arrives, the
//     way every materialized timer is (NFR-002, ADR-019).
//   * It is **delivered** at the first read at or after that, and the twelve minutes start *there*.
//     FR-115 is the whole reason: a student whose laptop was shut when the Turn fired comes back to
//     the full window rather than to a window that expired while nobody was there. There is no
//     scheduler to deliver it earlier, and adding one would only move the same problem (D-043).
//
// On time the two coincide and the distinction costs nothing. Off-line they differ by the length of
// the absence, and everything the *window* is made of — `turn_delivered_at`, `turn_window_ends_at`,
// the claims the window surfaces and the `claim_used` marks D-077 writes for them — is stamped at
// the delivery, because a window that had not opened yet cannot have had time remaining in it
// (D-334).
//
// Nothing here reads or writes anything: it answers instants and shapes, and `./service.ts` applies
// them inside the transaction that holds the run's row lock. That is the same division `./lock.ts`
// and `./readiness.ts` make, and it is what lets `tests/unit/runs/timers.test.ts` assert the
// offline case without a database.
import type { FrameInvalidReason } from './errors'
import { TURN_WINDOW_MS } from './limits'
import { TurnResponseSchema, type TurnResponse, type TurnResponseInput } from './schema'

/**
 * When the Turn falls due: the instant the decision was filed plus the package's delay (FR-110).
 *
 * `at` is the instant the lock stamped, which for the clock's own auto-lock is the moment the
 * working clock reached zero rather than the moment somebody looked (D-297). Measuring from `now`
 * instead would hold a Turn back by the length of the student's absence, which is exactly what lazy
 * materialization exists to avoid.
 */
export function turnDueAtFrom(lockedAt: Date, turnDelaySeconds: number): Date {
  return new Date(lockedAt.getTime() + turnDelaySeconds * 1000)
}

/**
 * When the window closes: twelve minutes from the delivery read, never earlier than
 * `turn_due_at + 12 min` (FR-115, D-043).
 *
 * The `max` is what makes the offline case right, and it is also why this is a function of two
 * instants rather than one. The branch that calls it only fires once `readAt >= dueAt`, so the max
 * always picks `readAt` in practice; it is written the way the rule reads so that a caller which
 * one day delivers early cannot silently hand a student a window that has already run out.
 */
export function windowEndsAtFrom(dueAt: Date, readAt: Date): Date {
  return new Date(Math.max(readAt.getTime(), dueAt.getTime()) + TURN_WINDOW_MS)
}

/** The three instants a delivery writes (10 §8 branch 3). */
export type TurnDeliveryPlan = {
  /** `turn_delivered.occurred_at`: when the Turn fired, whatever time it is read (NFR-002). */
  firedAt: Date
  /** `runs.turn_delivered_at`: when it reached the student, and when the window opened (FR-115). */
  deliveredAt: Date
  /** `runs.turn_window_ends_at`. */
  windowEndsAt: Date
}

/**
 * 10 §8 branch 3, as instants: the Turn fired at `dueAt` and reached the student at `readAt`.
 *
 * `deliveredAt` is floored at `dueAt` for the same reason `windowEndsAtFrom` takes the max — the
 * two must agree, or a run would record a delivery before the Turn existed.
 */
export function planTurnDelivery(dueAt: Date, readAt: Date): TurnDeliveryPlan {
  const deliveredAt = readAt.getTime() < dueAt.getTime() ? dueAt : readAt
  return { firedAt: dueAt, deliveredAt, windowEndsAt: windowEndsAtFrom(dueAt, readAt) }
}

/**
 * The response as `run_turn_responses` stores it and as `turn_response_locked` carries it (10 §10).
 *
 * `justification` and `confidence` are nullable because of one case and only one: FR-113's implicit
 * hold, which nobody wrote. An explicit response always has both (`TurnResponseSchema`, D-335).
 */
export type TurnResponseFields = {
  response: TurnResponse['response']
  justification: string | null
  confidence: number | null
  implicit: boolean
}

/**
 * FR-113: the window closed and nothing was filed, so the original decision stands as a hold.
 *
 * It is a hold *recorded as implicit*, never a hold the student made: the two are different facts
 * about the run and the flag is what keeps them apart in the trace, in the defense's question
 * selection (`frame_vs_response` fires only on a non-implicit response, D-106) and in the
 * Adaptation band. `confidence_after_turn` stays null for the same reason — nobody gave one.
 */
export const IMPLICIT_HOLD: TurnResponseFields = {
  response: 'hold',
  justification: null,
  confidence: null,
  implicit: true,
}

/** What a student's response comes to: the fields to store, or the field that broke a rule. */
export type TurnResponsePlan =
  | { ok: true; fields: TurnResponseFields }
  | { ok: false; field: string; reason: FrameInvalidReason }

/**
 * Applies FR-112's rules to a response and answers the *parsed* value, so the text the word count
 * was taken over is the text that is stored and the text the trace carries (10 §5, D-075).
 *
 * The refusal names the field the form binds to — `response`, `justification`, `confidence` — and
 * which rule it broke, the same three words the frame and the brief answer with.
 */
export function planTurnResponse(input: TurnResponseInput): TurnResponsePlan {
  const parsed = TurnResponseSchema.safeParse(input)
  if (parsed.success) {
    return { ok: true, fields: { ...parsed.data, implicit: false } }
  }
  const issue = parsed.error.issues[0]
  if (!issue) return { ok: false, field: 'response', reason: 'invalid' }
  const field = issue.path.length > 0 ? issue.path.join('.') : 'response'
  return { ok: false, field, reason: reasonOf(issue.code, issue.message, field) }
}

/**
 * Which of FR-112's rules the field broke, for a client with no form to mark it on. `WORD_LIMIT` is
 * the message `wordLimit(n)` sets (10 §17), so a pasted essay is distinguishable from an empty box.
 * The same reading `lock.ts` makes of the brief, and deliberately the same three words.
 */
function reasonOf(code: string, message: string, field: string): FrameInvalidReason {
  if (message === 'WORD_LIMIT') return 'word_limit'
  if (code === 'too_small' && field !== 'confidence') return 'required'
  return 'invalid'
}
