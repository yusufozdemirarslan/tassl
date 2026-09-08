// Server-side analytics: docs/tech/17-analytics-events.md §5.4.
// No `server-only`: loaded by tsx scripts and Vitest (D-143).
import { EVENTS, type EventName, type EventProps } from '@/lib/analytics/events'
import { hashUserId } from '@/server/analytics/distinct-id'
import { getPosthogServer } from '@/server/analytics/posthog'
import { env } from '@/server/config'
import { getRequestContext } from '@/server/http/request-context'
import { rootLogger } from '@/server/logging/logger'

export type TrackActor = { userId: string | null; organizationId?: string | null }

/**
 * Synchronous and never throws in preview/production; in local and test an invalid payload throws
 * so the bug is caught in development. Call it after the writing transaction has committed.
 */
export function track<N extends EventName>(name: N, props: EventProps<N>, actor: TrackActor): void {
  const parsed = EVENTS[name].safeParse(props)
  if (!parsed.success) {
    if (env.APP_ENV === 'local' || env.APP_ENV === 'test') {
      throw new Error(`ANALYTICS_PROPS_INVALID ${name}: ${parsed.error.message}`)
    }
    rootLogger.warn(
      { event: name, issues: parsed.error.issues.map((i) => i.path.join('.')) },
      'analytics props invalid; event dropped',
    )
    return
  }
  const ctx = getRequestContext()
  const organizationId = actor.organizationId ?? null
  const distinctId = actor.userId ? hashUserId(actor.userId) : 'system'
  const payload = {
    distinctId,
    event: name,
    properties: {
      ...parsed.data,
      app_env: env.APP_ENV,
      organization_id: organizationId,
      request_id: ctx?.requestId ?? null,
      source: 'server' as const,
      ...(actor.userId ? {} : { $process_person_profile: false }),
    },
    ...(organizationId ? { groups: { organization: organizationId } } : {}),
  }
  ;(ctx?.logger ?? rootLogger).debug(
    { event: 'analytics', analytics: payload },
    `analytics ${name}`,
  )
  // No key, no client, no network call (D-098). Analytics never changes control flow, so a capture
  // that throws is a warning and nothing more.
  const client = getPosthogServer()
  if (!client) return
  try {
    client.capture(payload)
  } catch (error) {
    rootLogger.warn({ event: name, err: error }, 'analytics capture failed')
  }
}
