// Error model: docs/tech/10-backend-spec.md §1 and 04-repo-structure.md §4.
// One registry of codes with their default HTTP status. Module codes are appended here as the
// modules land (10-backend-spec-modules.md); a code that is not in this map does not compile.
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  // identity (10 §1)
  EXPORT_RATE_LIMITED: 429,
  USER_DELETED: 401,
  // tenancy (10 §2)
  INVITATION_EMAIL_MISMATCH: 409,
  AGREEMENT_PURPOSES_INVALID: 400,
  // courses (10 §3): the mapping is validated wherever it is set
  MAPPING_INVALID: 400,
  MAPPING_CHANGE_UNCONFIRMED: 409,
  PACKAGE_NOT_CONFIRMED: 409,
  VARIANT_MISMATCH: 400,
  ASSIGNMENT_IN_USE: 409,
  MEMBER_HAS_RUNS: 409,
  NOT_SECTION_MEMBER: 403,
  // scenarios (10 §4)
  VERSION_FROZEN: 409,
  ELEMENTS_UNCONFIRMED: 409,
  TEACHING_NOTE_UNCHECKED: 409,
  PACKAGE_INVALID: 422,
  LICENSE_NOT_CONFIRMED: 400,
  IMPORT_INVALID: 400,
  // runs (10 §6, §10): the codes the lifecycle, the clock and the frame refuse with. The rest of
  // the module's list — the brief, the Turn and the test controls — arrive with the steps that
  // throw them, so a code and its one call site land together.
  RUN_ACTIVE_EXISTS: 409,
  ILLEGAL_TRANSITION: 409,
  CLOCK_EXPIRED: 409,
  TURN_WINDOW_EXPIRED: 409,
  READINESS_SKIP_NOT_ALLOWED: 409,
  FRAME_INVALID: 400,
  RUN_LOCKED: 409,
  // The Decision Lock (Step 8.2). `LOCK_REFUSED_UNSTANCED_CLAIM` is FR-084's gate and carries
  // `details { claimId, claimText }`; `BRIEF_INVALID` is FR-100's limits with `details.field`, the
  // shape `FRAME_INVALID` already uses; `ADDENDUM_EXISTS` is FR-107's one-per-run.
  BRIEF_INVALID: 400,
  LOCK_REFUSED_UNSTANCED_CLAIM: 409,
  ADDENDUM_EXISTS: 409,
  // The Turn (Step 9.1). `TURN_NOT_OPEN` is 10 §6's refusal for a read or a response outside
  // `turn_open` and carries `details.state`, so a stale screen follows the run's own `links.next`;
  // `TURN_CLAIMS_UNSTANCED` is FR-111's gate on the response and carries `details.claimIds`, the
  // claims the window put in front of the student and they have taken no position on.
  TURN_NOT_OPEN: 409,
  TURN_CLAIMS_UNSTANCED: 409,
  // The defense (Step 9.2, 10 §9). `DEFENSE_NOT_OPEN` is the refusal for a read, an answer or a
  // completion outside `defense_pending` and carries `details.state`, the same shape `TURN_NOT_OPEN`
  // uses; `QUESTION_ALREADY_ANSWERED` is FR-124's one answer per question; `DEFENSE_INCOMPLETE`
  // carries `details.unanswered`, the number of questions still without an answer row — an *empty*
  // answer is an answer (FR-124), so this counts the questions nobody has submitted anything for.
  DEFENSE_NOT_OPEN: 409,
  QUESTION_ALREADY_ANSWERED: 409,
  DEFENSE_INCOMPLETE: 409,
  // FR-118: the faculty test control, refused when `FEATURE_TEST_CONTROLS` is off. 403 rather than
  // 404: the caller is an instructor of the section who may read the run, and the flag is a
  // deployment fact about the whole installation rather than anything about this run.
  TEST_CONTROLS_DISABLED: 403,
  // `RUN_PAUSED` is 10 §6's refusal "for writes other than resume". Its first raiser is the
  // `reliance` module, whose stances, actions and escalations are the first in-run writes a paused
  // clock has to refuse; `runs` raises it too from Phase 8's Decision Lock. It is one code with one
  // meaning, which is why it lives here rather than in either module.
  RUN_PAUSED: 409,
  // reliance (10 §8): the six refusals a stance, an interrogation action or an escalation can meet.
  // `CLOCK_EXPIRED` and `TURN_WINDOW_EXPIRED` are the seventh and eighth and belong to the clock
  // above, because the clock is what runs out (D-132).
  CLAIM_NOT_SURFACED: 409,
  ACTION_NOT_AVAILABLE: 409,
  ESCALATION_LIMIT_REACHED: 409,
  ESCALATION_STATEMENT_INVALID: 400,
  STANCE_INVALID: 400,
  // assistant (10 §7): the four refusals a delegation can meet. `ASSISTANT_UNAVAILABLE` is the
  // only one that changes the run — the component failure of FR-001 pauses it and stops the clock —
  // so it is a 503 rather than a 500: the student is told to wait and resume, not that they broke
  // something.
  ASSISTANT_LOCKED: 409,
  ASSISTANT_REQUEST_TOO_LONG: 400,
  ASSISTANT_UNAVAILABLE: 503,
  DELEGATION_NOT_FOUND: 404,
  // trace (10 §10)
  SEQUENCE_CONFLICT: 500,
  // scoring (10 §11.5). `RUN_NOT_SCORABLE` is the refusal for a run the pipeline cannot draft bands
  // for: one that is not at `defense_complete`, or one whose stance records are too far gone to read
  // (FR-087). It carries `details.state` and `details.reason`, the shape `TURN_NOT_OPEN` uses, and
  // it is the code `POST /review/runs/{runId}/manual-bands` answers with when a run is not held.
  // A stored `run_scores.rubric_version` this build no longer carries: the run cannot be re-read
  // against the standard it was scored against, and substituting the current rubric would silently
  // change what a confirmed band means (D-033). A 500 because it can only be a deployment that lost
  // a file a row still points at — nothing the reader did or can act on.
  RUN_NOT_SCORABLE: 409,
  RUBRIC_VERSION_UNKNOWN: 500,
  // records (10 §14). `RECORD_NOT_AVAILABLE` is the refusal for a Judgment Record or its export
  // before the run's bands are confirmed, and carries `details.state`, the shape `TURN_NOT_OPEN`
  // and `DEFENSE_NOT_OPEN` already use. `EXPORT_NOT_FOUND` is a 404 rather than a 409 because a
  // version number that names no export names nothing — the run exists and the reviewer may read
  // it, so the miss is about the file they asked for.
  RECORD_NOT_AVAILABLE: 409,
  EXPORT_NOT_FOUND: 404,
  // review (10 §12). `BAND_DECISION_INVALID` is the shape rule an override breaks by naming no
  // band; `RUN_NOT_SCORED` is a decision asked for on a run that has no draft to decide, and
  // carries `details.state`, the shape `TURN_NOT_OPEN` uses. `BAND_LOCKED_BY_INSTRUCTOR` is 08 §4's
  // TA row — "not a band the instructor already decided" — and is a 403 because the TA may read the
  // band and may decide six others, so the refusal is about this one act. `RUN_NOT_CONFIRMED` is
  // the export history of a run whose bands nobody has decided: 07 §8 gives it to
  // `GET /runs/{runId}/exports`. `NEUTRALIZATION_EXISTS` is one correction per claim per run.
  BAND_DECISION_INVALID: 400,
  RUN_NOT_SCORED: 409,
  BAND_LOCKED_BY_INSTRUCTOR: 403,
  RUN_NOT_CONFIRMED: 409,
  NEUTRALIZATION_EXISTS: 409,
  // debrief (10 §13). `DEBRIEF_NOT_AVAILABLE` is a read or an answer asked for on a run whose bands
  // have not been drafted, or on one that was voided; it carries `details.state`, the shape
  // `TURN_NOT_OPEN` and `RECORD_NOT_AVAILABLE` already use, so a screen left open while the run
  // moved follows the run. `DEBRIEF_ANSWERED` is FR-152's one answer per run: the two questions are
  // a record of what the student thought at the end of the run, and a second submission would be a
  // different thing written over it.
  DEBRIEF_NOT_AVAILABLE: 409,
  DEBRIEF_ANSWERED: 409,
  LLM_BUDGET_EXCEEDED: 402,
  LLM_PROVIDER_ERROR: 502,
  LLM_CIRCUIT_OPEN: 503,
  LLM_OUTPUT_INVALID: 502,
  INTERNAL_ERROR: 500,
} as const satisfies Record<string, number>

