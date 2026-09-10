// Request proxy (Next.js 16 `proxy.ts`): mints the per-request CSP nonce and the request id, sets
// the Content-Security-Policy of docs/tech/12-security.md §4 on the request and on the response,
// and sends anonymous visitors on an `(app)` path to /sign-in.
//
// The static headers of 12 §4.1 — HSTS, nosniff, referrer, permissions, frame, COOP, CORP — are not
// here. `next.config.ts` `headers()` sets them once, on `/(.*)`, which covers the paths this file's
// matcher deliberately skips (`/api/health`, `/ingest/*`, `/_next/static/*`) as well as the ones it
// does not. Setting them in both places would have put two values on one response name.
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
  '/records',
  '/assignments',
] as const

const isAppPath = (pathname: string): boolean =>
  APP_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))

/** The four values of `APP_ENV` (05-environment-config.md §1). */
export type AppEnv = 'local' | 'test' | 'preview' | 'production'

const appEnvOf = (value: string | undefined): AppEnv =>
  value === 'test' || value === 'preview' || value === 'production' ? value : 'local'

/**
 * The Content-Security-Policy of 12 §4.1, for one request's nonce.
 *
 * `appEnv` is a parameter with a default rather than a module constant so the two strings 12 §4.5
 * pins can be asserted as values instead of through a module reset — a CSP whose test has to
 * re-import the module to see a second environment is a CSP with one environment tested.
 *
 * Three directives are the whole of the policy's judgement, and each is written down where it is
 * decided rather than in a table somewhere else:
 *
 *   * `script-src 'self' 'nonce-…' 'strict-dynamic'` — Next.js reads the nonce off the
 *     `Content-Security-Policy` *request* header this file sets and stamps its own bootstrap
 *     scripts with it; everything those scripts then load is trusted transitively. `'self'` is the
 *     fallback for a browser without CSP3, which ignores `'strict-dynamic'`. There is no
 *     third-party script host to name: `posthog-js` and `@sentry/nextjs` are bundled from npm, and
 *     PostHog is initialized with `disable_external_dependency_loading: true`, so it fetches no
 *     script of its own (`src/instrumentation-client.ts`).
 *   * `style-src 'self' 'unsafe-inline'` — recharts writes `style` attributes onto SVG nodes and
 *     sonner onto toasts, and no nonce can cover an attribute (D-115). Tailwind's output is a
 *     linked stylesheet. 12 §10 holds the tightening to `style-src-elem`.
 *   * `connect-src 'self'` — every destination the browser opens is this origin: PostHog ingest
 *     through the `/ingest` rewrite, Sentry through the `/sentry-tunnel` route, the five-second run
 *     poll, and the delegation stream. `ws://localhost:*` is added under `local` alone, for the dev
 *     server's HMR socket, and `'unsafe-eval'` likewise, for React's dev-time stack reconstruction.
 */
export function buildCsp(nonce: string, appEnv: AppEnv = appEnvOf(process.env.APP_ENV)): string {
  const isLocal = appEnv === 'local'
  const scriptSrc = [
    `'self'`,
    `'nonce-${nonce}'`,
    `'strict-dynamic'`,
    ...(isLocal ? [`'unsafe-eval'`] : []),
  ]
  const connectSrc = [`'self'`, ...(isLocal ? ['ws://localhost:*'] : [])]
  return [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(' ')}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src ${connectSrc.join(' ')}`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `media-src 'none'`,
    `object-src 'none'`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // Only production is served over https on a domain of its own; a preview deploy and the local
    // and test servers would upgrade a request they cannot answer.
    ...(appEnv === 'production' ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}

export function proxy(request: NextRequest) {
  const requestId = getOrCreateRequestId(request.headers)
  // 16 base64 characters of a v4 UUID: unguessable per request, which is the whole security
  // property a nonce has (Next's own guide mints it exactly this way).
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce)
  const { pathname, search } = request.nextUrl

  if (isAppPath(pathname) && !getSessionCookie(request)) {
    const signIn = new URL('/sign-in', request.url)
    signIn.searchParams.set('next', `${pathname}${search}`)
    const redirect = NextResponse.redirect(signIn)
    redirect.headers.set('Content-Security-Policy', csp)
    redirect.headers.set('x-request-id', requestId)
    return redirect
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)
  // Next.js parses this *request* header for `'nonce-…'` and applies what it finds to the scripts
  // it renders; `x-nonce` is the same value in the form a Server Component reads (`src/app/nonce.ts`).
  requestHeaders.set('Content-Security-Policy', csp)
  requestHeaders.set('x-nonce', nonce)
  // Where this request was going, for the guard behind the optimistic hop above: a cookie that is
  // present but dead (expired, forged, or a deleted account) reaches the page, and getViewer() has
  // no other way to name the address it is turning away (D-198).
  requestHeaders.set('x-pathname', `${pathname}${search}`)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('x-request-id', requestId)
  return response
}

// The matcher of 17-analytics-events.md §5.7, applied here as D-569 left it for whoever next
// touched this file. The four additions are all requests that must reach their handler untouched:
// `/ingest/*` is the PostHog reverse proxy (§5.7) and carries no session, so a request id and a
// nonce on it are noise on someone else's endpoint; `api/auth` is Better Auth's own handler, which
// sets the cookies this proxy only reads; and `api/health` and `api/ready` are the uptime probes of
// 13 §4, which must answer the same way whether or not a session cookie is present. `favicon.ico`
// is dropped rather than kept beside `favicon.svg`: the project ships no favicon of either
// extension (no `src/app/icon.*`, no `public/favicon.*`) and nothing refers to one, and a pattern
// the spec does not list is how this line and §5.7 drift apart again (D-602).
//
// `/sentry-tunnel` is *not* excluded, and does not need to be: it is a route the Sentry SDK
// injects into this app, same-origin, and a CSP header on its response costs it nothing.
export const config = {
  matcher: [
    '/((?!api/auth|api/health|api/ready|ingest|_next/static|_next/image|fonts|favicon.svg).*)',
  ],
}
