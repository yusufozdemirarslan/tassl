// Validation and view schemas of the `tenancy` module (docs/tech/10-backend-spec-modules.md §2,
// §17; 07-api-spec.md §4). One schema per input, shared by the route, the Server Action, and the
// form; every output schema is the wire shape the route validates against before serializing.
//
// Dates leave the service as ISO strings (`z.iso.datetime()`), not `Date`s: the same view model is
// returned by a route (JSON) and by a Server Action (RSC payload), so it must already be the shape
// the client reads.
import { z } from 'zod'

// ---------------------------------------------------------------------------------------------
// Enumerations (08 §3, 06 §3.1)
// ---------------------------------------------------------------------------------------------

export const ORGANIZATION_ROLES = [
  'student',
  'instructor',
  'teaching_assistant',
  'scenario_author',
  'program_lead',
] as const

export const OrganizationRoleSchema = z.enum(ORGANIZATION_ROLES)
export type OrganizationRoleValue = z.infer<typeof OrganizationRoleSchema>

export const PlanSchema = z.enum([
  'pilot',
  'course_license',
  'department',
  'institution',
  'practice_pass',
])

export const AgreementPurposeSchema = z.enum([
  'scoring_audit',
  'scenario_calibration',
  'drift_review',
])

/** The only platform role a data agreement may admit (D-055, FR-234). */
export const AgreementPlatformRoleSchema = z.enum(['tassl_scenario_editor'])

/**
 * Points per confirmed band. The shape is validated here; the four-positive-numbers rule is a
 * business rule the service raises `MAPPING_INVALID` for (07 §4), so it is not a Zod refinement —
 * a refinement would answer `VALIDATION_ERROR` instead.
 */
export const MappingSchema = z.object({
  novice: z.number(),
  developing: z.number(),
  proficient: z.number(),
  professional: z.number(),
})
export type Mapping = z.infer<typeof MappingSchema>

// ---------------------------------------------------------------------------------------------
// Path parameters
// ---------------------------------------------------------------------------------------------

/** Organization ids are Better Auth text ids: an unknown one is 404, never 400 (07 §1). */
export const OrgIdParamsSchema = z.object({ orgId: z.string().min(1) })
export const InvitationIdParamsSchema = z.object({ invitationId: z.string().min(1) })
export const AgreementIdParamsSchema = z.object({ agreementId: z.uuid() })

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

export const CreateInstitutionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{3,60}$/),
  programLeadEmail: z.email(),
})
export type CreateInstitutionInput = z.infer<typeof CreateInstitutionSchema>

export const SetActiveInstitutionSchema = z.object({ orgId: z.string().min(1) })

export const UpdateInstitutionSettingsSchema = z.object({
  plan: PlanSchema.optional(),
  defaultMapping: MappingSchema.optional(),
})
export type UpdateInstitutionSettingsInput = z.infer<typeof UpdateInstitutionSettingsSchema>

export const InviteMemberSchema = z.object({
  email: z.email(),
  role: OrganizationRoleSchema,
})
export type InviteMemberInput = z.infer<typeof InviteMemberSchema>

/**
 * A data agreement as a program lead writes it (DATA-052). `purposes` is deliberately not
 * `.min(1)`: an empty list is `AGREEMENT_PURPOSES_INVALID` (400) from the service, which is the
 * code 07 §4 documents for this row.
 */
export const DataAgreementInputSchema = z.object({
  counterparty: z.string().trim().min(1).max(200),
  permittedPlatformRoles: z.array(AgreementPlatformRoleSchema),
  purposes: z.array(AgreementPurposeSchema),
  recordTypesCovered: z.array(z.string().trim().min(1)).optional(),
  recordTypesExcluded: z.array(z.string().trim().min(1)).optional(),
  retentionDays: z.number().int().positive(),
  documentReference: z.string().trim().min(1).max(200),
  signedAt: z.coerce.date(),
  endsAt: z.coerce.date().nullish(),
})
export type DataAgreementInput = z.infer<typeof DataAgreementInputSchema>

/** `PATCH /agreements/{agreementId}`: any subset of the fields above, merged onto the row. */
export const UpdateDataAgreementSchema = DataAgreementInputSchema.partial()
export type UpdateDataAgreementInput = z.infer<typeof UpdateDataAgreementSchema>

// ---------------------------------------------------------------------------------------------
// Server Action inputs (07 §11): the path parameters travel in the same object as the body
// ---------------------------------------------------------------------------------------------

export const InviteMemberActionSchema = InviteMemberSchema.extend({ orgId: z.string().min(1) })
export const AcceptInvitationActionSchema = InvitationIdParamsSchema
export const UpdateInstitutionSettingsActionSchema = UpdateInstitutionSettingsSchema.extend({
  orgId: z.string().min(1),
})
export const UpsertDataAgreementActionSchema = DataAgreementInputSchema.extend({
  orgId: z.string().min(1),
  id: z.uuid().optional(),
})
export type UpsertDataAgreementActionInput = z.infer<typeof UpsertDataAgreementActionSchema>

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

export const InstitutionSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
})
export type Institution = z.infer<typeof InstitutionSchema>

/** `GET /institutions`: the institutions the actor belongs to, each with the role they hold. */
export const MyInstitutionSchema = InstitutionSchema.extend({ role: OrganizationRoleSchema })
export type MyInstitution = z.infer<typeof MyInstitutionSchema>

export const InstitutionSettingsSchema = z.object({
  plan: PlanSchema,
  defaultMapping: MappingSchema,
})

export const InstitutionViewSchema = InstitutionSchema.extend({
  settings: InstitutionSettingsSchema,
})
export type InstitutionView = z.infer<typeof InstitutionViewSchema>

export const MembershipSchema = z.object({
  organizationId: z.string(),
  name: z.string(),
  role: OrganizationRoleSchema,
})
export type Membership = z.infer<typeof MembershipSchema>

/**
 * `status` is Better Auth's own column, so it stays a free string. `listInvitations` is the one
 * reader that resolves the clock into it: a stored `pending` row whose seven days have run out is
 * handed to the screen as `expired`, so the client renders a state rather than comparing a
 * deadline against its own `Date.now()` (D-177).
 */
export const InvitationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  email: z.email(),
  role: OrganizationRoleSchema,
  status: z.string(),
  expiresAt: z.iso.datetime(),
})
export type InvitationView = z.infer<typeof InvitationSchema>

/**
 * `getInvitation`: what the accept screen (UI-005) renders — the invitation plus the name of the
 * institution it is for. Only the recipient ever sees it.
 */
export const InvitationDetailSchema = InvitationSchema.extend({ organizationName: z.string() })
export type InvitationDetail = z.infer<typeof InvitationDetailSchema>

export const DataAgreementSchema = z.object({
  id: z.uuid(),
  organizationId: z.string(),
  counterparty: z.string(),
  permittedPlatformRoles: z.array(z.string()),
  purposes: z.array(AgreementPurposeSchema),
  recordTypesCovered: z.array(z.string()),
  recordTypesExcluded: z.array(z.string()),
  retentionDays: z.number().int(),
  documentReference: z.string(),
  signedAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
})
export type DataAgreementView = z.infer<typeof DataAgreementSchema>
