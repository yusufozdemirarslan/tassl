'use client'
// Registers `app_env` as a PostHog super property so every client event — `$pageview` included —
// says which environment it came from (17 §5.5). Rendered by the root layout, which is a Server
// Component and is the only place that can read `env.APP_ENV`. Renders nothing.
import { useEffect } from 'react'
import { registerEnvironment } from '@/lib/analytics/client'

export function AnalyticsEnvironment({
  appEnv,
}: {
  appEnv: 'local' | 'test' | 'preview' | 'production'
}) {
  useEffect(() => {
    // Fire and forget: the SDK is fetched only when a key exists (D-578), and a page never waits
    // on analytics.
    void registerEnvironment(appEnv)
  }, [appEnv])
  return null
}
