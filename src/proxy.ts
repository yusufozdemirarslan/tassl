// Request proxy (Next.js 16 `proxy.ts`): stamps x-request-id on the forwarded request and on the
// response (D-086), sets the baseline security headers, and sends anonymous visitors on an `(app)`
// path to /sign-in. The nonce-based CSP and the remaining static headers arrive in Phase 13
// (docs/tech/12-security.md §4).
//
// The session check here is optimistic (08 §2.6): it only asks whether a session cookie is present,
// never whether it is valid. Every page, Server Action, and route re-validates with getSession(),
// which is where a forged, expired, or deleted-user cookie is actually rejected.
import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { getOrCreateRequestId } from '@/server/logging/request-id'

/** Top-level segments of the `(app)` route group (docs/tech/09-frontend-spec-screens.md §Shell). */
const APP_PATHS = [
  '/home',
  '/runs',
  '/courses',
  '/review',
  '/packages',
  '/admin',
  '/settings',
  '/notifications',
  '/invitations',
] as const

const isAppPath = (pathname: string): boolean =>
  APP_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))

function withBaselineHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-Frame-Options', 'DENY')
  return response
}

export function proxy(request: NextRequest) {
  const requestId = getOrCreateRequestId(request.headers)
  const { pathname, search } = request.nextUrl

  if (isAppPath(pathname) && !getSessionCookie(request)) {
    const signIn = new URL('/sign-in', request.url)
    signIn.searchParams.set('next', `${pathname}${search}`)
    return withBaselineHeaders(NextResponse.redirect(signIn), requestId)
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)
  // Where this request was going, for the guard behind the optimistic hop above: a cookie that is
  // present but dead (expired, forged, or a deleted account) reaches the page, and getViewer() has
  // no other way to name the address it is turning away (D-198).
  requestHeaders.set('x-pathname', `${pathname}${search}`)

  return withBaselineHeaders(NextResponse.next({ request: { headers: requestHeaders } }), requestId)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts).*)'],
}
