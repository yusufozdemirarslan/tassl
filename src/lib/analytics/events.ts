// Analytics event catalogue: docs/tech/17-analytics-events.md §3 and §5.1.
// Every schema is a z.strictObject (allowlist by construction, rule 3). An event that is not in
// EVENTS does not compile. Events are appended per phase; the primitive vocabulary lives here.
import { z } from 'zod'

// Primitive vocabulary. Only these leaf kinds are allowed (tests/unit/analytics/events.test.ts enforces it).
export const Uuid = z.uuid()
export const Int = z.int().nonnegative()
export const Share = z.number().min(0).max(1)
export const RuleCode = z.string().regex(/^[A-Z0-9_]+$/)
/** A route template such as /runs/[runId]/work, never a concrete path. */
export const RouteTemplate = z.string().regex(/^\/[A-Za-z0-9[\]/-]*$/)

export const EVENTS = {
  // AN-002 activation
  sign_up_completed: z.strictObject({ method: z.enum(['password', 'google']) }),
  sign_in_succeeded: z.strictObject({ method: z.enum(['password', 'google', 'verification']) }),

  // SYS-008, SYS-022 (client: ErrorView and the ActionResult failure toast)
  error_shown: z.strictObject({
    code: RuleCode,
    status: z.int().min(100).max(599).nullable(),
    route: RouteTemplate,
  }),

  // Server, no screen: src/server/rate-limit/enforce.ts on refusal (D-026)
  rate_limited: z.strictObject({
    bucket: z.enum(['user_writes', 'user_reads', 'auth', 'llm', 'run_events']),
    scope: z.enum(['user', 'ip']),
  }),
} as const

export type EventName = keyof typeof EVENTS
export type EventProps<E extends EventName> = z.input<(typeof EVENTS)[E]>
