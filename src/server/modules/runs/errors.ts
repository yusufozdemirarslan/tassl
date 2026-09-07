// Error codes of the `runs` module (docs/tech/10-backend-spec-modules.md §6) and the throwers the
// service, the state machine and the clock state their rules with. Every code is in the registry
// (`src/lib/errors.ts`), which owns the status and the default message; this file names the ones
// that belong to this module and gives each rule one call site, so a rule and its code cannot drift.
//
// 10 §6 lists thirteen codes for this module and all thirteen are here: the lifecycle's, the
// clock's, the frame's, Step 8.2's brief, Decision Lock, addendum and test control, and Step 9.1's
// two Turn refusals. No code sits in the registry without the rule that raises it.
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
  'RUN_PAUSED',
  'BRIEF_INVALID',
  'LOCK_REFUSED_UNSTANCED_CLAIM',
  'ADDENDUM_EXISTS',
  'TURN_NOT_OPEN',
  'TURN_CLAIMS_UNSTANCED',
  'TEST_CONTROLS_DISABLED',
  // FR-183's re-offer: an explicit variant that does not belong to the run's own package version.
  // The same code `courses` answers an assignment configured that way with, because it is the same
  // mistake — a variant id from another package — and one meaning per code is the rule.
  'VARIANT_MISMATCH',
] as const satisfies readonly ErrorCode[]

/**
 * A run the actor neither owns nor reviews. NOT_FOUND rather than FORBIDDEN even for a classmate
 * who can see the section: 08 §4 gives a student no read of another student's run at all, so
 * saying the id resolves is already more than they may know (07 §1 "Tenancy").
 */
export function runNotFound(): never {
  throw new AppError('NOT_FOUND', t('run.notFound'))
}

/**
 * A re-offer asked for on a variant that is not one of the run's package version (10 §6, FR-183).
 *
 * `VARIANT_MISMATCH` rather than NOT_FOUND: the caller is the section's instructor, standing on the
 * replay of a run they may read, and the id they sent is wrong rather than hidden.
 */
