'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { t } from '@/lib/i18n/t'
import { FormAlert, callAuth, mapAuthError, type AuthFormError } from './auth-feedback'

/**
 * UI-001: rendered only when the page passes `googleEnabled` — the server component reads
 * `env.GOOGLE_CLIENT_ID` (D-097), because a client component may never import `@/server/config`.
 * A successful call navigates away to Google, so `pending` is never cleared on the happy path.
 */
export function GoogleButton({ callbackURL }: { callbackURL: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthFormError | null>(null)

  async function start() {
    setError(null)
    setPending(true)
    const result = await callAuth(() =>
      authClient.signIn.social({ provider: 'google', callbackURL }),
    )
    if (result.error) {
      setError(mapAuthError(result.error))
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <FormAlert error={error} />
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={pending}
        aria-busy={pending}
        onClick={() => void start()}
      >
        {t('auth.signIn.google')}
      </Button>
    </div>
  )
}
