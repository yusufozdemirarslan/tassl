'use client'

import type { ReactNode } from 'react'
import { CircleAlertIcon, Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n/t'

// The account screens (UI-010) show three kinds of feedback: a refusal under the form, a
// confirmation that must not interrupt, and a submit button that says it is working.
//
// Both regions stay mounted and collapse when empty (`empty:hidden`), so the assistive announcement
// fires on the content change rather than on the insertion of the region itself.

export function FormAlert({ message, action }: { message: string | null; action?: ReactNode }) {
  return (
    <div role="alert" className="empty:hidden">
      {message !== null && (
        <div className="border-red bg-red-soft text-ink text-body flex items-start gap-2 rounded-md border p-3">
          <CircleAlertIcon aria-hidden="true" className="text-red mt-0.5 size-4 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <p>{message}</p>
            {action}
          </div>
        </div>
      )}
    </div>
  )
}

export function FormStatus({ message }: { message: string | null }) {
  return (
    <div role="status" className="empty:hidden">
      {message !== null && (
        <p className="border-line bg-primary-soft text-ink text-body rounded-md border p-3">
          {message}
        </p>
      )}
    </div>
  )
}

/**
 * The submit control of every form on the instructor and account screens.
 *
 * `aria-disabled`, never `disabled`: the browser blurs a control the moment it becomes disabled,
 * and nothing here takes the focus back, so every submit dropped a keyboard or screen-reader user
 * at the top of the document — precisely when the refusal they need to read is being announced
 * under the form. The resend control on UI-003 already avoids this, and DESIGN.md §Buttons →
 * Disabled asks for `aria-disabled` wherever a control has to stay reachable while it is refusing.
 *
 * The early return in the click handler is what `disabled` used to do: a press while the request is
 * in flight is swallowed before the form hears it, so the guard is the handler rather than the
 * browser. The control keeps its focus, its 45 % opacity (the base recipe styles `aria-disabled`
 * exactly as it styles `disabled`), and the `aria-busy` its spinner belongs to.
 */
export function SubmitButton({
  pending,
  children,
  variant = 'primary',
}: {
  pending: boolean
  children: ReactNode
  variant?: 'primary' | 'destructive'
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      aria-disabled={pending ? true : undefined}
      aria-busy={pending}
      onClick={(event) => {
        if (pending) event.preventDefault()
      }}
      className="w-fit"
    >
      {pending && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
      {children}
    </Button>
  )
}

/**
 * What Better Auth's client hands back on a refusal (08 §2): `{ status, code?, message? }`, never a
 * throw. The account screens only reach two of its endpoints, so the mapping is small and says what
 * the person can do about it; anything else is the generic sentence rather than a raw library
 * string.
 */
export function passwordChangeMessage(error: {
  code?: string | undefined
  status: number
}): string {
  if (error.status === 429) return t('auth.error.rateLimitedNoSeconds')
  switch (error.code) {
    case 'INVALID_PASSWORD':
    case 'INVALID_EMAIL_OR_PASSWORD':
      return t('settings.security.wrongPassword')
    case 'PASSWORD_TOO_SHORT':
    case 'PASSWORD_TOO_LONG':
      return t('auth.validation.passwordLength')
    default:
      return t('auth.error.generic')
  }
}
