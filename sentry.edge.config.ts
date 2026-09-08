// Sentry, Edge runtime: docs/tech/13-observability-ops.md §3.2. Tassl runs every route on the Node
// runtime (D-011); the SDK still requires this file to exist, and `src/proxy.ts` is the one thing
// that could ever load it. Tracing is off here so the proxy adds no spans to every request.
import * as Sentry from '@sentry/nextjs'
import { scrubSentryEvent } from '@/lib/observability/sentry-scrub'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? ''

Sentry.init({
  dsn: dsn || undefined,
  enabled: dsn.length > 0,
  environment: process.env.APP_ENV ?? 'local',
  release: process.env.SENTRY_RELEASE || undefined,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: (event) => scrubSentryEvent(event),
})
