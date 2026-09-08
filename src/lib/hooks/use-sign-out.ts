'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { resetClient } from '@/lib/analytics/client'
import { authClient } from '@/lib/auth-client'

// One sign-out for every control that offers it (the account menu, the invitation screen's "use
// another account", the account-deletion dialog): revoke the session through Better Auth, then send
// the browser to /sign-in and refresh so no server-rendered fragment of the signed-in shell
// survives in the router cache.
export function useSignOut(): { signOut: () => Promise<void>; pending: boolean } {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const signOut = useCallback(async () => {
    setPending(true)
    try {
      // Before the session goes: the next person on this browser must get a fresh anonymous id
      // rather than inherit this one's (17 §5.5).
      await resetClient()
      await authClient.signOut()
      router.push('/sign-in')
      router.refresh()
    } finally {
      setPending(false)
    }
  }, [router])

  return { signOut, pending }
}
