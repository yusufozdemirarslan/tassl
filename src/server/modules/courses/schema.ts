// Wire contract of the `courses` module (docs/tech/10-backend-spec-modules.md §3, §17;
// 07-api-spec.md §5). One Zod schema per input, shared by the route, the Server Action, and the
// form that submits it; one schema per view, which the route validates against before serializing.
//
// Like every module schema this file is the server-side authority and carries no server import, so
// a Server Component may read its types. A *client* component never imports it (D-186): the module
// schema is built with the full Zod runtime, and the browser copy of a bound lives in `src/lib`.
//
// Dates leave the service as ISO strings, not `Date`s: the same view travels in a JSON body and in
// an RSC payload, so it is already the shape the client reads. Numeric columns (weights, the
// mapping) leave as numbers — `numeric` reaches the repository as a string and the service converts
// it once, here at the edge, rather than in every screen.
import { z } from 'zod'

// ---------------------------------------------------------------------------------------------
// Enumerations (06-data-model.md §3.2, §3.3, §3.4)
// ---------------------------------------------------------------------------------------------

export const OUTSIDE_AI_POLICIES = ['open', 'declared', 'in_environment_only'] as const
export const OutsideAiPolicySchema = z.enum(OUTSIDE_AI_POLICIES)
export type OutsideAiPolicy = z.infer<typeof OutsideAiPolicySchema>

export const RunTypeSchema = z.enum(['decision', 'critique'])
export type RunTypeValue = z.infer<typeof RunTypeSchema>

/** `section_memberships.role` (08 §3); the section vocabulary, not the institution's. */
export const SectionRoleSchema = z.enum(['student', 'instructor', 'ta'])
export type SectionRoleValue = z.infer<typeof SectionRoleSchema>

/** `scenario_variants.key` (06 §3.3). */
export const VariantKeySchema = z.enum(['defective', 'sound'])

/** `runs.state` and `runs.scoring_status` (06 §3.4), restated rather than imported from the db. */
export const RunStateSchema = z.enum([
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
export const ScoringStatusSchema = z.enum(['idle', 'queued', 'running', 'held', 'done'])

// ---------------------------------------------------------------------------------------------
// The band mapping
// ---------------------------------------------------------------------------------------------

/**
 * The rule (10 §17): points per confirmed band, four positive finite numbers. This is the schema
 * that says what a valid mapping *is*, and the service parses every mapping through it.
 *
 * `.positive()` alone would admit `Infinity`, which JSON cannot carry and `numeric` cannot store,
 * so finiteness is asserted with it.
 */
const point = z.number().positive().finite()

export const MappingSchema = z.object({
  novice: point,
  developing: point,
  proficient: point,
  professional: point,
})
export type Mapping = z.infer<typeof MappingSchema>

/**
 * The same four keys as they arrive on the wire. Requests are accepted at shape level so the rule
 * above is applied by the service, which answers `MAPPING_INVALID` (400) — the code 07 §5 documents
 * for these rows — rather than the generic `VALIDATION_ERROR` a Zod refinement would produce. This
 * is the shape tenancy's institution default uses for the same reason.
 */
export const MappingInputSchema = z.object({
  novice: z.number(),
  developing: z.number(),
  proficient: z.number(),
  professional: z.number(),
})
export type MappingInput = z.infer<typeof MappingInputSchema>

// ---------------------------------------------------------------------------------------------
// Path parameters and pagination
// ---------------------------------------------------------------------------------------------

/** Organization ids are Better Auth text ids: an unknown one is 404, never 400 (07 §1). */
export const OrgIdParamsSchema = z.object({ orgId: z.string().min(1) })
export const CourseIdParamsSchema = z.object({ courseId: z.uuid() })
export const SectionIdParamsSchema = z.object({ sectionId: z.uuid() })
export const SectionMemberParamsSchema = z.object({
  sectionId: z.uuid(),
  userId: z.string().min(1),
})
export const AssignmentIdParamsSchema = z.object({ assignmentId: z.uuid() })
export const RunIdParamsSchema = z.object({ runId: z.uuid() })

/** Cursor pagination (10-backend-spec.md §11, D-020); unknown query parameters are rejected. */
export const PageQuerySchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})
export type PageQuery = z.infer<typeof PageQuerySchema>

/** `{ items, nextCursor }` around any item schema (07 §1 "Pagination"). */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() })
}

// ---------------------------------------------------------------------------------------------
// Inputs (07 §5; the request bodies of the eight mutations)
// ---------------------------------------------------------------------------------------------

