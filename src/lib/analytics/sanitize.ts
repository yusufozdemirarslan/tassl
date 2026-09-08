// `sanitize_properties` for posthog-js: docs/tech/17-analytics-events.md §5.6 and §6.
//
// It lives here rather than inside src/instrumentation-client.ts so a test can exercise it without
// booting either SDK, and so the rule it enforces is stated once. Every URL-shaped value loses its
// query string and its hash before it leaves the page, because two of Tassl's own links carry a
// credential in exactly that position: `/verify-email?token=…` and `/reset-password?token=…`.
// PostHog attaches `$current_url`, `$referrer`, and the `$set_once` initial-URL properties to
// events the application never writes by hand, including `$pageview`, so the strip has to happen
// at the SDK boundary and has to recurse.

export function stripQueryAndHash(value: unknown): unknown {
  if (typeof value !== 'string' || !/^https?:\/\//.test(value)) return value
  const cut = value.search(/[?#]/)
  return cut === -1 ? value : value.slice(0, cut)
}

export function sanitizeProperties(props: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(props)) {
    const value = props[key]
    props[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? sanitizeProperties(value as Record<string, unknown>)
        : stripQueryAndHash(value)
  }
  return props
}
