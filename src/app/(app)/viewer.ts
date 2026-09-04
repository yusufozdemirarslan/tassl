import { cache } from 'react'
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
  const session = await getSession(await headers())
  // A redirect, not `requireSession`'s UNAUTHENTICATED: a person whose session simply ended must
  // land on the sign-in screen, not on the error boundary.
  if (!session) redirect('/sign-in')
  return { actor: session, me: await getCurrentUser(session) }
})

/** The bell's badge (UI-008); its own cache entry so a page that does not need it never asks. */
export const getUnreadCount = cache(async (): Promise<number> => {
  const { actor } = await getViewer()
  return countUnread(actor)
})
