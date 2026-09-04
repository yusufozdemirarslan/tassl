// Error codes of the `tenancy` module (docs/tech/10-backend-spec-modules.md §2) and the one place
// a Better Auth failure becomes an `AppError`.
//
// Organizations, members, and invitations belong to Better Auth, so the service calls
// `auth.api.*`, which throws `APIError` with a status name and a body `{ code, message }` whose
// code is the key of `ORGANIZATION_ERROR_CODES`. Those keys are the contract this file maps onto
// our registry (`src/lib/errors.ts`); an unmapped failure keeps Better Auth's status so a 4xx is
// never reported as an internal error.
import { isAPIError } from 'better-auth/api'
import { AppError, type ErrorCode } from '@/lib/errors'
import { t } from '@/lib/i18n/t'

/** The codes 10 §2 names for this module; both are already in the registry. */
export const TENANCY_ERROR_CODES = [
  'INVITATION_EMAIL_MISMATCH',
  'AGREEMENT_PURPOSES_INVALID',
] as const satisfies readonly ErrorCode[]

/** Better Auth error keys → our codes and messages (08 §2.5, 07 §4). */
const MAPPED: Record<string, { code: ErrorCode; message?: string }> = {
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: { code: 'INVITATION_EMAIL_MISMATCH' },
  INVITATION_NOT_FOUND: {
    code: 'NOT_FOUND',
    message: t('tenancy.invitationNotFound'),
  },
  EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION: {
    code: 'FORBIDDEN',
    message: t('tenancy.invitationEmailUnverified'),
  },
  EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION: {
    code: 'FORBIDDEN',
    message: t('tenancy.invitationEmailUnverified'),
  },
  ORGANIZATION_ALREADY_EXISTS: { code: 'CONFLICT', message: t('tenancy.slugTaken') },
  ORGANIZATION_SLUG_ALREADY_TAKEN: { code: 'CONFLICT', message: t('tenancy.slugTaken') },
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: {
    code: 'CONFLICT',
    message: t('tenancy.alreadyMember'),
  },
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: {
    code: 'CONFLICT',
    message: t('tenancy.alreadyInvited'),
  },
  ORGANIZATION_NOT_FOUND: { code: 'NOT_FOUND' },
  MEMBER_NOT_FOUND: { code: 'FORBIDDEN' },
  ROLE_NOT_FOUND: { code: 'VALIDATION_ERROR' },
  INVALID_EMAIL: { code: 'VALIDATION_ERROR' },
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION: { code: 'FORBIDDEN' },
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE: { code: 'FORBIDDEN' },
  YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION: { code: 'FORBIDDEN' },
  INVITATION_LIMIT_REACHED: { code: 'CONFLICT' },
  ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: { code: 'CONFLICT' },
}

/** Statuses Better Auth reports by name when no error key is attached. */
const BY_STATUS: Record<string, ErrorCode> = {
  BAD_REQUEST: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'RATE_LIMITED',
}

type AuthErrorBody = { code?: unknown; message?: unknown }

function bodyOf(error: unknown): AuthErrorBody {
  const body = (error as { body?: unknown }).body
  return typeof body === 'object' && body !== null ? (body as AuthErrorBody) : {}
}

/** Translates one Better Auth `APIError`; anything else is returned unchanged. */
export function fromAuthError(error: unknown): unknown {
  if (!isAPIError(error)) return error
  const body = bodyOf(error)
  const key = typeof body.code === 'string' ? body.code : undefined
  const mapped = key ? MAPPED[key] : undefined
  if (mapped) return new AppError(mapped.code, mapped.message)
  const status = typeof error.status === 'string' ? error.status : ''
  const code = BY_STATUS[status] ?? 'INTERNAL_ERROR'
  const message = typeof body.message === 'string' ? body.message : undefined
  return new AppError(code, code === 'INTERNAL_ERROR' ? undefined : message)
}

/**
 * Runs one `auth.api.*` call and rethrows its failure as an `AppError`. Every Better Auth call in
 * the service goes through this, so no Better Auth error shape reaches a route or an action.
 */
export async function callAuth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw fromAuthError(error)
  }
}
