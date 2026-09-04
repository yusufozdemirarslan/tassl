'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
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
      await authClient.signOut()
      router.push('/sign-in')
      router.refresh()
    } finally {
      setPending(false)
    }
  }, [router])

  return { signOut, pending }
}
