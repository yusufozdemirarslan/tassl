// Operational events: docs/tech/13-observability-ops.md §3.7.
// One module turns an operational condition into a log line, a Sentry event with a stable
// fingerprint (every alert rule in 13 §7 matches the `ops` tag), and a PostHog counter (every panel
// in 13 §6 reads an `ops_*` event). No `server-only` (D-143).
//
// Both sinks are no-ops without their keys (D-098): `Sentry.captureMessage` returns an event id and
// sends nothing when the DSN is empty, and `trackOps` returns before it constructs a client when
// NEXT_PUBLIC_POSTHOG_KEY is empty. The log line is written either way, so nothing is lost.
import * as Sentry from '@sentry/nextjs'
import { trackOps } from '@/server/analytics/ops'
import { getLogger } from '@/server/http/request-context'

export type OpsAlert =
  | 'scoring_slow'
  | 'scoring_overdue'
  | 'run_held'
  | 'llm_error'
  | 'circuit_open'
  | 'budget_exceeded'
  | 'job_dead_lettered'
  | 'job_expired'
  | 'auth_rate_limited'
  | 'readiness_failed'

export type OpsCount =
  | 'ops_run_state_changed'
  | 'ops_turn_delivered'
  | 'ops_scoring_completed'
  | 'ops_run_held'
  | 'ops_llm_call'
  | 'ops_llm_circuit_opened'
  | 'ops_job_completed'
  | 'ops_job_failed'
  | 'ops_job_dead_lettered'
  | 'ops_queue_depth'
  | 'ops_drain_completed'
  | 'ops_sign_in_failed'
  | 'ops_rate_limit_hit'

export type OpsAttrs = Record<string, string | number | boolean | null | undefined>

/** Sentry truncates a tag at 200 characters and rejects newlines; an ops attribute is an id, an
 *  enum, or a number, so anything longer than this is a bug worth seeing rather than sending. */
const MAX_TAG_LENGTH = 200
const tagValue = (value: string | number | boolean): string =>
  String(value).replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH)

// Alert-worthy: warn log + Sentry message tagged ops:<name>; one Sentry issue per name.
export function alertOps(name: OpsAlert, attrs: OpsAttrs = {}): void {
  getLogger().warn({ event: `ops.${name}`, ...attrs }, `ops ${name}`)
  Sentry.withScope((scope) => {
    scope.setTag('ops', name)
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== undefined && value !== null) scope.setTag(key, tagValue(value))
    }
    // Every occurrence of one condition is one issue, so the rules in 13 §7 can count events
    // inside a window instead of chasing a new issue per run.
    scope.setFingerprint(['ops', name])
    Sentry.captureMessage(`ops.${name}`, 'warning')
  })
}

// Dashboard-worthy: info log + PostHog event; never alerts.
// distinctId is a hashed user id (17 §5.2) or 'system'.
export function countOps(event: OpsCount, props: OpsAttrs = {}, distinctId = 'system'): void {
  getLogger().info({ event, distinctId, ...props }, event)
  trackOps(event, props, distinctId)
}
