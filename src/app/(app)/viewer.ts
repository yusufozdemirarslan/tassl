import { cache } from 'react'
import type { Route } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { SessionUser } from '@/server/auth/types'
import { getSession } from '@/server/auth/session'
import { getCurrentUser, type MeView } from '@/server/modules/identity'
import { countUnread } from '@/server/modules/notifications'

// The one session read of the `(app)` group (UI-008). `proxy.ts` sends a visitor with no session
// cookie to /sign-in before the request reaches here (08 §2.6); this is the enforcement behind that
// optimistic hop — an expired, forged, or deleted-user cookie is refused here, where the session and
// the live user row are actually checked.
//
// `cache()` makes the layout and the page of one request share a single lookup: both call
// `getViewer()`, React answers the second from the first (D-178).

export type Viewer = { actor: SessionUser; me: MeView }

export const getViewer = cache(async (): Promise<Viewer> => {
  const requestHeaders = await headers()
  const session = await getSession(requestHeaders)
  // A redirect, not `requireSession`'s UNAUTHENTICATED: a person whose session simply ended must
  // land on the sign-in screen, not on the error boundary. It carries where they were going, the
  // same way the proxy's hop does — a cookie that is present but dead never reaches the proxy's
  // branch, and losing the address there would make an expired session cost the page as well
  // (D-198). `proxy.ts` stamps x-pathname; the sign-in screen reduces it to a same-site path.
  if (!session) {
    const target = requestHeaders.get('x-pathname')
    redirect((target ? `/sign-in?next=${encodeURIComponent(target)}` : '/sign-in') as Route)
  }
  return { actor: session, me: await getCurrentUser(session) }
})

/** The bell's badge (UI-008); its own cache entry so a page that does not need it never asks. */
export const getUnreadCount = cache(async (): Promise<number> => {
  const { actor } = await getViewer()
  return countUnread(actor)
})
