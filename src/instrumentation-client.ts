// Browser instrumentation: docs/tech/13-observability-ops.md §3.4 (Sentry) and
// 17-analytics-events.md §5.6 (PostHog). This file runs after the document loads and before React
// hydrates, so it is the one place both SDKs can be configured before anything is measurable.
//
// Both are no-ops without their keys (D-098). With an empty DSN or an empty PostHog key the SDK is
// never fetched, so the browser opens no connection to Sentry and none to `/ingest/` — the state
// every test and every local machine runs in.
//
// **Both SDKs are behind `import()`** (D-579). Sentry's client entry is injected into Next's root
// main chunk, the bytes every route loads before a byte of its own, and importing it at module
// scope charged 84,724 gzip to every screen in the product — including a student's first load of
// the run workspace, with the working clock already against them. A minimal init (no tracing, no
// default integrations) was measured and saved 79 bytes: the cost is the barrel, not the options,
// so the only lever that moves is not importing it here.
//
// What a lazy error reporter would ordinarily lose is the errors that matter most — the ones thrown
// before the chunk arrives, during hydration. So it is not lost: two listeners are installed
// synchronously, below, before anything is requested, and what they catch is replayed into Sentry
// the moment it is up. Sentry's `dedupe` default integration covers the one-microsecond overlap
// where both its handlers and ours are live.
import { sanitizeProperties } from '@/lib/analytics/sanitize'
import { installEarlyErrorBuffer } from '@/lib/observability/early-errors'
import { scrubSentryEvent } from '@/lib/observability/sentry-scrub'

// Read straight from `process.env`, not through `publicEnv`. This file is in the root main chunk,
// and `@/lib/env.public` is a Zod schema, so importing it here charged all 88 KB of gzip of the Zod
// runtime to every page in the product, to read four strings Next inlines anyway (D-579).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? ''
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ''
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'
// Neither name is NEXT_PUBLIC_, so next.config.ts inlines both for the browser (13 §3.6).
const rate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '1')

type SentryClient = typeof import('@sentry/nextjs')

/** Set once the SDK has loaded; `onRouterTransitionStart` forwards to it. */
let sentry: SentryClient | null = null

if (dsn) {
  // Synchronous and dependency-free: installed before the SDK is even requested, so an error thrown
  // during hydration is held rather than lost (D-579).
  const early = installEarlyErrorBuffer(window)

  void import('@sentry/nextjs').then((Sentry) => {
    sentry = Sentry
    Sentry.init({
      dsn,
      enabled: true,
      environment: process.env.APP_ENV ?? 'local',
      release: process.env.SENTRY_RELEASE || undefined,
      sendDefaultPii: false,
      tracesSampleRate: Number.isFinite(rate) ? rate : 0,
      // Default integrations only: no session replay, no user-feedback widget (13 §3).
      integrations: [],
      // Same-origin, so `connect-src 'self'` covers it and no ad blocker sees a third-party host.
      tunnel: '/sentry-tunnel',
      // The browser SDK attaches the page URL to every event; a verification or reset token in the
      // query string must not travel with it (12 §7).
      beforeSend: (event) => scrubSentryEvent(event, {}),
      beforeBreadcrumb: (crumb) => {
        if (crumb.data && typeof crumb.data.url === 'string') {
          const cut = crumb.data.url.search(/[?#]/)
          if (cut !== -1) crumb.data.url = crumb.data.url.slice(0, cut)
        }
        return crumb
      },
    })

    // Sentry's own handlers are live now, so ours come down and hand over what they caught. The
    // `dedupe` default integration covers the microsecond where both were listening.
    early.drain((error) => {
      Sentry.captureException(error.value, { tags: { early: error.kind } })
    })
  })
}

// PostHog (17 §5.6). Every option here is a subtraction: nothing is recorded that the catalogue in
// 17 §3 did not ask for. `autocapture`, `mask_all_text`, and `mask_all_element_attributes` mean no
// DOM text or input value can leave the page; `disable_session_recording`, `disable_surveys`,
// `disable_web_experiments`, and `disable_external_dependency_loading` stop every remote script;
// `capture_exceptions: false` because Sentry owns exceptions (D-027); `advanced_disable_flags`
// because Tassl has no flag service (D-023); `ip: false` and `person_profiles: 'identified_only'`
// keep an anonymous visitor anonymous.
if (posthogKey) {
  void import('posthog-js').then(({ default: posthog }) => {
    posthog.init(posthogKey, {
      // The reverse proxy in next.config.ts: the browser talks to this origin and nowhere else.
      api_host: '/ingest',
      ui_host: posthogHost,
      defaults: '2025-05-24',
      // 'history_change' records the first load *and* every App Router navigation; `true` would
      // record the first load only, which loses the whole of an in-app session.
      capture_pageview: 'history_change',
      capture_pageleave: true,
      capture_exceptions: false,
      autocapture: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_web_experiments: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      persistence: 'localStorage+cookie',
      person_profiles: 'identified_only',
      mask_all_text: true,
      mask_all_element_attributes: true,
      ip: false,
      sanitize_properties: (props) => sanitizeProperties(props),
    })
  })
}

/**
 * Next calls this at the start of every App Router navigation. It forwards to the SDK once the
 * chunk has arrived; a navigation in the milliseconds before that loses a tracing mark and nothing
 * else — no alert rule in 13 §7 and no panel in 13 §6 reads a browser transaction.
 */
export function onRouterTransitionStart(
  url: string,
  navigationType: 'push' | 'replace' | 'traverse',
): void {
  sentry?.captureRouterTransitionStart(url, navigationType)
}