const label = z.string().trim().min(1).max(200)
const weight = z.number().nonnegative().finite()

/** A working clock never drops below a minute (10 §3); null on an assignment = the package value. */
const workingClockSeconds = z.number().int().min(60)

export const CreateCourseSchema = z.object({
  name: label,
  term: z.string().trim().min(1).max(100),
  outsideAiPolicy: OutsideAiPolicySchema.optional(),
  mapping: MappingInputSchema.optional(),
  defaultRunWeight: weight.optional(),
  taughtConcepts: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
})
export type CreateCourseInput = z.infer<typeof CreateCourseSchema>

/**
 * `PATCH /courses/{courseId}` (FR-205). `mapping` is accepted here — and only while the course has
 * no confirmed run — because Phase 11 owns the mapping *change* with its preview and recompute
 * (`MAPPING_CHANGE_UNCONFIRMED` names the refusal until then).
 */
export const UpdateCoursePolicySchema = z.object({
  name: label.optional(),
  term: z.string().trim().min(1).max(100).optional(),
  outsideAiPolicy: OutsideAiPolicySchema.optional(),
  mapping: MappingInputSchema.optional(),
  defaultRunWeight: weight.optional(),
  critiqueWeightFactor: weight.optional(),
  taughtConcepts: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
})
export type UpdateCoursePolicyInput = z.infer<typeof UpdateCoursePolicySchema>

export const CreateSectionSchema = z.object({ name: z.string().trim().min(1).max(100) })
export type CreateSectionInput = z.infer<typeof CreateSectionSchema>

export const AddSectionMemberSchema = z.object({ email: z.email(), role: SectionRoleSchema })
export type AddSectionMemberInput = z.infer<typeof AddSectionMemberSchema>

export const CreateAssignmentSchema = z.object({
  label,
  packageVersionId: z.uuid(),
  variantId: z.uuid(),
  runType: RunTypeSchema.optional(),
  workingClockSeconds: workingClockSeconds.optional(),
  weight: weight.optional(),
  isWalkthrough: z.boolean().optional(),
  opensAt: z.coerce.date().nullish(),
})
export type CreateAssignmentInput = z.infer<typeof CreateAssignmentSchema>

/** Every field is optional; which of them a run has already frozen is `ASSIGNMENT_IN_USE`'s job. */
export const UpdateAssignmentSchema = z.object({
  label: label.optional(),
  packageVersionId: z.uuid().optional(),
  variantId: z.uuid().optional(),
  runType: RunTypeSchema.optional(),
  workingClockSeconds: workingClockSeconds.nullish(),
  weight: weight.nullish(),
  isWalkthrough: z.boolean().optional(),
  opensAt: z.coerce.date().nullish(),
})
export type UpdateAssignmentInput = z.infer<typeof UpdateAssignmentSchema>

// ---------------------------------------------------------------------------------------------
// Server Action inputs (07 §11): the path parameters travel in the same object as the body
// ---------------------------------------------------------------------------------------------

export const CreateCourseActionSchema = CreateCourseSchema.extend({ orgId: z.string().min(1) })
export const UpdateCoursePolicyActionSchema = UpdateCoursePolicySchema.extend({
  courseId: z.uuid(),
})
export const CreateSectionActionSchema = CreateSectionSchema.extend({ courseId: z.uuid() })
export const AddSectionMemberActionSchema = AddSectionMemberSchema.extend({ sectionId: z.uuid() })
export const RemoveSectionMemberActionSchema = SectionMemberParamsSchema
export const CreateAssignmentActionSchema = CreateAssignmentSchema.extend({ sectionId: z.uuid() })
export const UpdateAssignmentActionSchema = UpdateAssignmentSchema.extend({
  assignmentId: z.uuid(),
})
export const DeleteWalkthroughRunActionSchema = RunIdParamsSchema

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

export const CourseSchema = z.object({
  id: z.uuid(),
  organizationId: z.string(),
  name: z.string(),
  term: z.string(),
  outsideAiPolicy: OutsideAiPolicySchema,
  mapping: MappingSchema,
  defaultRunWeight: z.number(),
  critiqueWeightFactor: z.number(),
  taughtConcepts: z.array(z.string()),
})
export type Course = z.infer<typeof CourseSchema>

