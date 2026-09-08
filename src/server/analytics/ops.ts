// PostHog transport for the `ops_*` counters: docs/tech/13-observability-ops.md §3.7 and §6.
//
// The operational counters are not part of the product catalogue in 17 §3 — they carry no run
// context, they are never joined to a person, and every one of them is a number on an operations
// dashboard. They therefore travel through their own transport rather than through `track()`, which
// validates one `z.strictObject` per event name (D-562). What they do share with `track()` is the
// privacy contract: the property guard below is the same allowlist, applied at runtime because an
// ops attribute bag is assembled from whatever the emitting site had at hand.
import {
  FORBIDDEN_PROPERTY_PATTERN,
  MAX_PROPERTY_STRING_LENGTH,
} from '@/lib/analytics/property-guard'
import { env } from '@/server/config'
import { getPosthogServer } from '@/server/analytics/posthog'
import { getRequestContext } from '@/server/http/request-context'
import { rootLogger } from '@/server/logging/logger'

export type OpsProperties = Record<string, string | number | boolean | null | undefined>

/** `durationMs` and `duration_ms` are emitted by different call sites; the dashboards read one. */
const snakeCase = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase()

/**
 * The runtime half of the analytics allowlist (17 §6). A property is dropped, never truncated:
 * a value long enough to break the limit is not a count or an id, and shipping the first 200
 * characters of it would be shipping exactly the kind of text that must not leave the process.
 */
export function safeOpsProperties(props: OpsProperties): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [rawKey, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue
    const key = snakeCase(rawKey)
    if (FORBIDDEN_PROPERTY_PATTERN.test(key)) continue
    if (typeof value === 'string' && value.length > MAX_PROPERTY_STRING_LENGTH) continue
    out[key] = value
  }
  return out
}

/**
 * Fire-and-forget; never throws and never changes control flow. `distinctId` is a hashed user id
 * (17 §5.2) or `'system'`, which creates no person profile.
 */
export function trackOps(event: string, props: OpsProperties, distinctId: string): void {
  const client = getPosthogServer()
  if (!client) return
  const ctx = getRequestContext()
  const organizationId = ctx?.actor?.activeOrganizationId ?? null
  try {
    client.capture({
      distinctId,
      event,
      properties: {
        ...safeOpsProperties(props),
        app_env: env.APP_ENV,
        organization_id: organizationId,
        request_id: ctx?.requestId ?? null,
        source: 'server',
        ...(distinctId === 'system' ? { $process_person_profile: false } : {}),
      },
      ...(organizationId ? { groups: { organization: organizationId } } : {}),
    })
  } catch (error) {
    rootLogger.warn({ event, err: error }, 'ops analytics capture failed')
  }
}
