'use client'
// Browser-side analytics: docs/tech/17-analytics-events.md §5.5.
//
// Nothing here is imported statically except the public environment. `posthog-js` and the catalogue
// (which brings Zod with it) are behind `import()`, so a build with an empty
// NEXT_PUBLIC_POSTHOG_KEY ships no analytics bytes at all and every route keeps the budget it had
// before analytics existed (16 §3, D-578). The same shape is the no-op of D-098 taken seriously:
// with no key these functions return before they fetch anything, let alone send anything.
//
// Each one returns a promise the caller does not have to await; callers that fire from an effect
// write `void identifyClient(…)`. Validation still happens against the same `EVENTS` map the server
// uses, so a client event is held to the same allowlist.
//
// The key is read from `process.env` rather than through `publicEnv`, which is a Zod schema: this
// module is reached from the *root* layout, and importing `@/lib/env.public` here would put the Zod
// runtime into the bundle of every route in the app for one string comparison (D-578).
// `NEXT_PUBLIC_POSTHOG_KEY` is inlined by Next at build time either way.
import type { EventName, EventProps } from './events'

export const analyticsEnabled = (process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '') !== ''

const loadPosthog = async () => (await import('posthog-js')).default

/** Drops an invalid payload in production; rejects in development so the bug is found there. */
export async function trackClient<E extends EventName>(
  name: E,
  props: EventProps<E>,
): Promise<void> {
  if (!analyticsEnabled) return
  const [posthog, { EVENTS }] = await Promise.all([loadPosthog(), import('./events')])
  const parsed = EVENTS[name].safeParse(props)
  if (!parsed.success) {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`ANALYTICS_PROPS_INVALID ${name}: ${parsed.error.message}`)
    }
    return
  }
  posthog.capture(name, { ...parsed.data, source: 'client' })
}

/** Super property on every client event, `$pageview` included; registered by the root layout. */
export async function registerEnvironment(
  appEnv: 'local' | 'test' | 'preview' | 'production',
): Promise<void> {
  if (!analyticsEnabled) return
  ;(await loadPosthog()).register({ app_env: appEnv })
}

/**
 * `distinctId` is `hashUserId(user.id)`, computed on the server (17 §5.2): the browser never holds
 * the raw account id in analytics, and no person property is ever set alongside it.
 */
export async function identifyClient(
  distinctId: string,
  organizationId: string | null,
): Promise<void> {
  if (!analyticsEnabled) return
  const posthog = await loadPosthog()
  if (posthog.get_distinct_id() !== distinctId) posthog.identify(distinctId)
  if (organizationId) {
    posthog.group('organization', organizationId)
    posthog.register({ organization_id: organizationId })
  } else {
    posthog.unregister('organization_id')
  }
}

/** Awaited before `authClient.signOut()`, so the next visitor on this browser is a new anonymous id. */
export async function resetClient(): Promise<void> {
  if (!analyticsEnabled) return
  ;(await loadPosthog()).reset()
}
