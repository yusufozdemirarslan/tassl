// Maps any thrown value to the error envelope and HTTP status (docs/tech/10-backend-spec.md §1).
import { ZodError, z } from 'zod'
import {
  AppError,
  isAppError,
  type ErrorBody,
  type ErrorCode,
  type ErrorEnvelope,
} from '@/lib/errors'

export type ErrorParts = {
  status: number
  code: ErrorCode
  body: ErrorEnvelope
  headers: Record<string, string>
}

const retryAfterSeconds = (details: unknown): number | undefined => {
  if (typeof details !== 'object' || details === null) return undefined
  const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : undefined
}

/**
 * A `RAISE EXCEPTION` from one of our own triggers, which carry an error code as their message.
 *
 * The freeze on a confirmed package version is enforced twice: the service refuses the write, and
 * `package_version_frozen` / `package_element_frozen` / `variant_claim_state_frozen` raise P0001
 * with `VERSION_FROZEN` when two authors race past that check (drizzle/0004_package_frozen.sql).
 * Unmapped, the guarantee arrived as a 500 and was recorded as a bug; it is the same refusal the
 * service gives, so it is answered the same way.
 */
function fromDatabaseGuard(err: unknown): AppError | null {
  if (typeof err !== 'object' || err === null) return null
  for (let cause: unknown = err; cause; cause = (cause as { cause?: unknown }).cause) {
    const raised = cause as { code?: unknown; message?: unknown }
    if (raised.code !== 'P0001' || typeof raised.message !== 'string') continue
    // The trigger's message is the error code itself; anything else is not ours to translate.
    if (raised.message === 'VERSION_FROZEN') return new AppError('VERSION_FROZEN')
    return null
  }
  return null
}

/** Normalizes an error: AppError keeps its status and details, Zod errors become 400, anything else is 500. */
export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err
  if (err instanceof ZodError) {
    return new AppError('VALIDATION_ERROR', undefined, { details: z.flattenError(err) })
  }
  return fromDatabaseGuard(err) ?? new AppError('INTERNAL_ERROR')
}

export function toErrorParts(err: unknown, requestId: string): ErrorParts {
  const appError = toAppError(err)
  const body: ErrorBody = { code: appError.code, message: appError.message, requestId }
  if (appError.opts.details !== undefined) body.details = appError.opts.details
  const headers: Record<string, string> = { 'x-request-id': requestId, 'cache-control': 'no-store' }
  const retryAfter =
    appError.code === 'RATE_LIMITED' ? retryAfterSeconds(appError.opts.details) : undefined
  if (retryAfter !== undefined) headers['retry-after'] = String(retryAfter)
  return { status: appError.status, code: appError.code, body: { error: body }, headers }
}

export function toErrorResponse(err: unknown, requestId: string): Response {
  const parts = toErrorParts(err, requestId)
  return Response.json(parts.body, { status: parts.status, headers: parts.headers })
}
