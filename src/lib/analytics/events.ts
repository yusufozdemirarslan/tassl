// Analytics event catalogue: docs/tech/17-analytics-events.md §3 and §5.1.
// Every schema is a z.strictObject (allowlist by construction, rule 3). An event that is not in
// EVENTS does not compile. Events are appended per phase; the primitive vocabulary lives here.
import { z } from 'zod'

// Primitive vocabulary. Only these leaf kinds are allowed (tests/unit/analytics/events.test.ts enforces it).
export const Uuid = z.uuid()
export const Int = z.int().nonnegative()
export const Share = z.number().min(0).max(1)
export const RuleCode = z.string().regex(/^[A-Z0-9_]+$/)
/** The three outside-AI policies a course can set (06 §3.2). */
export const OutsideAiPolicy = z.enum(['open', 'declared', 'in_environment_only'])
/** The two variants of a scenario package version (06 §3.3). */
export const Variant = z.enum(['defective', 'sound'])
/** A route template such as /runs/[runId]/work, never a concrete path. */
export const RouteTemplate = z.string().regex(/^\/[A-Za-z0-9[\]/-]*$/)

export const EVENTS = {
  // AN-002 activation
  sign_up_completed: z.strictObject({ method: z.enum(['password', 'google']) }),
  email_verified: z.strictObject({ ms_since_sign_up: Int }),
  sign_in_succeeded: z.strictObject({ method: z.enum(['password', 'google', 'verification']) }),
  invitation_accepted: z.strictObject({
    invitation_id: Uuid,
    role: z.enum([
      'student',
      'instructor',
      'teaching_assistant',
      'scenario_author',
      'program_lead',
    ]),
    ms_since_invited: Int,
  }),

  // AN-001 activation: the two writes an instructor makes before a run can exist (17 §5.2)
  course_created: z.strictObject({
    course_id: Uuid,
    outside_ai_policy: OutsideAiPolicy,
    mapping_is_default: z.boolean(),
    ms_since_first_sign_in: Int,
  }),
  assignment_configured: z.strictObject({
    assignment_id: Uuid,
    course_id: Uuid,
    section_id: Uuid,
    package_version_id: Uuid,
    variant: Variant,
    is_new: z.boolean(),
    is_walkthrough: z.boolean(),
    working_clock_seconds: z.int().positive(),
    weight_overridden: z.boolean(),
    ms_since_first_sign_in: Int,
  }),

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
