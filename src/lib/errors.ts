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
  // runs (10 §6, §10): the codes the lifecycle and the clock refuse with. The rest of the module's
  // list — the frame, the brief, the Turn and the test controls — arrive with the steps that throw
  // them, so a code and its one call site land together.
  RUN_ACTIVE_EXISTS: 409,
  ILLEGAL_TRANSITION: 409,
  CLOCK_EXPIRED: 409,
  TURN_WINDOW_EXPIRED: 409,
  // trace (10 §10)
  SEQUENCE_CONFLICT: 500,
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
  SEQUENCE_CONFLICT: 'Something went wrong on our side.',
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