export function reofferVariantMismatch(): never {
  throw new AppError('VARIANT_MISMATCH')
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

// ---------------------------------------------------------------------------------------------
// The Decision Brief, the Decision Lock and the addendum (FR-084, FR-100 to FR-108)
//
// Four refusals and one gate. The gate is `assertBriefWritable`, which every write of the working
// period's last artifact goes through, so a paused run, a locked run and a run that has not reached
// the brief are three different sentences rather than one — the student's next act differs in each.
// ---------------------------------------------------------------------------------------------

/**
 * The brief is written and filed in `working` and nowhere else (10 §6).
 *
 * A paused run is waiting out a component failure with its clock stopped, and the answer is the
 * Resume control (FR-001) — the same reading `reliance` makes of the same state. A run past the
 * Decision Lock is refused with `RUN_LOCKED`, because nothing reopens the brief (FR-102). Anything
 * else is the transition table's refusal, with `details.state` for the screen that has to follow
 * the run's own `links.next` from there.
 */
export function assertBriefWritable(state: string): void {
  if (state === 'working') return
  if (state === 'paused') throw new AppError('RUN_PAUSED', undefined, { details: { state } })
  if (BRIEF_CLOSED_STATES.includes(state)) {
    throw new AppError('RUN_LOCKED', undefined, { details: { state } })
  }
  throw new AppError('ILLEGAL_TRANSITION', t('run.briefNotOpen'), { details: { state } })
}

/**
 * The states in which the decision is behind the student. `voided` is deliberately absent: a voided
 * run is not a locked one and falls through to the transition table's refusal.
 */
const BRIEF_CLOSED_STATES: readonly string[] = [
  'decision_locked',
  'turn_open',
  'turn_locked',
  'defense_pending',
  'defense_complete',
  'scored',
  'confirmed',
  'recorded',
]

/**
 * The brief does not meet FR-100 or FR-103 (10 §6: `BRIEF_INVALID` (400) with `details.field`).
 *
 * The same shape as `frameInvalid`, for the same reason: the field is the path the form binds to —
 * `recommendation`, `assumptions.1`, `namedValues.premium_payback_months` — so the refusal lands on
 * the control that caused it, and `reason` says which rule it broke for a client with no form.
 */
export function briefInvalid(field: string, reason: FrameInvalidReason): never {
  throw new AppError('BRIEF_INVALID', t('run.briefInvalid'), { details: { field, reason } })
}

/**
 * A write of a brief that is already filed (FR-102).
 *
 * It is the state gate read a second time, at the row rather than at the run: the transaction holds
 * the run's lock, so the two cannot disagree — but `run_briefs` is immutable in the database
 * (trigger `run_briefs_locked`, migration 0006), and a service that let an update reach it would
 * turn a rule into a 500. This is the domain answer instead.
 */
export function briefAlreadyLocked(): never {
  throw new AppError('RUN_LOCKED', t('run.briefAlreadyLocked'))
}

/**
 * FR-084's gate: a claim the run relied on has no stance, so the decision does not lock.
 *
 * `details` carries the claim's id and the claim's own words, which is what UI-024's dialog names
 * it by and links to. Nothing else travels: not why it counts as relied on, not what stance it
 * deserves, not whether it is one of the planted ones (FR-073, 12 §8.1). The words are the ones the
 * student has already read.
 */
export function lockRefusedUnstancedClaim(claimId: string, claimText: string): never {
  throw new AppError('LOCK_REFUSED_UNSTANCED_CLAIM', t('run.lockRefusedUnstancedClaim'), {
    details: { claimId, claimText },
  })
}

/** FR-107: one addendum per run, and the run already has it. */
export function addendumExists(): never {
  throw new AppError('ADDENDUM_EXISTS')
}

/**
 * An addendum outside its window: before the decision is filed, after the Turn is over, or on a
 * voided run (10 §6 as D-363 corrects it — after the lock and before the defense).
 *
 * Before the lock the student has the brief itself, and an addendum would be a second draft of it;
 * once the defense has opened the questions are in front of them, and fifty words written with those
 * in hand are a different artifact from the one FR-107 offers.
 *
 * `ILLEGAL_TRANSITION` with the state in `details`, like every other refusal that turns on where the
 * run has got to: it is what lets a screen holding a stale `canAddAddendum` follow the run's own
 * `links.next` instead of showing an error (07 §7).
 */
export function addendumNotAvailable(state: string): never {
  throw new AppError('ILLEGAL_TRANSITION', t('run.addendumNotAvailable'), { details: { state } })
}

/**
 * The frozen record of a run whose decision has not been filed (`getDecision`, D-302).
 *
 * `decision_locked_at` is the fact the read is about, so the refusal is the transition table's and
 * carries the state — which is what sends a screen that arrived at `/locked` too early to the run's
 * own `links.next` rather than to an error boundary.
 */
export function decisionNotLocked(state: string): never {
  throw new AppError('ILLEGAL_TRANSITION', t('run.decisionNotLocked'), { details: { state } })
}

// ---------------------------------------------------------------------------------------------
// The Turn (FR-110 to FR-115)
//
// Two refusals, and neither of them says anything about what the Turn deserves. Whether the new
// information warrants a hold, a revision or a reversal is the question being asked (FR-114), and
// `warrants_change` and `proportionate_response` are authored fields no student payload — a refusal
// included — may carry (`student-view.ts`).
// ---------------------------------------------------------------------------------------------

/**
 * The Turn was read or answered outside `turn_open`: before `turn_due_at`, or after the window
 * closed and the response locked.
 *
 * `details.state` is what the screen follows `links.next` from, which is the same shape
 * `readinessNotOpen` and `workspaceNotOpen` answer with — and it is the whole of what the student
 * needs, because both refusals have exactly one remedy: read the run again and go where it says.
 */
export function turnNotOpen(state: string): never {
  throw new AppError('TURN_NOT_OPEN', t('run.turnNotOpen'), { details: { state } })
}

/**
 * FR-111's gate: a claim the Turn window put in front of the student has no stance, so the response
 * does not lock.
 *
 * It is FR-084's gate one state later and carries the same discipline: `details.claimIds` names the
 * claims by id and nothing else travels — not what stance any of them deserves, not whether one is
 * the planted defect, not why the window made them relied on (FR-073, 12 §8.1). The Turn screen is
 * already showing the claim cards, so it marks the ones it is handed.
 */
export function turnClaimsUnstanced(claimIds: readonly string[]): never {
  throw new AppError('TURN_CLAIMS_UNSTANCED', t('run.turnClaimsUnstanced'), {
    details: { claimIds: [...claimIds] },
  })
}

/**
 * The response does not meet FR-112: a category that is not one of the three, a justification over
 * 150 words or empty once markup is stripped, or a confidence outside 0 to 100.
 *
 * `VALIDATION_ERROR` rather than a code of its own, because 10 §6 gives this endpoint two refusals
 * and neither is this one. The shape is `frameInvalid`'s so the form binds to the same `details`:
 * the field that caused it, and which of the three rules it broke.
 */
export function turnResponseInvalid(field: string, reason: FrameInvalidReason): never {
  throw new AppError('VALIDATION_ERROR', t('run.turnResponseInvalid'), {
    details: { field, reason },
  })
}

/** FR-107: fifty words, and not empty once markup is stripped. */
export function addendumInvalid(reason: FrameInvalidReason): never {
  throw new AppError('VALIDATION_ERROR', t('run.addendumInvalid'), {
    details: { field: 'text', reason },
  })
}

/**
 * FR-118's control with `FEATURE_TEST_CONTROLS` off (10 §6: `TEST_CONTROLS_DISABLED` (403)).
 *
 * It is checked *after* `requireRunInstructor`, not before: a student who could tell "switched off"
 * from "not yours" would have learned that the run exists and that they are not its instructor,
 * which 08 §4 gives them no read of at all.
 */
export function testControlsDisabled(): never {
  throw new AppError('TEST_CONTROLS_DISABLED', t('run.testControlsDisabled'))
}

/**
 * The states in which arming a forced assistant failure means something (FR-118, D-332).
 *
 * The same set the assistant answers in, plus `paused`: a paused run is a working run with its
 * clock stopped, and the outage the instructor is arming lands on the delegation after Resume. A
 * run that has not unlocked the assistant, and a run whose decision is filed, have no delegation
 * coming — arming there would write a flag mutation and an audit row against a run nothing will
 * read them on.
 */
const FORCED_FAILURE_STATES: readonly string[] = ['working', 'turn_open', 'paused']

/**
 * FR-118's control on a run with no assistant to fail (D-332).
 *
 * The same shape as `assertBriefWritable` and for the same reason: a run past the Decision Lock is
 * refused with `RUN_LOCKED` because nothing about it will run a delegation again, and a run that
 * has not got there yet is the transition table's refusal, with `details.state` so the review
 * screen can say which. It is checked *after* `requireRunInstructor` and after the environment
 * flag, so nobody who may not use the control learns anything about the run's state from it.
 */
export function assertForcedFailureArmable(state: string): void {
  if (FORCED_FAILURE_STATES.includes(state)) return
  if (BRIEF_CLOSED_STATES.includes(state)) {
    throw new AppError('RUN_LOCKED', undefined, { details: { state } })
  }
  throw new AppError('ILLEGAL_TRANSITION', t('run.forcedFailureNotArmable'), {
    details: { state },
  })
}

/**
 * A test-only route reached outside `APP_ENV=test` (D-109). NOT_FOUND, with the registry's own
 * "Not found." — the answer an unmounted path gives, because outside a test process that is what
 * this path is.
 */
export function testRouteUnavailable(): never {
  throw new AppError('NOT_FOUND')
}

/**
 * A run in `paused` with no open `run_pauses` row.
 *
 * It is not reachable: a run enters `paused` only through `pauseRun`, which writes the row in the
 * transaction that transitions it. If it happens anyway the run's record is inconsistent, and a
 * `resume` event pointing at no pause would make it worse rather than better — so this is a 500
 * that reaches Sentry, not a refusal the student can act on.
 */
export function pauseRecordMissing(runId: string): never {
  throw new AppError('INTERNAL_ERROR', 'This run is paused with no pause on record.', {
    details: { runId },
  })
}
