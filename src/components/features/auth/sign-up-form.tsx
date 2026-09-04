'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'
import { NAME_MAX_LENGTH, emailField, nameField, newPasswordField } from '@/lib/auth/form-fields'
import { t } from '@/lib/i18n/t'
import {
  FormAlert,
  SubmitButton,
  VERIFY_EMAIL_CALLBACK,
  callAuth,
  mapAuthError,
  retryAfterProbe,
  type AuthFormError,
} from './auth-feedback'

const signUpSchema = z.object({
  name: nameField,
  email: emailField,
  password: newPasswordField,
})

type SignUpValues = z.output<typeof signUpSchema>

// UI-002. An address that is already in use is answered exactly like a new one — Better Auth's
// USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL is swallowed and the person lands on the same
// "check your email" screen — so the form never tells a stranger who has an account here.
export function SignUpForm() {
  const router = useRouter()
  const [formError, setFormError] = useState<AuthFormError | null>(null)
  const [leaving, setLeaving] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', email: '', password: '' },
  })

  const pending = isSubmitting || leaving

  async function onSubmit(values: SignUpValues) {
    setFormError(null)
    const probe = retryAfterProbe()
    const result = await callAuth(() =>
      authClient.signUp.email(
        {
          name: values.name,
          email: values.email,
          password: values.password,
          callbackURL: VERIFY_EMAIL_CALLBACK,
        },
        { onError: probe.onError },
      ),
    )
    if (result.error && result.error.code !== 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
      setFormError(mapAuthError(result.error, probe.seconds))
      return
    }
    setLeaving(true)
    router.push(`/verify-email?sent=1&email=${encodeURIComponent(values.email)}` as Route)
  }

  return (
    <div className="flex flex-col gap-6">
      <form noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
        <div className="flex flex-col gap-5">
          {/* Above the fields, directly under the page header: an alert between the last field
              and the submit moved the primary action the moment it appeared. */}
          <FormAlert error={formError} />

          <Field data-invalid={errors.name ? 'true' : undefined}>
            <FieldLabel htmlFor="sign-up-name">{t('auth.name')}</FieldLabel>
            <Input
              id="sign-up-name"
              type="text"
              autoComplete="name"
              maxLength={NAME_MAX_LENGTH}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'sign-up-name-error' : undefined}
              {...register('name')}
            />
            <FieldError id="sign-up-name-error">{errors.name?.message}</FieldError>
          </Field>

          <Field data-invalid={errors.email ? 'true' : undefined}>
            <FieldLabel htmlFor="sign-up-email">{t('auth.email')}</FieldLabel>
            <Input
              id="sign-up-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'sign-up-email-error' : undefined}
              {...register('email')}
            />
            <FieldError id="sign-up-email-error">{errors.email?.message}</FieldError>
          </Field>

          <Field data-invalid={errors.password ? 'true' : undefined}>
            <FieldLabel htmlFor="sign-up-password">{t('auth.password')}</FieldLabel>
            <Input
              id="sign-up-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={
                errors.password
                  ? 'sign-up-password-hint sign-up-password-error'
                  : 'sign-up-password-hint'
              }
              {...register('password')}
            />
            <FieldDescription id="sign-up-password-hint">
              {t('auth.signUp.passwordHint')}
            </FieldDescription>
            <FieldError id="sign-up-password-error">{errors.password?.message}</FieldError>
          </Field>

          <SubmitButton pending={pending} pendingLabel={t('auth.signUp.submitPending')}>
            {t('auth.signUp.submit')}
          </SubmitButton>
        </div>
      </form>

      <p className="text-ink-muted text-body flex flex-wrap items-center gap-x-1.5">
        <span>{t('auth.signUp.haveAccount')}</span>
        <Link href="/sign-in" className="text-primary underline-offset-4 hover:underline">
          {t('auth.signUp.signIn')}
        </Link>
      </p>
    </div>
  )
}
