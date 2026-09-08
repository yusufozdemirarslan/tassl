'use client'
// The one helper that raises the toast for an `ActionResult` failure (17 §3.6).
//
// A Server Action never throws to the client; it answers `{ ok: false, error }` with the envelope's
// code and a message already written for a person to read (10 §2). Every screen that shows that
// message as a toast now goes through here, so the `error_shown` event fires once, with the same
// three properties the error boundaries send, and no screen has to remember to add it.
import { useCallback } from 'react'
import { useParams, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { trackClient } from '@/lib/analytics/client'
import { toRouteTemplate } from '@/lib/analytics/route-template'
import type { ErrorBody } from '@/lib/errors'

export function useActionErrorToast(): (error: ErrorBody) => void {
  const pathname = usePathname()
  const params = useParams()

  return useCallback(
    (error: ErrorBody) => {
      // The toast first, and the event inside a guard: analytics never changes control flow
      // (17 §1.6), and a screen that could not report a refusal must still show it.
      toast.error(error.message)
      void trackClient('error_shown', {
        code: error.code,
        status: null,
        route: toRouteTemplate(pathname, params),
      }).catch(() => {})
    },
    [pathname, params],
  )
}
