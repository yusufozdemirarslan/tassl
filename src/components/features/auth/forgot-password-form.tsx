'use client'

import { useState } from 'react'
import Link from 'next/link'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'
import { emailField } from '@/lib/auth/form-fields'
import { t } from '@/lib/i18n/t'
import {
  FormAlert,
  FormStatus,
  SubmitButton,
  callAuth,
  isSendFailureVisible,
  mapAuthError,
  retryAfterProbe,
  type AuthFormError,
} from './auth-feedback'

const forgotPasswordSchema = z.object({
  email: emailField,
})

type ForgotPasswordValues = z.output<typeof forgotPasswordSchema>

/** Where Better Auth's `/reset-password/:token` callback lands once the token still checks out. */
const RESET_REDIRECT = '/reset-password'

// UI-004 (forgot half). Whatever Better Auth answers, the screen says the same thing: an address
// that has no account must be indistinguishable from one that has (08 §2.3). Only the rate limiter
// gets its own message, because it is about this browser, not about who has an account.
export function ForgotPasswordForm() {
  const [formError, setFormError] = useState<AuthFormError | null>(null)
  const [sent, setSent] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(values: ForgotPasswordValues) {
    setFormError(null)
    const probe = retryAfterProbe()
    const result = await callAuth(() =>
      authClient.requestPasswordReset(
        { email: values.email, redirectTo: RESET_REDIRECT },
        { onError: probe.onError },
      ),
    )
    // A 5xx or a dead connection means no email was written, so the reassuring line would be a
    // lie and the person would sit waiting for a link that is never coming; the 4xx refusals stay
    // behind it, because those are what an enumeration probe reads.
    if (result.error && isSendFailureVisible(result.error)) {
      setFormError(mapAuthError(result.error, probe.seconds))
      return
    }
    setSent(true)
  }

  return (
    <div className="flex flex-col gap-6">
      <FormStatus message={sent ? t('auth.forgot.sent') : null} takeFocus />
      {!sent && (
        <form noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
          <div className="flex flex-col gap-5">
            {/* Above the field, directly under the page header: an alert between the field and
                the submit pushed the primary action down the moment it appeared. */}
            <FormAlert error={formError} />

            <Field data-invalid={errors.email ? 'true' : undefined}>
              <FieldLabel htmlFor="forgot-email">{t('auth.email')}</FieldLabel>
              <Input
                id="forgot-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'forgot-email-error' : undefined}
                {...register('email')}
              />
              <FieldError id="forgot-email-error">{errors.email?.message}</FieldError>
            </Field>

            <SubmitButton pending={isSubmitting} pendingLabel={t('auth.forgot.submitPending')}>
              {t('auth.forgot.submit')}
            </SubmitButton>
          </div>
        </form>
      )}

      {/* A link standing on its own is an action: 40 px of target (DESIGN.md §Layout). */}
      <Link
        href="/sign-in"
        className="text-primary text-body inline-flex min-h-10 w-fit items-center underline-offset-4 hover:underline"
      >
        {t('auth.forgot.backToSignIn')}
      </Link>
    </div>
  )
}
