'use server'

// Server Actions of the `identity` module (docs/tech/08-auth-authz.md §3, 10-backend-spec.md §2).
// The account screens call these; they validate with the module's schema, return
// `ActionResult<T>`, and never throw to the client. No permission logic lives here.
import { AppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { defineAction } from '@/server/http/define-action'
import {
  confirmAccountDeletionSchema,
  updateProfileSchema,
  type ConfirmAccountDeletionInput,
  type MeView,
  type UpdateProfileInput,
} from './schema'
import { clearSessionCookies } from '@/server/auth/session-cookies'
import { requestAccountDeletion, updateProfile } from './service'

/** UI-010 profile form (SYS-003); the shell shows the new name after the revalidate. */
export const updateProfileAction = defineAction<UpdateProfileInput, MeView>(
  updateProfileSchema,
  async (input, ctx) => {
    const data = await updateProfile(ctx.actor, input)
    return { data, revalidate: ['/settings', '/home'] }
  },
  { name: 'identity.updateProfile' },
)

/**
 * UI-010 deletion dialog (SYS-004, 08 §2.9). The typed address is checked against the session here,
 * where the session is known; the service revokes every session, so the next request lands on the
 * public pages.
 */
export const requestAccountDeletionAction = defineAction<
  ConfirmAccountDeletionInput,
  { deleted: true }
>(
  confirmAccountDeletionSchema,
  async (input, ctx) => {
    if (input.email.trim().toLowerCase() !== ctx.actor.email.toLowerCase()) {
      throw new AppError('VALIDATION_ERROR', t('identity.confirmEmailMismatch'), {
        details: { field: 'email' },
      })
    }
    await requestAccountDeletion(ctx.actor)
    // The account is closed and every session with it, so the sign-out the dialog fires next has
    // nothing left to authenticate and cannot clear the cookie itself: this response does (D-197).
    await clearSessionCookies()
    return { data: { deleted: true }, revalidate: ['/', '/home', '/settings'] }
  },
  { name: 'identity.requestAccountDeletion' },
)
