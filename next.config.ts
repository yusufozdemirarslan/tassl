import type { NextConfig } from 'next'
// `@sentry/nextjs` re-exports this, but that path is deprecated and stops working in v11.
import { withSentryConfig } from '@sentry/nextjs/config'

// The authoritative listing of this file is docs/tech/12-security.md §4.3; the Sentry keys are
// owned by 13-observability-ops.md §3.6 and the `/ingest` rewrites by 17-analytics-events.md §5.7.
// Static security headers and the `headers()` cache rules arrive with 12 §4 in Step 13.3.

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