export type ErrorCode = keyof typeof ERROR_STATUS

export const DEFAULT_STATUS: Record<ErrorCode, number> = ERROR_STATUS

export const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'The request did not match the expected shape.',
  UNAUTHENTICATED: 'Sign in to continue.',
  FORBIDDEN: 'You do not have permission to do this.',
  NOT_FOUND: 'Not found.',
  CONFLICT: 'The request conflicts with the current state.',
  RATE_LIMITED: 'Too many requests. Try again shortly.',
  EXPORT_RATE_LIMITED: 'You can download your data twice an hour. Try again shortly.',
  USER_DELETED: 'This account has been deleted.',
  INVITATION_EMAIL_MISMATCH: 'This invitation was sent to a different email address.',
  AGREEMENT_PURPOSES_INVALID: 'An agreement needs at least one permitted purpose.',
  MAPPING_INVALID: 'A band mapping needs four positive numbers.',
  MAPPING_CHANGE_UNCONFIRMED:
    'Confirm the change: every confirmed run in this course is re-exported.',
  PACKAGE_NOT_CONFIRMED: 'An assignment needs a confirmed scenario package version.',
  VARIANT_MISMATCH: 'That variant belongs to a different package version.',
  ASSIGNMENT_IN_USE: 'A run has already started on this assignment, so its setup is fixed.',
  MEMBER_HAS_RUNS: 'This person has runs in the section, so they cannot be removed.',
  NOT_SECTION_MEMBER: 'That address does not belong to this institution yet.',
  VERSION_FROZEN: 'This version is confirmed, so it can no longer be changed.',
  ELEMENTS_UNCONFIRMED: 'Every element needs a decision before the version can be confirmed.',
  TEACHING_NOTE_UNCHECKED: 'Confirm you have read the teaching note first.',
  PACKAGE_INVALID: 'This package does not yet meet the scenario rules.',
  LICENSE_NOT_CONFIRMED:
    'A package can only be built from a seed whose license permits adaptation.',
  IMPORT_INVALID: 'That file is not a Tassl package export.',
  RUN_ACTIVE_EXISTS: 'You already have a run on this assignment.',
  ILLEGAL_TRANSITION: 'This run has already moved past that step.',
  CLOCK_EXPIRED: 'The working clock has run out.',
  TURN_WINDOW_EXPIRED: 'The Turn window has closed.',
  READINESS_SKIP_NOT_ALLOWED: 'The check can only be skipped after a submission has failed.',
  FRAME_INVALID: 'The frame is not ready to lock.',
  RUN_LOCKED: 'This run’s decision is locked, so it can no longer be changed.',
  BRIEF_INVALID: 'The brief is not ready to file.',
  // 07 §7's own sentence for this row. It names no claim: the claim's own words travel in
  // `details.claimText`, which is what the lock dialog puts beside its "Go to claim" control.
  LOCK_REFUSED_UNSTANCED_CLAIM: 'A claim you relied on has no stance.',
  ADDENDUM_EXISTS: 'This run already has its addendum.',
  TURN_NOT_OPEN: 'The Turn is not open on this run.',
  // It names no claim: the claims' ids travel in `details.claimIds`, and the Turn screen already
  // holds their words — naming one here would be a second copy of text the student is looking at.
  TURN_CLAIMS_UNSTANCED: 'A claim the Turn raised has no stance yet.',
  DEFENSE_NOT_OPEN: 'The defense is not open on this run.',
  QUESTION_ALREADY_ANSWERED: 'That question has already been answered.',
  // It names no question: the count travels in `details.unanswered` and the screen already holds the
  // list, so naming one here would be a second copy of what the student is looking at.
  DEFENSE_INCOMPLETE: 'Every question needs an answer before the defense can be finished.',
  TEST_CONTROLS_DISABLED: 'Test controls are switched off in this environment.',
  RUN_PAUSED: 'The run is paused and the clock is stopped. Resume it to carry on.',
  CLAIM_NOT_SURFACED: 'That claim has not come up in this run yet.',
  ACTION_NOT_AVAILABLE: 'That check is not available on this claim.',
  ESCALATION_LIMIT_REACHED: 'You have used both of the escalations this run offers.',
  ESCALATION_STATEMENT_INVALID:
    'Say in one sentence what you cannot evaluate: at least three words, up to 280 characters.',
  STANCE_INVALID: 'That is not one of the five stances.',
  ASSISTANT_LOCKED: 'The assistant is not available at this point in the run.',
  ASSISTANT_REQUEST_TOO_LONG: 'That request is too long. Shorten it and send it again.',
  ASSISTANT_UNAVAILABLE:
    'The assistant did not answer, so the run is paused and the clock has stopped. Nothing you did was lost.',
  DELEGATION_NOT_FOUND: 'That entry is not in this run’s Delegation Log.',
  SEQUENCE_CONFLICT: 'Something went wrong on our side.',
  RUN_NOT_SCORABLE: 'This run is not at a point where it can be scored.',
  RUBRIC_VERSION_UNKNOWN: 'Something went wrong on our side.',
  RECORD_NOT_AVAILABLE: 'This run’s record opens once its bands are confirmed.',
  EXPORT_NOT_FOUND: 'That export version does not exist for this run.',
  BAND_DECISION_INVALID: 'An override needs a band to settle on.',
  RUN_NOT_SCORED: 'This run has no drafted bands to decide yet.',
  BAND_LOCKED_BY_INSTRUCTOR: 'The instructor has decided this dimension.',
  RUN_NOT_CONFIRMED: 'This run has no course export yet; its bands are not confirmed.',
  NEUTRALIZATION_EXISTS: 'A correction has already been entered on this claim for this run.',
  DEBRIEF_NOT_AVAILABLE: 'This run’s debrief opens once its bands have been drafted.',
  DEBRIEF_ANSWERED: 'The two questions on this run have already been answered.',
  LLM_BUDGET_EXCEEDED: 'The assistant budget for this period has been used up.',
  LLM_PROVIDER_ERROR: 'The assistant provider did not respond correctly.',
  LLM_CIRCUIT_OPEN: 'The assistant is temporarily unavailable.',
  LLM_OUTPUT_INVALID: 'The assistant returned an unusable response.',
  INTERNAL_ERROR: 'Something went wrong on our side.',
}

export type AppErrorOptions = { status?: number; details?: unknown }

export class AppError extends Error {
  readonly code: ErrorCode
  readonly opts: AppErrorOptions

  constructor(code: ErrorCode, message?: string, opts: AppErrorOptions = {}) {
    super(message ?? DEFAULT_MESSAGES[code])
    this.name = 'AppError'
    this.code = code
    this.opts = opts
  }

  get status(): number {
    return this.opts.status ?? DEFAULT_STATUS[this.code]
  }
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError

/** Wire envelope for every failed HTTP response and every failed Server Action (SYS-022). */
export type ErrorBody = { code: ErrorCode; message: string; details?: unknown; requestId: string }
export type ErrorEnvelope = { error: ErrorBody }

/** Server Actions never throw to the client; they return this. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ErrorBody }
