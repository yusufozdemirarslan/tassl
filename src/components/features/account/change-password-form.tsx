'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { object, refine, string, type output } from 'zod/mini'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'
import { currentPasswordField, newPasswordField } from '@/lib/auth/form-fields'
import { t } from '@/lib/i18n/t'
import { FormAlert, SubmitButton, passwordChangeMessage } from './form-feedback'

// UI-010 Security (08 §2.8): the current password is required, the new one is 12 to 128 characters
// with no composition rules, and a successful change revokes every other session — which is stated
// on the panel before the person submits, not after.
//
// The schema is local because the input is Better Auth's, not a module's: there is no action and no
// `/api/v1` route for it, so this form is its only caller. The field shapes come from
// `@/lib/auth/form-fields`, so 12-128 is written once for every screen that sets a password.
const changePasswordSchema = object({
  currentPassword: currentPasswordField,
  newPassword: newPasswordField,
  confirmPassword: string(),
}).check(
  refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    error: t('auth.validation.passwordMismatch'),
  }),
)

type ChangePasswordValues = output<typeof changePasswordSchema>

export function ChangePasswordForm({ email }: { email: string }) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  async function onSubmit(values: ChangePasswordValues): Promise<void> {
    setFormError(null)
    const result = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    })
    if (result.error) {
      setFormError(passwordChangeMessage(result.error))
      return
    }
    reset()
    toast.success(t('settings.security.changed'))
    // The device list on this page just lost every other row; the session that stays is this one.
    router.refresh()
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
      {/*
        The account this password belongs to, for the browser's password manager. Without it Safari
        cannot tell which credential the form updates: its heuristics then clear the current-password
        field the moment the new one is filled, so the change could not be submitted at all (D-182).
        It is readonly and off-screen rather than hidden, because a display:none field is ignored.
      */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
      <div className="flex max-w-[48ch] flex-col gap-5">
        <Field data-invalid={errors.currentPassword ? 'true' : undefined}>
          <FieldLabel htmlFor="current-password">
            {t('settings.security.currentPassword')}
          </FieldLabel>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.currentPassword ? true : undefined}
            aria-describedby={errors.currentPassword ? 'current-password-error' : undefined}
            {...register('currentPassword')}
          />
          <FieldError id="current-password-error">{errors.currentPassword?.message}</FieldError>
        </Field>

        <Field data-invalid={errors.newPassword ? 'true' : undefined}>
          <FieldLabel htmlFor="new-password">{t('auth.newPassword')}</FieldLabel>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.newPassword ? true : undefined}
            aria-describedby={errors.newPassword ? 'new-password-error' : undefined}
            {...register('newPassword')}
          />
          <FieldError id="new-password-error">{errors.newPassword?.message}</FieldError>
        </Field>

        <Field data-invalid={errors.confirmPassword ? 'true' : undefined}>
          <FieldLabel htmlFor="confirm-password">{t('auth.confirmPassword')}</FieldLabel>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.confirmPassword ? true : undefined}
            aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined}
            {...register('confirmPassword')}
          />
          <FieldError id="confirm-password-error">{errors.confirmPassword?.message}</FieldError>
        </Field>

        <FormAlert message={formError} />

        <SubmitButton pending={isSubmitting}>{t('settings.security.submit')}</SubmitButton>
      </div>
    </form>
  )
}
