// Session lookup used by defineRoute, defineAction, and every server component (08 §2.6).
//
// `import 'server-only'`: this module pulls in the Better Auth instance and the database client, so
// it must never be reachable from a client bundle.
//
// `headers` is passed in rather than read from `next/headers` so the same function serves route
// handlers (`request.headers`), Server Actions, and integration tests.
import 'server-only'
import { AppError } from '@/lib/errors'
import { auth } from '@/server/auth/auth'
import { findActorRow } from '@/server/auth/queries'
import { isPlatformRole, type SessionUser } from '@/server/auth/types'

/**
 * The signed-in actor, or null. A user whose `deleted_at` is set is treated as signed out (08 §2.6,
 * D-093): the deletion service revokes their sessions, and the 5-minute cookie cache means a
 * revoked session can still present a valid cookie, so the live `user` row decides. That lookup is
 * also what keeps `platformRole` current for the permission helpers.
 */
export async function getSession(headers: Headers): Promise<SessionUser | null> {
  // disableCookieCache: the 5-minute cookie cache (08 §1) would keep answering for a session that
  // has just been revoked — by a password reset, "sign out other devices", or a privilege change
  // (08 §2.3, §2.6) — and would serve a stale platform role. This is the re-validation point every
  // page, action, and route depends on, so it reads the session and the user row from the database.
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } })
  if (!session) return null

  const actor = await findActorRow(session.user.id)
  if (!actor || actor.deletedAt !== null) return null

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    emailVerified: session.user.emailVerified,
    activeOrganizationId: session.session.activeOrganizationId ?? null,
    platformRole: isPlatformRole(actor.platformRole) ? actor.platformRole : 'none',
  }
}

export async function requireSession(headers: Headers): Promise<SessionUser> {
  const session = await getSession(headers)
  if (!session) throw new AppError('UNAUTHENTICATED')
  return session
}
