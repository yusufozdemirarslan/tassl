'use client'
// `error_shown` (docs/tech/17-analytics-events.md §3.6, SYS-008, SYS-022).
//
// Rendered by every `error.tsx` boundary and by `global-error.tsx`. It draws nothing: the error
// screen is `ErrorState`, and this is the one line of analytics that goes with it. What travels is
// the error code, the status when there is one, and the *route template* — never the digest, never
// the message, never the concrete path.
import { useEffect } from 'react'
import { useParams, usePathname } from 'next/navigation'
import { trackClient } from '@/lib/analytics/client'
import { toRouteTemplate } from '@/lib/analytics/route-template'

export function ErrorShown({
  code = 'INTERNAL_ERROR',
  status = null,
}: {
  code?: string
  status?: number | null
}) {
  // `global-error.tsx` replaces the root layout, so both hooks can answer null there; and nothing
  // on an error page may itself throw — a failed analytics call must not cost the reader the one
  // screen that was still working.
  const pathname = usePathname() as string | null
  const params = useParams() as Record<string, string | string[] | undefined> | null

  useEffect(() => {
    // Analytics never changes what the reader sees (17 §1.6), so the promise is dropped and its
    // rejection with it: a failed event must not cost the reader the one screen still working.
    void trackClient('error_shown', {
      code,
      status,
      route: toRouteTemplate(pathname ?? '/', params ?? {}),
    }).catch(() => {})
    // The boundary is remounted for each error, so one event per error is one event per mount.
  }, [code, status, pathname, params])

  return null
}
