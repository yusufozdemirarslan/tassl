// Wire contract of the `identity` module (docs/tech/10-backend-spec-modules.md §1,
// 07-api-spec.md §3). One Zod schema per input and per view, shared by the route, the action, and
// the form; the OpenAPI document is generated from these (`pnpm openapi:generate`).
//
// This file is the module's client-safe surface — components import types from here — so it holds
// no server imports at all and restates the role vocabularies as Zod enums rather than importing
// the Drizzle enums.
import { z } from 'zod'

// ---------------------------------------------------------------------------------------------
// Vocabularies (08-auth-authz.md §3, 06-data-model.md §3.4)
// ---------------------------------------------------------------------------------------------

export const platformRoleSchema = z.enum(['none', 'tassl_scenario_editor', 'admin'])

export const organizationRoleSchema = z.enum([
  'student',
  'instructor',
  'teaching_assistant',
  'scenario_author',
  'program_lead',
])

export const sectionRoleSchema = z.enum(['student', 'instructor', 'ta'])

export const runStateSchema = z.enum([
  'assigned',
  'readiness',
  'framing',
  'working',
  'paused',
  'decision_locked',
  'turn_open',
  'turn_locked',
  'defense_pending',
  'defense_complete',
  'scored',
  'confirmed',
  'recorded',
  'voided',
  'abandoned',
  'defense_missed',
  'under_appeal',
  'expired',
])

export const runModeSchema = z.enum(['guided', 'standard', 'open'])
export const variantKeySchema = z.enum(['defective', 'sound'])
export const scoringStatusSchema = z.enum(['idle', 'queued', 'running', 'held', 'done'])

// ---------------------------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------------------------

/** Cursor pagination (10-backend-spec.md §11, D-020); unknown query parameters are rejected. */
export const pageQuerySchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/** `{ items, nextCursor }` around any item schema. */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() })
}

export const membershipSchema = z.object({
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
  role: organizationRoleSchema,
  joinedAt: z.iso.datetime(),
})

/**
 * What the signed-in person may reach, derived from the roles they hold (08 §5 "UI"). Hidden
 * controls are a courtesy; the service check is the enforcement.
 */
export const capabilitiesSchema = z.object({
  canTakeRuns: z.boolean(),
  canReviewRuns: z.boolean(),
  canAuthorPackages: z.boolean(),
  canManageInstitution: z.boolean(),
  canCreateInstitution: z.boolean(),
})

export const meViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  createdAt: z.iso.datetime(),
  platformRole: platformRoleSchema,
  memberships: z.array(membershipSchema),
  activeOrganizationId: z.string().nullable(),
  capabilities: capabilitiesSchema,
})

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

/** PATCH /me (SYS-003): the only profile field a person edits in the build slice. */
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
})

/**
 * DELETE /me from the account screen (UI-010): the dialog makes the person type the address of the
 * account, and the action checks it against the session, so a mis-wired form cannot delete anyone.
 * The API route needs no body — the session is the confirmation there.
 */
export const confirmAccountDeletionSchema = z.object({
  email: z.email(),
})

// ---------------------------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------------------------

/**
 * A run in the account's data export (SYS-004). `/me/runs` is the runs module's list and answers
 * with its own `RunSummary` (07 §10); this is the export's own shape, and it stays here because the
 * export is the identity module's — Phase 10 replaces it with the record-form trace of FR-243.
 */
export const runSummarySchema = z.object({
  id: z.uuid(),
  assignmentId: z.uuid(),
  attemptNo: z.number().int(),
  state: runStateSchema,
  mode: runModeSchema,
  variantKey: variantKeySchema,
  isWalkthrough: z.boolean(),
  scoringStatus: scoringStatusSchema,
  label: z.string(),
  createdAt: z.iso.datetime(),
  lockedAt: z.iso.datetime().nullable(),
  scoredAt: z.iso.datetime().nullable(),
})

/**
 * The student's latest attempt on an assignment, as the assignment list names it. It is deliberately
 * narrower than `RunSummary`: the list is a set of links, and everything else about a run is one
 * fetch away at `GET /runs/{id}` (07-api-spec.md §3 example).
 */
export const runRefSchema = z.object({
  id: z.uuid(),
  attemptNo: z.number().int(),
  state: runStateSchema,
  scoringStatus: scoringStatusSchema,
})

export const studentAssignmentSchema = z.object({
  assignmentId: z.uuid(),
  label: z.string(),
  isWalkthrough: z.boolean(),
  opensAt: z.iso.datetime().nullable(),
  courseId: z.uuid(),
  courseName: z.string(),
  sectionId: z.uuid(),
  sectionName: z.string(),
  createdAt: z.iso.datetime(),
  latestRun: runRefSchema.nullable(),
})

export const myAssignmentsPageSchema = pageOf(studentAssignmentSchema)

// ---------------------------------------------------------------------------------------------
// Export (SYS-004, 08 §2.9)
// ---------------------------------------------------------------------------------------------

export const exportProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
  platformRole: platformRoleSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const exportSectionMembershipSchema = z.object({
  sectionId: z.uuid(),
  sectionName: z.string(),
  courseId: z.uuid(),
  courseName: z.string(),
  organizationId: z.string(),
  role: sectionRoleSchema,
  joinedAt: z.iso.datetime(),
})

export const exportNotificationSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})

export const exportAuditEntrySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  organizationId: z.string().nullable(),
  createdAt: z.iso.datetime(),
})

export const userExportSchema = z.object({
  exportedAt: z.iso.datetime(),
  profile: exportProfileSchema,
  memberships: z.array(membershipSchema),
  sectionMemberships: z.array(exportSectionMembershipSchema),
  /** Record-form run exports arrive with the run and record modules (Phases 6 and 10). */
  runs: z.array(runSummarySchema),
  notifications: z.array(exportNotificationSchema),
  auditLog: z.array(exportAuditEntrySchema),
})

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type PlatformRole = z.infer<typeof platformRoleSchema>
export type OrganizationRole = z.infer<typeof organizationRoleSchema>
export type SectionRole = z.infer<typeof sectionRoleSchema>
export type Membership = z.infer<typeof membershipSchema>
export type Capabilities = z.infer<typeof capabilitiesSchema>
export type MeView = z.infer<typeof meViewSchema>
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
export type ConfirmAccountDeletionInput = z.infer<typeof confirmAccountDeletionSchema>
export type PageQuery = z.infer<typeof pageQuerySchema>
export type RunRef = z.infer<typeof runRefSchema>
export type RunSummary = z.infer<typeof runSummarySchema>
export type StudentAssignment = z.infer<typeof studentAssignmentSchema>
export type UserExport = z.infer<typeof userExportSchema>
