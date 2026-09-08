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

export const onRequestError = Sentry.captureRequestError
