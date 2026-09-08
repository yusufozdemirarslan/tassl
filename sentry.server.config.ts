// Sentry, Node runtime: docs/tech/13-observability-ops.md §3.1. Loaded by src/instrumentation.ts
// before `@/server/config`, so an invalid environment (INVALID_SERVER_ENV) is itself reported.
//
// Everything here degrades to a no-op when NEXT_PUBLIC_SENTRY_DSN is empty (D-098): `enabled` is
// false and `dsn` is undefined, so `Sentry.captureException`, `captureMessage`, `withMonitor`, and
// the tracing integrations all return without a network call. No key is required to run Tassl.
import * as Sentry from '@sentry/nextjs'
import { scrubSentryEvent } from '@/lib/observability/sentry-scrub'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? ''
const rate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '1')

/** Health, readiness, and the tunnel are polled every minute; tracing them buys nothing (13 §4). */
const NOISE = ['/api/health', '/api/ready', '/sentry-tunnel']

Sentry.init({
  dsn: dsn || undefined,
  enabled: dsn.length > 0,
  environment: process.env.APP_ENV ?? 'local',
  // Inlined by next.config.ts so the runtime release equals the one the source maps were uploaded
  // under, even when the deploy carries no git metadata (D-563).
  release: process.env.SENTRY_RELEASE || undefined,
  sendDefaultPii: false,
  tracesSampler: ({ name }) =>
    NOISE.some((path) => name.includes(path)) ? 0 : Number.isFinite(rate) ? rate : 0,
  beforeSend: (event) => scrubSentryEvent(event),
  beforeSendTransaction: (event) => scrubSentryEvent(event),
})
