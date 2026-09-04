'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'
import { emailField } from '@/lib/auth/form-fields'
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

/** UI-003 asks for a 60-second cooldown between resends. */
const COOLDOWN_SECONDS = 60

/** The countdown line names itself to the resend control it sits under. */
const COOLDOWN_ID = 'verify-email-cooldown'

const resendSchema = z.object({
  email: emailField,
})

type ResendValues = z.output<typeof resendSchema>

export type VerifyEmailState = 'idle' | 'sent' | 'verified' | 'invalid'

type VerifyEmailPanelProps = {
  state: VerifyEmailState
  /** Carried from sign-up so the "sent" state can resend without asking again; null otherwise. */
  email: string | null
}

function BackToSignIn() {
  // A link standing on its own is an action: 40 px of target (DESIGN.md §Layout).
  return (
    <Link
      href="/sign-in"
      className="text-primary text-body inline-flex min-h-10 w-fit items-center underline-offset-4 hover:underline"
    >
      {t('auth.verify.backToSignIn')}
    </Link>
  )
}

// UI-003. Four states: nothing has been sent yet (a bare /verify-email), the link was just sent,
// the link worked (Better Auth signed the person in on the way through, so this only offers the
// way onward), and the link is spent or expired. Resending is deliberately identical for an
// unknown address (08 §2.1 enumeration protection).
export function VerifyEmailPanel({ state, email }: VerifyEmailPanelProps) {
  const [formError, setFormError] = useState<AuthFormError | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [sending, setSending] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResendValues>({
    resolver: zodResolver(resendSchema),
    defaultValues: { email: email ?? '' },
  })

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const resend = useCallback(async (address: string) => {
    setFormError(null)
    setStatus(null)
    setSending(true)
    const probe = retryAfterProbe()
    const result = await callAuth(() =>
      authClient.sendVerificationEmail(
        { email: address, callbackURL: VERIFY_EMAIL_CALLBACK },
        { onError: probe.onError },
      ),
    )
    setSending(false)
    // Nothing was sent, so neither the reassuring line nor the wait it starts would be honest:
    // a 5xx and a dead connection are said plainly, the 4xx refusals stay behind the same words
    // an unknown address gets, and those keep the cooldown so the two cases stay identical.
    if (result.error && isSendFailureVisible(result.error)) {
      setFormError(mapAuthError(result.error, probe.seconds))
      return
    }
    setStatus(t('auth.verify.resendSent'))
    setCooldown(COOLDOWN_SECONDS)
  }, [])

  if (state === 'verified') {
    return (
      <div className="flex flex-col items-start gap-4">
        <Link href="/home" className={buttonVariants({ variant: 'primary', size: 'md' })}>
          {t('auth.verify.continue')}
        </Link>
        <BackToSignIn />
      </div>
    )
  }

  const cooling = cooldown > 0
  const waiting = cooling || sending

  // The countdown is its own muted line rather than the control's label: inside the control it was
  // the one changing text on the screen sitting at the 45 % opacity of a disabled button.
  const cooldownNote = cooling ? (
    <p id={COOLDOWN_ID} className="text-ink-muted text-meta">
      {t('auth.verify.cooldown', { seconds: cooldown })}
    </p>
  ) : null

  return (
    <div className="flex flex-col gap-5">
      {/* Above the controls, directly under the page header. */}
      <FormAlert error={formError} />
      <FormStatus message={status} takeFocus />

      {email !== null && state === 'sent' ? (
        <div className="flex flex-col gap-2">
          {/* aria-disabled, not disabled: a disabled control loses the focus that pressed it and
              cannot be reached again to hear why the wait is on (DESIGN.md §Buttons → Disabled). */}
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            aria-disabled={waiting ? true : undefined}
            aria-busy={sending}
            aria-describedby={cooling ? COOLDOWN_ID : undefined}
            onClick={() => {
              if (waiting) return
              void resend(email)
            }}
          >
            {sending ? t('auth.verify.resendPending') : t('auth.verify.resend')}
          </Button>
          {cooldownNote}
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(event) => void handleSubmit((values) => resend(values.email))(event)}
        >
          <div className="flex flex-col gap-5">
            <Field data-invalid={errors.email ? 'true' : undefined}>
              <FieldLabel htmlFor="verify-email-address">{t('auth.email')}</FieldLabel>
              <Input
                id="verify-email-address"
                type="email"
                inputMode="email"
                autoComplete="email"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'verify-email-address-error' : undefined}
                {...register('email')}
              />
              <FieldError id="verify-email-address-error">{errors.email?.message}</FieldError>
            </Field>
            <div className="flex flex-col gap-2">
              <SubmitButton
                pending={sending}
                disabled={waiting}
                pendingLabel={t('auth.verify.resendPending')}
              >
                {t('auth.verify.resend')}
              </SubmitButton>
              {cooldownNote}
            </div>
          </div>
        </form>
      )}

      <BackToSignIn />
    </div>
  )
}
