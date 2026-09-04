// Clearing the session cookies from a Server Action (08 §2.9, D-197).
//
// Better Auth clears them itself when /sign-out succeeds, but account deletion revokes every
// session before the browser reaches that endpoint: the sign-out the dialog fires afterwards is
// answered with an error and the cookie stays in the jar. The next request then carries a cookie
// that authenticates nothing, `proxy.ts` — which only asks whether one is present — waves it
// through, and the visitor lands on a bare /sign-in with the address they wanted forgotten.
//
// The names come from Better Auth's own `getCookies`, so the `__Secure-` prefix and every attribute
// stay whatever this configuration makes them; a cookie is only replaced by an identical one when
// the attributes match, so they are copied rather than assumed.
import { cookies } from 'next/headers'
import { getCookies } from 'better-auth/cookies'
import { auth } from './auth'

export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies()
  const { sessionToken, sessionData, dontRememberToken } = getCookies(auth.options)
  for (const cookie of [sessionToken, sessionData, dontRememberToken]) {
    const { attributes } = cookie
    jar.set({
      name: cookie.name,
      value: '',
      httpOnly: attributes.httpOnly,
      path: attributes.path,
      secure: attributes.secure,
      sameSite: attributes.sameSite.toLowerCase() as 'lax' | 'strict' | 'none',
      maxAge: 0,
      ...(attributes.domain !== undefined ? { domain: attributes.domain } : {}),
    })
  }
}
