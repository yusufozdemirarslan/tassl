'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { resetClient } from '@/lib/analytics/client'
import { authClient } from '@/lib/auth-client'
import { t } from '@/lib/i18n/messages/shell'
import { toastError } from '@/lib/toast'
import { useRefresh } from '@/lib/hooks/use-refresh'

// One sign-out for every control that offers it (the account menu, the invitation screen's "use
// another account", the account-deletion dialog): revoke the session through Better Auth, then send
// the browser to /sign-in and refresh so no server-rendered fragment of the signed-in shell
// survives in the router cache.
//
// **A refused sign-out stays on the page and says so.** Better Auth answers `{ error }` rather than
// throwing, and a hook that pushed /sign-in regardless sent a still-signed-in person to a screen
// whose first act is to bounce them back to /home — a round trip that looked like a sign-out and
// was not one. The toast is the one place the failure can be reported, because every control that
// calls this has already closed or is about to unmount.
export function useSignOut(): { signOut: () => Promise<void>; pending: boolean } {
  const router = useRouter()
  const refresh = useRefresh()
  const [pending, setPending] = useState(false)

  const signOut = useCallback(async () => {
    setPending(true)
    try {
      // Before the session goes: the next person on this browser must get a fresh anonymous id
      // rather than inherit this one's (17 §5.5).
      await resetClient()
      const { error } = await authClient.signOut()
      if (error) {
        toastError(t('shell.signOutFailed'))
        return
      }
      router.push('/sign-in')
      refresh()
    } catch {
      // The request never reached Better Auth; the session is still live, so the page stays.
      toastError(t('shell.signOutFailed'))
    } finally {
      setPending(false)
    }
  }, [router, refresh])

  return { signOut, pending }
}
