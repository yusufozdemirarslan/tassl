'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { authClient } from '@/lib/auth-client'
import { currentPasswordField, emailField } from '@/lib/auth/form-fields'
import { t } from '@/lib/i18n/t'
import {
  FormAlert,
  FormStatus,
  SubmitButton,
  VERIFY_EMAIL_CALLBACK,
  callAuth,
  isSendFailureVisible,
  mapAuthError,
  retryAfterProbe,
  type AuthFormError,
} from './auth-feedback'
import { GoogleButton } from './google-button'

const signInSchema = z.object({
  email: emailField,
  password: currentPasswordField,
})

type SignInValues = z.output<typeof signInSchema>

type SignInFormProps = {
  /** Already reduced to a same-site path by the page; `/home` when the caller gave nothing. */
  next: string
  googleEnabled: boolean
}

// UI-001. Default, submitting, INVALID_EMAIL_OR_PASSWORD, EMAIL_NOT_VERIFIED (with the resend
// action), and rate limited are the five states; the message never says which field was wrong.
export function SignInForm({ next, googleEnabled }: SignInFormProps) {
  const router = useRouter()
  const [formError, setFormError] = useState<AuthFormError | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  // "Keep me signed in" carries no validation and never fails, so it stays plain React state
  // rather than a react-hook-form field whose `watch()` would opt the screen out of memoization.
  const [rememberMe, setRememberMe] = useState(true)

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })

  const pending = isSubmitting || leaving

  async function onSubmit(values: SignInValues) {
    setFormError(null)
    setStatus(null)
    const probe = retryAfterProbe()
    const result = await callAuth(() =>
      authClient.signIn.email(
        { email: values.email, password: values.password, rememberMe },
        { onError: probe.onError },
      ),
    )
    if (result.error) {
      setFormError(mapAuthError(result.error, probe.seconds))
      return
    }
    setLeaving(true)
    router.push(next as Route)
    router.refresh()
  }

  async function resendVerification() {
    setStatus(null)
    const result = await callAuth(() =>
      authClient.sendVerificationEmail({
        email: getValues('email'),
        callbackURL: VERIFY_EMAIL_CALLBACK,
      }),
    )
    // A refusal here is about an address the person has already proved they own, so the only
    // failures worth showing are the ones that mean nothing was sent (08 §2.1).
    if (result.error && isSendFailureVisible(result.error)) {
      // The address is still unconfirmed, so the alert keeps its resend action: the failure is
      // about this attempt, not about the state the person is in.
      setFormError({ ...mapAuthError(result.error), emailNotVerified: true })
      return
    }
    setFormError(null)
    setStatus(t('auth.verify.resendSent'))
  }

  return (
    <div className="flex flex-col gap-6">
      <form noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
        <div className="flex flex-col gap-5">
          {/* The form-level message sits directly under the page header, above the fields: put
              between the last field and the submit it pushed the primary action down the moment
              it appeared, under the pointer that had just been aimed at it. */}
          <FormAlert
            error={formError}
            action={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void resendVerification()}
              >
                {t('auth.error.resendVerification')}
              </Button>
            }
          />
          <FormStatus message={status} />

          <Field data-invalid={errors.email ? 'true' : undefined}>
            <FieldLabel htmlFor="sign-in-email">{t('auth.email')}</FieldLabel>
            <Input
              id="sign-in-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'sign-in-email-error' : undefined}
              {...register('email')}
            />
            <FieldError id="sign-in-email-error">{errors.email?.message}</FieldError>
          </Field>

          <Field data-invalid={errors.password ? 'true' : undefined}>
            <FieldLabel htmlFor="sign-in-password">{t('auth.password')}</FieldLabel>
            <Input
              id="sign-in-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? 'sign-in-password-error' : undefined}
              {...register('password')}
            />
            <FieldError id="sign-in-password-error">{errors.password?.message}</FieldError>
          </Field>

          {/* Base UI names the toggle from the label only after hydration, so the checkbox also
              points at the label by id (DESIGN.md §Inputs / Fields → Toggles). */}
          <Field orientation="horizontal">
            <Checkbox
              id="sign-in-remember"
              name="rememberMe"
              aria-labelledby="sign-in-remember-label"
              checked={rememberMe}
              onCheckedChange={setRememberMe}
            />
            <FieldLabel id="sign-in-remember-label" htmlFor="sign-in-remember">
              {t('auth.signIn.rememberMe')}
            </FieldLabel>
          </Field>

          <SubmitButton pending={pending} pendingLabel={t('auth.signIn.submitPending')}>
            {t('auth.signIn.submit')}
          </SubmitButton>
        </div>
      </form>

      {googleEnabled && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-ink-muted text-meta">{t('auth.or')}</span>
            <Separator className="flex-1" />
          </div>
          <GoogleButton callbackURL={next} />
        </div>
      )}

      <div className="text-body flex flex-col">
        {/* A link that stands on its own is an action, so it carries the 40 px target of
            DESIGN.md §Layout; the links inside a sentence below stay inline text. */}
        <Link
          href="/forgot-password"
          className="text-primary inline-flex min-h-10 w-fit items-center underline-offset-4 hover:underline"
        >
          {t('auth.signIn.forgot')}
        </Link>
        <p className="text-ink-muted flex flex-wrap items-center gap-x-1.5">
          <span>{t('auth.signIn.noAccount')}</span>
          <Link href="/sign-up" className="text-primary underline-offset-4 hover:underline">
            {t('auth.signIn.createAccount')}
          </Link>
        </p>
      </div>
    </div>
  )
}