/** The courses list (UI-030): the table shows name, term, and how much is hanging off each row. */
export const CourseSummarySchema = CourseSchema.extend({
  sectionCount: z.number().int().nonnegative(),
  assignmentCount: z.number().int().nonnegative(),
})
export type CourseSummary = z.infer<typeof CourseSummarySchema>

export const SectionSchema = z.object({
  id: z.uuid(),
  courseId: z.uuid(),
  name: z.string(),
})
export type Section = z.infer<typeof SectionSchema>

/** A section as the course detail lists it, with the membership count 10 §3 asks `getCourse` for. */
export const SectionSummarySchema = SectionSchema.extend({
  memberCount: z.number().int().nonnegative(),
  assignmentCount: z.number().int().nonnegative(),
})
export type SectionSummary = z.infer<typeof SectionSummarySchema>

export const AssignmentSchema = z.object({
  id: z.uuid(),
  sectionId: z.uuid(),
  label: z.string(),
  runType: RunTypeSchema,
  packageVersionId: z.uuid(),
  variantId: z.uuid(),
  /** Null = the package value; `AssignmentView.effectiveWorkingClockSeconds` resolves it. */
  workingClockSeconds: z.number().int().nullable(),
  /** Null = the course default; `AssignmentView.effectiveWeight` resolves it. */
  weight: z.number().nullable(),
  isWalkthrough: z.boolean(),
  opensAt: z.iso.datetime().nullable(),
})
export type Assignment = z.infer<typeof AssignmentSchema>

/** `GET /courses/{courseId}`: policy, mapping, weights, sections with counts, assignments. */
export const CourseViewSchema = CourseSchema.extend({
  sections: z.array(SectionSummarySchema),
  assignments: z.array(AssignmentSchema),
})
export type CourseView = z.infer<typeof CourseViewSchema>

/**
 * `GET /assignments/{assignmentId}`: the assignment with what it points at, the two values the
 * form shows resolved, and where it sits. `inUse` is what locks the structural fields on UI-032:
 * true once a run that is not voided exists, which is the state `ASSIGNMENT_IN_USE` refuses in.
 */
export const AssignmentViewSchema = AssignmentSchema.extend({
  courseId: z.uuid(),
  courseName: z.string(),
  sectionName: z.string(),
  packageTitle: z.string(),
  packageVersion: z.number().int(),
  variantKey: VariantKeySchema,
  effectiveWorkingClockSeconds: z.number().int(),
  effectiveWeight: z.number(),
  inUse: z.boolean(),
})
export type AssignmentView = z.infer<typeof AssignmentViewSchema>

export const SectionMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.email(),
  role: SectionRoleSchema,
})
export type SectionMember = z.infer<typeof SectionMemberSchema>

/**
 * `GET /assignments/{assignmentId}/policy-display` (FR-201). `uncalibrated` and `countsStatement`
 * are constants of this build: no package is calibrated yet (PRD §7.19), and the run always counts
 * — the sentence itself is the i18n key `courses.countsStatement`, so the wire carries the flag and
 * the screen carries the words.
 */
export const PolicyDisplaySchema = z.object({
  outsideAiPolicy: OutsideAiPolicySchema,
  weight: z.number(),
  mapping: MappingSchema,
  runType: RunTypeSchema,
  workingClockSeconds: z.number().int(),
  uncalibrated: z.literal(true),
  countsStatement: z.literal(true),
})
export type PolicyDisplay = z.infer<typeof PolicyDisplaySchema>

/** The student's own latest attempt on an assignment; never another student's (08 §4). */
export const RunRefSchema = z.object({
  id: z.uuid(),
  attemptNo: z.number().int(),
  state: RunStateSchema,
  scoringStatus: ScoringStatusSchema,
})

/** `GET /me/assignments` (07 §3): assignments in the student's sections with that latest attempt. */
export const StudentAssignmentSchema = z.object({
  assignmentId: z.uuid(),
  label: z.string(),
  isWalkthrough: z.boolean(),
  opensAt: z.iso.datetime().nullable(),
  courseId: z.uuid(),
  courseName: z.string(),
  sectionId: z.uuid(),
  sectionName: z.string(),
  createdAt: z.iso.datetime(),
  latestRun: RunRefSchema.nullable(),
})
export type StudentAssignment = z.infer<typeof StudentAssignmentSchema>

export const CoursePageSchema = pageOf(CourseSummarySchema)
export const SectionMemberPageSchema = pageOf(SectionMemberSchema)
export const StudentAssignmentPageSchema = pageOf(StudentAssignmentSchema)
