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
