// Errors of the `identity` module (docs/tech/10-backend-spec-modules.md §1). The codes themselves
// live in the one registry (`src/lib/errors.ts`); these constructors fix their details payloads so
// every throw site carries the same shape.
import { AppError } from '@/lib/errors'

/** The data export is limited to two downloads an hour (08 §2.9); 429 with the wait in seconds. */
export function exportRateLimited(retryAfterSeconds: number): AppError {
  return new AppError('EXPORT_RATE_LIMITED', undefined, {
    details: { bucket: 'auth', retryAfterSeconds },
  })
}

/**
 * The session outlived its account (D-093): `getSession` already treats a soft-deleted user as
 * signed out, so this is the race where the row was deleted between the session read and the write.
 */
export function userDeleted(): AppError {
  return new AppError('USER_DELETED')
}
