// Operational events: docs/tech/13-observability-ops.md §3.7.
// Phase 0: log lines only. Phase 13 adds the Sentry message (fingerprint ['ops', name]) in
// alertOps and the PostHog counter in countOps. No `server-only` (D-143).
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

// Alert-worthy: warn log (+ Sentry from Phase 13); one issue per name.
export function alertOps(name: OpsAlert, attrs: OpsAttrs = {}): void {
  getLogger().warn({ event: `ops.${name}`, ...attrs }, `ops ${name}`)
}

// Dashboard-worthy: info log (+ PostHog counter from Phase 13); never alerts.
// distinctId is a hashed user id or 'system'.
export function countOps(event: OpsCount, props: OpsAttrs = {}, distinctId = 'system'): void {
  getLogger().info({ event, distinctId, ...props }, event)
}
