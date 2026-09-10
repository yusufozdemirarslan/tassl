// Server instrumentation: docs/tech/13-observability-ops.md §3.3.
// Sentry is initialized first, then the environment is validated — an invalid environment throws
// INVALID_SERVER_ENV (05 §3) and Sentry is already up to report it.
import * as Sentry from '@sentry/nextjs'

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
    const { env } = await import('@/server/config')
    const { rootLogger } = await import('@/server/logging/logger')
    rootLogger.info(
      {
        event: 'boot',
        appEnv: env.APP_ENV,
        release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
      },
      'server started',
    )
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

/**
 * A client that goes away mid-render is not an application error (D-721).
 *
 * Next pipes React's renderer into a `PassThrough` it destroys when the response closes, so a
 * closed tab, a click during a navigation, or a `router.refresh()` cut short by the next one makes
 * React cancel the render with `Error('The destination stream closed early.')` — once per
 * unfinished Suspense boundary, so one abandoned page load arrives here as a burst. Next's own
 * filter is `isAbortError`, which matches only `name === 'AbortError'`, and this is a plain
 * `Error`, so it reaches this seam untagged.
 *
 * Untagged is what matters: 13 §7's `NFR-007 error burst` rule fires on a new issue whose `ops` tag
 * is not set, or ten such events in five minutes. One headless browser walking the guides produced
 * twelve in six minutes, so in production the first student to close a tab on a run screen would
 * page the builder and bury the real 5xx under the loudest issue in the project.
 *
 * Nothing is lost when it happens. The one write a page render performs is `materializeTimers`,
 * which commits inside its own transaction that no HTTP abort can reach — no `AbortSignal` is wired
 * to postgres-js — and the assistant's stream stores and traces the whole reply before its first
 * frame (D-271). Only the rendered HTML is discarded.
 *
 * Dropped here rather than in `scrubSentryEvent`, whose contract is that it never returns null, or
 * in Sentry's `ignoreErrors`, which would also hide the message if it ever arrived from a path that
 * is not a disconnect. Next's own `⨯` console line still prints, and should: it is visible noise in
 * a log, not a page.
 */
const CLIENT_DISCONNECT = 'The destination stream closed early.'

export const onRequestError: typeof Sentry.captureRequestError = (error, request, context) => {
  if (error instanceof Error && error.message === CLIENT_DISCONNECT) return
  return Sentry.captureRequestError(error, request, context)
}
