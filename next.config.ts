import type { NextConfig } from 'next'
// `@sentry/nextjs` re-exports this, but that path is deprecated and stops working in v11.
import { withSentryConfig } from '@sentry/nextjs/config'

// The authoritative listing of this file is docs/tech/12-security.md §4.3; the Sentry keys are
// owned by 13-observability-ops.md §3.6 and the `/ingest` rewrites by 17-analytics-events.md §5.7.

/**
 * The static half of 12 §4.1: every header whose value does not change from request to request.
 *
 * They are set here rather than in `src/proxy.ts` because `headers()` runs on `/(.*)` — every
 * response, including the paths the proxy's matcher skips (`/api/health`, `/ingest/*`,
 * `/_next/static/*`, `/fonts/*`) and the static assets a proxy should not be woken for. The one
 * header that cannot join them is the CSP, which carries a per-request nonce.
 */
const securityHeaders = [
  // Two years, subdomains included, and preload-eligible. Browsers ignore it on plain http, so it
  // is harmless on localhost and correct the moment the response is served over TLS.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // `frame-ancestors 'none'` in the CSP says the same thing to a modern browser; this is the half
  // an old one understands, and Tassl is embedded nowhere.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
] as const

/**
 * The release both halves of Sentry report under. `SENTRY_RELEASE` is the merge commit SHA exported
 * by production.yml on the build step (D-121); `VERCEL_GIT_COMMIT_SHA` is the fallback for a deploy
 * that kept its git metadata. Inlining it (rather than reading it at runtime) is what keeps the
 * runtime release equal to the one the source maps were uploaded under, because production.yml
 * detaches `.git` before `vercel deploy` and Vercel therefore sets no commit variables (D-563).
 */
const release = process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? ''

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  serverExternalPackages: ['pino', 'pino-pretty'],
  // PostHog's ingest endpoints end in a slash (`/ingest/e/`, `/ingest/batch/`); without this Next
  // answers them with a 308 the SDK does not follow (17 §5.7).
  skipTrailingSlashRedirect: true,
  // The browser cannot read a name that is not NEXT_PUBLIC_, and the Sentry client SDK needs all
  // three. They are non-secret by construction: an environment name, a sample rate, and a git SHA.
  env: {
    APP_ENV: process.env.APP_ENV ?? 'local',
    SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE ?? '1',
    SENTRY_RELEASE: release,
  },
  // 12 §4.1 (the security headers) and 16 §7.2 (the cache rules). Order matters only in that every
  // matching rule is applied: a request for `/fonts/IBMPlexSans-Regular.woff2` gets the seven
  // security headers *and* the immutable cache line.
  async headers() {
    return [
      { source: '/(.*)', headers: [...securityHeaders] },
      // Hashed by content in their own names and never rewritten (16 §7.1). `next/font/local`
      // serves its own copies from `/_next/static/media`, which Next already marks immutable;
      // this rule is for the files as `public/` publishes them.
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      // 16 §7.1: nothing under /api is cacheable. `defineRoute` says the same on every envelope it
      // writes; this covers the handlers that are not `defineRoute` — Better Auth's `/api/auth/*`
      // above all, which sets session cookies and must never be held by an intermediary.
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ]
  },
  // Reverse proxy for PostHog (D-115, D-119): the browser only ever talks to this origin, so the
  // CSP keeps `connect-src 'self'` and `script-src 'self'` with no analytics host in either.
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
    ]
  },
}

// `exactOptionalPropertyTypes` is on, so an absent value is an absent key, never `undefined`.
const authToken = process.env.SENTRY_AUTH_TOKEN ?? ''
const org = process.env.SENTRY_ORG ?? ''

export default withSentryConfig(config, {
  ...(org ? { org } : {}),
  project: process.env.SENTRY_PROJECT ?? 'tassl',
  ...(authToken ? { authToken } : {}),
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/sentry-tunnel',
  release: {
    ...(release ? { name: release } : {}),
    // Without a token there is nothing to authenticate a release with; the build must still pass
    // (D-098), so creation and upload are both off until the token exists.
    create: authToken.length > 0,
  },
  sourcemaps: {
    disable: authToken.length === 0,
    deleteSourcemapsAfterUpload: true,
  },
  // The browser SDK is charged to every route (Next's root main chunk), so everything Tassl does
  // not use is asked to treeshake out: there is no session replay (13 §3), and the SDK's own debug
  // logging is dead weight in a production bundle. `excludeTracing` is deliberately *not* set —
  // 13 §3.4 gives the browser a sample rate and `onRouterTransitionStart`, and measuring it changed
  // the root chunk by zero bytes under Turbopack anyway (D-579).
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeReplayShadowDom: true,
    excludeReplayIframe: true,
    excludeReplayWorker: true,
  },
  telemetry: false,
})
