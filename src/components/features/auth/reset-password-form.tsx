'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { object, refine, string, type output } from 'zod/mini'
import { buttonVariants } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'
import { newPasswordField } from '@/lib/auth/form-fields'
import { t } from '@/lib/i18n/t'
import {
  FormAlert,
  SubmitButton,
  callAuth,
  mapAuthError,
  retryAfterProbe,
  type AuthFormError,
} from './auth-feedback'

const resetPasswordSchema = object({
  password: newPasswordField,
  confirmPassword: string(),
}).check(
  refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    error: t('auth.validation.passwordMismatch'),
  }),
)

type ResetPasswordValues = output<typeof resetPasswordSchema>

// UI-004 (reset half). The token comes from Better Auth's `/reset-password/:token` redirect, which
// has already checked that it exists and has not expired; a token that dies between that redirect
// and this submit comes back as INVALID_TOKEN and is shown as an expired link.
export function ResetPasswordForm({ token }: { token: string }) {
  const [formError, setFormError] = useState<AuthFormError | null>(null)
  const [done, setDone] = useState(false)
  const doneRef = useRef<HTMLDivElement>(null)

  // The confirmation replaces the form the keyboard was in, so focus is moved onto it rather than
  // left on a removed node, where the browser drops it to the top of the document (WCAG 2.4.3).
  useEffect(() => {
    if (done) doneRef.current?.focus()
  }, [done])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  async function onSubmit(values: ResetPasswordValues) {
    setFormError(null)
    const probe = retryAfterProbe()
    const result = await callAuth(() =>
      authClient.resetPassword({ newPassword: values.password, token }, { onError: probe.onError }),
    )
    if (result.error) {
      setFormError(mapAuthError(result.error, probe.seconds))
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="flex flex-col items-start gap-4">
        <div
          ref={doneRef}
          role="status"
          tabIndex={-1}
          className="focus-visible:outline-focus flex flex-col gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <h2 className="text-h3">{t('auth.reset.successTitle')}</h2>
          <p className="text-ink-muted text-body">{t('auth.reset.successBody')}</p>
        </div>
        <Link href="/sign-in" className={buttonVariants({ variant: 'primary', size: 'md' })}>
          {t('auth.reset.signIn')}
        </Link>
      </div>
    )
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
      <div className="flex flex-col gap-5">
        {/* Above the fields, directly under the page header: an alert between the last field and
            the submit pushed the primary action down the moment it appeared. */}
        <FormAlert error={formError} />

        <Field data-invalid={errors.password ? 'true' : undefined}>
          <FieldLabel htmlFor="reset-password">{t('auth.newPassword')}</FieldLabel>
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={
              errors.password ? 'reset-password-hint reset-password-error' : 'reset-password-hint'
            }
            {...register('password')}
          />
          <FieldDescription id="reset-password-hint">
            {t('auth.signUp.passwordHint')}
          </FieldDescription>
          <FieldError id="reset-password-error">{errors.password?.message}</FieldError>
        </Field>

        <Field data-invalid={errors.confirmPassword ? 'true' : undefined}>
          <FieldLabel htmlFor="reset-password-confirm">{t('auth.confirmPassword')}</FieldLabel>
          <Input
            id="reset-password-confirm"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.confirmPassword ? true : undefined}
            aria-describedby={errors.confirmPassword ? 'reset-password-confirm-error' : undefined}
            {...register('confirmPassword')}
          />
          <FieldError id="reset-password-confirm-error">
            {errors.confirmPassword?.message}
          </FieldError>
        </Field>

        <SubmitButton pending={isSubmitting} pendingLabel={t('auth.reset.submitPending')}>
          {t('auth.reset.submit')}
        </SubmitButton>
      </div>
    </form>
  )
}
