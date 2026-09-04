'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { CircleAlertIcon, Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n/t'

/**
 * What Better Auth's client actually hands back (08 §2; verified against better-auth 1.7.2 and
 * @better-fetch/fetch 1.3.1): every call resolves to `{ data, error }` — never throws — and the
 * error carries `status`, `statusText`, the human `message`, and, for the coded refusals, `code`,
 * one of `BASE_ERROR_CODES` (`INVALID_EMAIL_OR_PASSWORD` 401, `EMAIL_NOT_VERIFIED` 403,
 * `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` 422, `INVALID_TOKEN` / `TOKEN_EXPIRED` 400 …).
 *
 * The rate limiter is the exception: it answers 429 with **no** code and puts the wait in the
 * `X-Retry-After` response header (`api/rate-limiter/index.mjs`), which only a fetch hook can read
 * — hence `retryAfterProbe`.
 */
export type AuthClientError = {
  code?: string | undefined
  message?: string | undefined
  status: number
  statusText: string
}

export type AuthFormError = {
  /** The one sentence rendered under the form. */
  message: string
  /** Sign-in only: the password matched but the address is unconfirmed, so offer a resend. */
  emailNotVerified: boolean
}

/**
 * The one failure Better Auth does *not* fold into `{ data, error }`: when the fetch itself never
 * completes (offline, DNS, a dropped connection, a blocked request) the promise rejects, so an
 * unwrapped `await` leaves the form with an empty alert and a re-enabled button while the
 * rejection escapes to `window.onerror`. `callAuth` turns that into the same shape with
 * `status: 0`, which has no `code` and so falls to `mapAuthError`'s generic message.
 */
export async function callAuth<T>(
  run: () => Promise<T>,
): Promise<T | { data: null; error: AuthClientError }> {
  try {
    return await run()
  } catch {
    return { data: null, error: { status: 0, statusText: 'Network Error' } }
  }
}

/**
 * Whether a failed send may be shown to the person or must stay behind the reassuring copy.
 * A server error (5xx) and a transport failure (`status: 0`, from `callAuth`) are told plainly:
 * nothing was sent, so "we sent you a link" would be a lie and the wait would be for nothing. The
 * 4xx refusals stay hidden, because "no such account" and "already confirmed" are exactly what an
 * enumeration probe asks for (08 §2.1); the rate limiter (429) is about this browser rather than
 * about the address, so it is shown too.
 */
export function isSendFailureVisible(error: AuthClientError): boolean {
  return error.status === 0 || error.status === 429 || error.status >= 500
}

/** Where Better Auth sends people once the emailed confirmation link is spent (UI-003). */
export const VERIFY_EMAIL_CALLBACK = '/verify-email?verified=1'

export type RetryAfterProbe = {
  /** Seconds from `X-Retry-After`, filled in by `onError` before the call resolves. */
  seconds: number | null
  onError: (context: { response: Response }) => void
}

/**
 * Pass `probe.onError` as the call's `fetchOptions.onError` and read `probe.seconds` afterwards:
 * the hook runs before the promise resolves, so the header is available when the error is mapped.
 */
export function retryAfterProbe(): RetryAfterProbe {
  const probe: RetryAfterProbe = {
    seconds: null,
    onError: ({ response }) => {
      const header = response.headers.get('X-Retry-After')
      const parsed = header === null ? Number.NaN : Number(header)
      probe.seconds = Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : null
    },
  }
  return probe
}

/**
 * One message per refusal, never naming which field was wrong (UI-001): a wrong address and a wrong
 * password are indistinguishable to the person reading it, as they are to Better Auth.
 */
export function mapAuthError(
  error: AuthClientError,
  retryAfterSeconds: number | null = null,
): AuthFormError {
  if (error.status === 429) {
    return {
      message:
        retryAfterSeconds === null
          ? t('auth.error.rateLimitedNoSeconds')
          : t('auth.error.rateLimited', { seconds: retryAfterSeconds }),
      emailNotVerified: false,
    }
  }
  switch (error.code) {
    case 'EMAIL_NOT_VERIFIED':
      return { message: t('auth.error.emailNotVerified'), emailNotVerified: true }
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_EMAIL':
    case 'INVALID_PASSWORD':
    case 'USER_NOT_FOUND':
      return { message: t('auth.error.invalidEmailOrPassword'), emailNotVerified: false }
    case 'PASSWORD_TOO_SHORT':
    case 'PASSWORD_TOO_LONG':
      return { message: t('auth.validation.passwordLength'), emailNotVerified: false }
    case 'INVALID_TOKEN':
    case 'TOKEN_EXPIRED':
      return { message: t('auth.error.linkExpired'), emailNotVerified: false }
    default:
      return { message: t('auth.error.generic'), emailNotVerified: false }
  }
}

/**
 * The form-level message. The region is always in the tree so the assistive announcement fires on
 * the content change rather than on the insertion of the region itself; `empty:sr-only` collapses
 * it visually while an empty region stays in the accessibility tree — `display: none` would take
 * it out until it had content, which is precisely when the announcement is needed (WCAG 4.1.3).
 */
export function FormAlert({ error, action }: { error: AuthFormError | null; action?: ReactNode }) {
  return (
    <div role="alert" className="empty:sr-only">
      {error && (
        <div className="border-red bg-red-soft text-ink text-body flex items-start gap-2 rounded-md border p-3">
          <CircleAlertIcon aria-hidden="true" className="text-red mt-0.5 size-4 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <p>{error.message}</p>
            {error.emailNotVerified && action}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The polite counterpart: confirmations that must not interrupt (a resent link, a sent reset).
 * `takeFocus` is for the case where the confirmation replaces the form that was focused, so the
 * keyboard does not fall back to the top of the document.
 */
export function FormStatus({
  message,
  takeFocus = false,
}: {
  message: string | null
  takeFocus?: boolean
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (takeFocus && message !== null) ref.current?.focus()
  }, [takeFocus, message])

  return (
    <div role="status" className="empty:sr-only">
      {message && (
        <p
          ref={ref}
          tabIndex={takeFocus ? -1 : undefined}
          className="border-line bg-primary-soft text-ink text-body focus-visible:outline-focus rounded-md border p-3 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {message}
        </p>
      )}
    </div>
  )
}

/**
 * Full-width submit (UI-001 states). `pending` is the call in flight and owns the spinner and
 * `aria-busy`; `disabled` is every other reason the control cannot be pressed (the resend
 * cooldown), so a 60-second wait no longer reads as a 60-second request. `pendingLabel` swaps the
 * label while the call runs: under `prefers-reduced-motion` that wording, not the spinner, is what
 * tells the person the form is still working (DESIGN.md §Motion).
 */
export function SubmitButton({
  pending,
  disabled,
  pendingLabel,
  children,
}: {
  pending: boolean
  disabled?: boolean | undefined
  pendingLabel?: string | undefined
  children: ReactNode
}) {
  return (
    <Button type="submit" className="w-full" disabled={disabled ?? pending} aria-busy={pending}>
      {pending && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
      {pending && pendingLabel !== undefined ? pendingLabel : children}
    </Button>
  )
}
