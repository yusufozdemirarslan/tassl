// Wire contract of the `admin` module (docs/tech/10-backend-spec-modules.md §16, 07-api-spec.md §9).
// One Zod schema per input and per view, shared by the Server Action, the route handler and the
// screen that renders it (UI-050).
//
// Like every module schema this file is the client-safe surface — the admin tables import their
// types from here — so it holds no server imports and restates the platform-role vocabulary as a
// Zod enum rather than importing the Drizzle one.
//
// Dates leave the service as ISO strings, not `Date`s: the same view travels in an RSC payload and
// in a JSON body, so it is already the shape the client reads.
import { z } from 'zod'

/** `user.platform_role` (06 §3.1, D-007). */
export const platformRoleSchema = z.enum(['none', 'tassl_scenario_editor', 'admin'])
export type PlatformRole = z.infer<typeof platformRoleSchema>

/** Cursor pagination (10 §11, D-020); unknown query parameters are rejected. */
export const pageQuerySchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/** `{ items, nextCursor }` around any item schema. */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() })
}

/**
 * `GET /admin/users` (07 §9). `q` is an email prefix; the repository escapes the LIKE
 * metacharacters, so what the admin types is matched literally.
 */
export const listUsersSchema = pageQuerySchema.extend({
  q: z.string().trim().max(320).optional(),
})
export type ListUsersInput = z.infer<typeof listUsersSchema>

/** `GET /admin/audit-log` (07 §9); `orgId` narrows the log to one institution (UI-050). */
export const listAuditLogSchema = pageQuerySchema.extend({
  orgId: z.string().trim().max(64).optional(),
})
export type ListAuditLogInput = z.infer<typeof listAuditLogSchema>

/** The path parameter of `PUT /admin/users/{userId}/platform-role`. */
export const adminUserIdSchema = z.object({ userId: z.string().min(1) })

/** The body of the same endpoint; `ROLE_INVALID` is what a value outside the enum answers. */
export const setPlatformRoleBodySchema = z.object({ role: platformRoleSchema })

/** What the Server Action takes: the path parameter and the body as one object (UI-050). */
export const setPlatformRoleSchema = adminUserIdSchema.extend({ role: platformRoleSchema })
export type SetPlatformRoleInput = z.infer<typeof setPlatformRoleSchema>

/**
 * One row of the users table (07 §9 `AdminUser`). `deletedAt` is carried because a soft-deleted
 * account is still a row an admin can see and must be able to tell apart (08 §2.9); it is never a
 * seat anyone can be given, and the table says so.
 */
export const adminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  platformRole: platformRoleSchema,
  deletedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export type AdminUser = z.infer<typeof adminUserSchema>

export const adminUserPageSchema = pageOf(adminUserSchema)
export type AdminUserPage = z.infer<typeof adminUserPageSchema>

/**
 * One row of the audit table (07 §9 `AuditEntry`, DATA-048). `metadata` is the action's own
 * details, written by the module that audited it; it never carries a secret, run free text, or
 * anything the log redacts (10 §16).
 */
export const auditEntrySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  actorId: z.string().nullable(),
  organizationId: z.string().nullable(),
  requestId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
})
export type AuditEntry = z.infer<typeof auditEntrySchema>

export const auditEntryPageSchema = pageOf(auditEntrySchema)
export type AuditEntryPage = z.infer<typeof auditEntryPageSchema>

/**
 * One option of the audit log's institution filter (UI-050). Not an endpoint of 07 §9: it is the
 * control's own vocabulary, read by the screen that draws the filter and by nothing else.
 */
export const institutionRefSchema = z.object({ id: z.string(), name: z.string() })
export type InstitutionRef = z.infer<typeof institutionRefSchema>

/**
 * How many institutions the filter offers (D-572).
 *
 * It sits in the schema — the module's client-safe surface — because both sides need it: the
 * repository caps the query with it, and the control says so when it has shown all of them, which
 * is what keeps a capped list from reading as a complete one.
 */
export const INSTITUTION_FILTER_LIMIT = 200

/**
 * One window of model spend (step 14.5, 13 §6.3): what the budgets have counted since an instant.
 *
 * Calls the mock answered are not in it. A budget is a spend control and `costEstimateUsd` prices a
 * mock call at nothing for the same reason (D-651), so a deployment running on the mock reports
 * zero here — which is the true answer to "what has this deployment spent".
 */
export const llmUsageWindowSchema = z.object({
  calls: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
})
export type LlmUsageWindow = z.infer<typeof llmUsageWindowSchema>

/**
 * The flags page's LLM panel: today, this month, and the two ceilings they are read against
 * (D-065). `today` is the UTC day and `month` the calendar month, because that is what the budget
 * means by them — a panel on a different clock from the guardrail would disagree with it at the
 * moment somebody most needs it to agree.
 *
 * The two ceilings are not comparable to the two windows in the same way, and the screen says so:
 * `globalMonthly` is exactly what `month.tokens` is measured against, while `userDaily` is *per
 * person* and `today.tokens` is the whole platform's day.
 */
export const llmUsageSchema = z.object({
  today: llmUsageWindowSchema,
  month: llmUsageWindowSchema,
  budgets: z.object({
    userDaily: z.number().int().positive(),
    globalMonthly: z.number().int().positive(),
  }),
})
export type LlmUsage = z.infer<typeof llmUsageSchema>

/**
 * The runtime assistant switch (11 §6, D-691): what the `ai_mode` row may hold. `live` is also what
 * no row means, so the screen never has to draw a third state.
 */
export const aiModeSchema = z.enum(['live', 'mock'])
export type AiMode = z.infer<typeof aiModeSchema>

/** The body of `PUT /admin/settings/ai-mode` and the input of the Server Action (07 §9). */
export const setAiModeSchema = z.object({ mode: aiModeSchema })
export type SetAiModeInput = z.infer<typeof setAiModeSchema>

/**
 * What the assistant actually is once the environment and the row are both read: `scripted` when
 * `FEATURE_AI=false` forces the mock *or* the row says `mock`, else `live`. The same vocabulary
 * `/api/ready` reports and the assistant panel's chip prints, so the three cannot disagree.
 */
export const assistantModeSchema = z.enum(['live', 'scripted'])
export type AssistantMode = z.infer<typeof assistantModeSchema>

/**
 * `GET /admin/flags` (07 §9): the deployment flags (05 §3), the provider the run loop would
 * actually call, the runtime switch and its effect, and what that provider has cost (NFR-016).
 * `effectiveLlmProvider` is a string rather than the provider enum because the flags screen prints
 * it and never branches on it, and the set of providers is a server fact.
 *
 * `demoMode` is on it for the reason the three flags are: the screen answers "what is this
 * deployment running with", and a deployment that auto-confirms sign-ups is running with something
 * an operator needs to be able to see (D-692).
 */
export const adminFlagsSchema = z.object({
  ai: z.boolean(),
  sampleData: z.boolean(),
  testControls: z.boolean(),
  demoMode: z.boolean(),
  effectiveLlmProvider: z.string(),
  aiMode: aiModeSchema,
  assistantMode: assistantModeSchema,
  llmUsage: llmUsageSchema,
})
export type AdminFlags = z.infer<typeof adminFlagsSchema>
