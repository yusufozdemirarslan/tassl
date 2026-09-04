// Service of the `courses` module (docs/tech/10-backend-spec-modules.md §3; 07-api-spec.md §5;
// 08-auth-authz.md §4, §5). Courses, sections, rosters, assignments, and the policy display the
// run start screen reads (FR-200, FR-201, FR-205, SYS-005, DATA-008 to DATA-011, D-061, D-062,
// D-104).
//
// Four rules shape every function here:
//
//   1. The actor comes first and its permission helper is the first statement (08 §5). Where the
//      resource is addressed by an id that does not name its tenant (a course, a section, an
//      assignment, a run), the guard is what resolves the tenant; nothing below trusts an
//      organization id from the input.
//   2. A resource the actor's institutions do not contain answers NOT_FOUND, never FORBIDDEN, so
//      an id cannot be probed for existence (07 §1 "Tenancy", 08 §4 "Cross-tenant"). FORBIDDEN is
//      reserved for someone who can see the resource but holds the wrong role.
//   3. Every rule that carries its own error code (10 §3) is one call to `./errors.ts`, so a code
//      and the condition it names cannot drift apart.
//   4. Analytics fire after the writing transaction commits (17 §5.4), never inside it.
//
// Four functions of 10 §3 are deliberately absent: `previewMappingChange`, `changeMapping` and
// `recomputeExports` belong to Phase 11 (FR-206, D-095 — `updateCoursePolicy` here accepts a
// mapping only while no run is confirmed), and `listAssignmentRuns` belongs to Phase 6, which owns
// the run states it summarizes.
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { track } from '@/server/analytics/track'
import type { OrganizationRole } from '@/server/auth/access-control-shared'
import {
  requireCourseInstructor,
  requireMembership,
  requireRunInstructor,
  requireSectionRole,
  type SectionRole,
} from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
import { audit } from '@/server/modules/admin'
import { getInstitutionSettings, listMyInstitutions } from '@/server/modules/tenancy'
import {
  assignmentInUse,
  assignmentNotFound,
  courseNotFound,
  forbidden,
  mappingChangeUnconfirmed,
  mappingInvalid,
  memberHasRuns,
  notSectionMember,
  packageNotConfirmed,
  runNotFound,
  sectionNotFound,
  variantMismatch,
} from './errors'
import * as repo from './repository'
import {
  MappingSchema,
  type AddSectionMemberInput,
  type Assignment,
  type AssignmentView,
  type ConfirmedPackageVersion,
  type Course,
  type CourseSummary,
  type CourseView,
  type CreateAssignmentInput,
  type CreateCourseInput,
  type CreateSectionInput,
  type Mapping,
  type MappingInput,
  type PageQuery,
  type PolicyDisplay,
  type Section,
  type SectionMember,
  type StudentAssignment,
  type UpdateAssignmentInput,
  type UpdateCoursePolicyInput,
  type VariantKeyValue,
} from './schema'

/** Organization roles that see every course of the institution (10 §3 `listCourses`). */
const COURSE_READERS: readonly OrganizationRole[] = ['instructor', 'program_lead']

/** Section roles that may read the assignment and its policy display (07 §5 "S (section member)"). */
const SECTION_MEMBER_ROLES: readonly SectionRole[] = ['student', 'instructor', 'ta']

/** The fields of an assignment a started run freezes (10 §3 `ASSIGNMENT_IN_USE`). */
const STRUCTURAL_ASSIGNMENT_FIELDS = [
  'packageVersionId',
  'variantId',
  'runType',
  'workingClockSeconds',
  'weight',
] as const

// ---------------------------------------------------------------------------------------------
// Small conversions
//
// `numeric` columns reach the repository as strings and `timestamptz` as Dates; both are converted
// once, here, so no screen ever has to (07 §1, 09 §2).
// ---------------------------------------------------------------------------------------------

const iso = (value: Date): string => value.toISOString()
const isoOrNull = (value: Date | null): string | null => (value === null ? null : iso(value))
const num = (value: string): number => Number(value)
const numOrNull = (value: string | null): number | null => (value === null ? null : Number(value))

const has = <T extends object>(input: T, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(input, key)

const sameMapping = (a: Mapping, b: Mapping): boolean =>
  a.novice === b.novice &&
  a.developing === b.developing &&
  a.proficient === b.proficient &&
  a.professional === b.professional

// ---------------------------------------------------------------------------------------------
// Business rules that carry their own error code
// ---------------------------------------------------------------------------------------------

/**
 * A band mapping is four positive, finite numbers (10 §17). `MappingSchema` is the rule; the wire
 * schema accepts the shape so that a bad mapping answers `MAPPING_INVALID` (400) — the code 07 §5
 * documents for these rows — rather than the generic validation failure a refinement would produce.
 */
function assertMapping(mapping: MappingInput | undefined): Mapping | undefined {
  if (mapping === undefined) return undefined
  const parsed = MappingSchema.safeParse(mapping)
  if (!parsed.success) mappingInvalid()
  return parsed.data
}

// ---------------------------------------------------------------------------------------------
// Resolving a resource to its tenant
//
// A course, a section, an assignment and a run are addressed without their institution, so the
// tenant is found by asking each institution the actor belongs to — which is also the tenancy
// check: an id in an institution they do not belong to is simply not found (rule 2 above). Every
// repository call below is still `tenantId` first (D-006).
// ---------------------------------------------------------------------------------------------

async function tenantsOf(actor: SessionUser): Promise<string[]> {
  const institutions = await listMyInstitutions(actor)
  const ids = institutions.map((institution) => institution.id)
  // The session's active institution is tried first, which is the only one in the common case.
  const active = actor.activeOrganizationId
  if (active && ids.includes(active)) return [active, ...ids.filter((id) => id !== active)]
  return ids
}

async function resolveCourse(actor: SessionUser, courseId: string): Promise<repo.Course> {
  for (const tenantId of await tenantsOf(actor)) {
    const course = await repo.findCourse(tenantId, courseId)
    if (course) return course
  }
  courseNotFound()
}

async function resolveSection(
  actor: SessionUser,
  sectionId: string,
): Promise<repo.SectionWithCourse> {
  for (const tenantId of await tenantsOf(actor)) {
    const found = await repo.findSectionWithCourse(tenantId, sectionId)
    if (found) return found
  }
  sectionNotFound()
}

async function resolveAssignment(
  actor: SessionUser,
  assignmentId: string,
): Promise<repo.AssignmentContext> {
  for (const tenantId of await tenantsOf(actor)) {
    const found = await repo.findAssignmentWithContext(tenantId, assignmentId)
    if (found) return found
  }
  assignmentNotFound()
}

// ---------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------

/** Institution membership, with a non-member answered NOT_FOUND rather than FORBIDDEN (rule 2). */
async function requireVisibleMembership(
  actor: SessionUser,
  orgId: string,
): Promise<OrganizationRole> {
  try {
    return await requireMembership(actor, orgId)
  } catch (error) {
    if (isAppError(error) && error.code === 'FORBIDDEN') courseNotFound()
    throw error
  }
}

/** True when the actor holds one of `roles` in the section; the throwing form is 08 §5's helper. */
async function heldSectionRole(
  actor: SessionUser,
  sectionId: string,
  roles: readonly SectionRole[],
): Promise<boolean> {
  try {
    await requireSectionRole(actor, sectionId, roles)
    return true
  } catch (error) {
    if (isAppError(error) && (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')) {
      return false
    }
    throw error
  }
}

/** True when 08 §5's `requireCourseInstructor` would pass: the creator, or a section instructor. */
async function instructsCourse(actor: SessionUser, courseId: string): Promise<boolean> {
  try {
    await requireCourseInstructor(actor, courseId)
    return true
  } catch (error) {
    if (isAppError(error) && (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')) {
      return false
    }
    throw error
  }
}

/**
 * The instructor of the course a section belongs to (07 §5 "Ins"). 08 §5's `requireCourseInstructor`
 * is the check, because the section's own instructor is one of the two people it admits and the
 * other — the course's creator — is the only one who exists in the moment between creating a
 * section and putting anyone in it (D-062).
 */
async function requireSectionInstructor(
  actor: SessionUser,
  sectionId: string,
): Promise<{ organizationId: string; section: repo.Section; course: repo.Course }> {
  const found = await resolveSection(actor, sectionId)
  await requireCourseInstructor(actor, found.course.id)
  return { organizationId: found.course.organizationId, ...found }
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

function toCourse(row: repo.Course): Course {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    term: row.term,
    outsideAiPolicy: row.outsideAiPolicy,
    mapping: row.mapping,
    defaultRunWeight: num(row.defaultRunWeight),
    critiqueWeightFactor: num(row.critiqueWeightFactor),
    taughtConcepts: row.taughtConcepts,
  }
}

const toSection = (row: repo.Section): Section => ({
  id: row.id,
  courseId: row.courseId,
  name: row.name,
})

function toAssignment(row: repo.Assignment): Assignment {
  return {
    id: row.id,
    sectionId: row.sectionId,
    label: row.label,
    runType: row.runType,
    packageVersionId: row.packageVersionId,
    variantId: row.variantId,
    workingClockSeconds: row.workingClockSeconds,
    weight: numOrNull(row.weight),
    isWalkthrough: row.isWalkthrough,
    opensAt: isoOrNull(row.opensAt),
  }
}

const toSectionMember = (row: repo.SectionMemberPageRow): SectionMember => ({
  userId: row.user.id,
  name: row.user.name,
  email: row.user.email,
  role: row.role,
})

function toStudentAssignment(row: repo.StudentAssignmentPageRow): StudentAssignment {
  const { assignment, section, course, latestRun } = row
  return {
    assignmentId: assignment.id,
    label: assignment.label,
    isWalkthrough: assignment.isWalkthrough,
    opensAt: isoOrNull(assignment.opensAt),
    courseId: course.id,
    courseName: course.name,
    sectionId: section.id,
    sectionName: section.name,
    createdAt: iso(assignment.createdAt),
    latestRun: latestRun
      ? {
          id: latestRun.id,
          attemptNo: latestRun.attemptNo,
          state: latestRun.state,
          scoringStatus: latestRun.scoringStatus,
        }
      : null,
  }
}

// ---------------------------------------------------------------------------------------------
// Analytics (17 §3.1)
// ---------------------------------------------------------------------------------------------

/**
 * `ms_since_first_sign_in` is `now − user.created_at` (17 §3.1): the account row is written at
 * sign-up or at the first Google sign-in, which is the PRD's "instructor access" instant. An
 * account row that has vanished under the session reports 0 rather than failing the write.
 */
async function msSinceFirstSignIn(actor: SessionUser): Promise<number> {
  const createdAt = await repo.findUserCreatedAt(actor.id)
  if (!createdAt) return 0
  return Math.max(0, Date.now() - createdAt.getTime())
}

// ---------------------------------------------------------------------------------------------
// Courses (FR-200, FR-205)
// ---------------------------------------------------------------------------------------------

/**
 * Creates a course for an institution the actor teaches in (10 §3). The mapping defaults to the
 * institution's `default_mapping`, so a course that never touches the editor still carries the four
 * numbers the debrief needs (PRD §7.19).
 */
export async function createCourse(
  actor: SessionUser,
  orgId: string,
  input: CreateCourseInput,
): Promise<Course> {
  const role = await requireVisibleMembership(actor, orgId)
  if (role !== 'instructor') forbidden()

  const settings = await getInstitutionSettings(actor, orgId)
  const requested = assertMapping(input.mapping)
  const mapping = requested ?? settings.settings.defaultMapping

  const row = await repo.withTransaction((tx) =>
    repo.insertCourse(
      orgId,
      {
        name: input.name,
        term: input.term,
        ...(input.outsideAiPolicy === undefined ? {} : { outsideAiPolicy: input.outsideAiPolicy }),
        mapping,
        ...(input.defaultRunWeight === undefined
          ? {}
          : { defaultRunWeight: String(input.defaultRunWeight) }),
        ...(input.taughtConcepts === undefined ? {} : { taughtConcepts: input.taughtConcepts }),
        createdBy: actor.id,
      },
      tx,
    ),
  )

  // AN-002 (17 §3.1): fired after the row exists, never before.
  track(
    'course_created',
    {
      course_id: row.id,
      outside_ai_policy: row.outsideAiPolicy,
      mapping_is_default: sameMapping(mapping, settings.settings.defaultMapping),
      ms_since_first_sign_in: await msSinceFirstSignIn(actor),
    },
    { userId: actor.id, organizationId: orgId },
  )
  return toCourse(row)
}

/**
 * The institution's courses (10 §3): instructors and program leads see all of them, everyone else
 * sees the courses they hold a section membership in — a student's list is their enrolment.
 */
export async function listCourses(
  actor: SessionUser,
  orgId: string,
  input: PageQuery = {},
): Promise<repo.Page<CourseSummary>> {
  const role = await requireVisibleMembership(actor, orgId)
  const page = COURSE_READERS.includes(role)
    ? await repo.pageCoursesForOrg(orgId, input)
    : await repo.pageCoursesForStudent(orgId, actor.id, input)

  const counts = await repo.countCourseChildren(
    orgId,
    page.items.map((course) => course.id),
  )
  const byCourse = new Map(counts.map((row) => [row.courseId, row]))
  return {
    items: page.items.map((course) => {
      const count = byCourse.get(course.id)
      return {
        ...toCourse(course),
        sectionCount: count?.sectionCount ?? 0,
        assignmentCount: count?.assignmentCount ?? 0,
      }
    }),
    nextCursor: page.nextCursor,
  }
}

/**
 * The course with its sections (each with the membership count 10 §3 asks for), its assignments,
 * its policy, its mapping and its weights. Readable by an institution instructor or program lead,
 * and by anyone who holds a membership in one of the course's sections (07 §5).
 */
export async function getCourse(actor: SessionUser, courseId: string): Promise<CourseView> {
  const course = await resolveCourse(actor, courseId)
  const role = await requireVisibleMembership(actor, course.organizationId)
  if (!COURSE_READERS.includes(role)) {
    const membership = await repo.findCourseMembership(course.organizationId, courseId, actor.id)
    if (!membership) forbidden()
  }

  const [sections, assignments] = await Promise.all([
    repo.listSectionsForCourse(course.organizationId, courseId),
    repo.listAssignmentsForCourse(course.organizationId, courseId),
  ])
  return {
    ...toCourse(course),
    sections: sections.map((row) => ({
      ...toSection(row.section),
      memberCount: row.memberCount,
      assignmentCount: row.assignmentCount,
    })),
    assignments: assignments.map(toAssignment),
  }
}

/**
 * Policy, weights, taught concepts (FR-205) — and the mapping, but only while the course has no
 * confirmed run: changing it afterwards re-points every confirmed run's points, which is the
 * preview-and-recompute flow Phase 11 owns (FR-206, D-095). Until then that attempt is
 * `MAPPING_CHANGE_UNCONFIRMED`.
 */
export async function updateCoursePolicy(
  actor: SessionUser,
  courseId: string,
  input: UpdateCoursePolicyInput,
): Promise<Course> {
  const scope = await requireCourseInstructor(actor, courseId)
  const mapping = assertMapping(input.mapping)
  if (mapping) {
    const confirmed = await repo.countConfirmedRunsForCourse(scope.organizationId, courseId)
    if (confirmed > 0) mappingChangeUnconfirmed()
  }

  const row = await repo.withTransaction((tx) =>
    repo.updateCourse(
      scope.organizationId,
      courseId,
      {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.term === undefined ? {} : { term: input.term }),
        ...(input.outsideAiPolicy === undefined ? {} : { outsideAiPolicy: input.outsideAiPolicy }),
        ...(mapping === undefined ? {} : { mapping }),
        ...(input.defaultRunWeight === undefined
          ? {}
          : { defaultRunWeight: String(input.defaultRunWeight) }),
        ...(input.critiqueWeightFactor === undefined
          ? {}
          : { critiqueWeightFactor: String(input.critiqueWeightFactor) }),
        ...(input.taughtConcepts === undefined ? {} : { taughtConcepts: input.taughtConcepts }),
      },
      tx,
    ),
  )
  if (!row) courseNotFound()
  return toCourse(row)
}

// ---------------------------------------------------------------------------------------------
// Sections and the roster (SYS-005, D-062)
// ---------------------------------------------------------------------------------------------

export async function createSection(
  actor: SessionUser,
  courseId: string,
  input: CreateSectionInput,
): Promise<Section> {
  const scope = await requireCourseInstructor(actor, courseId)
  const row = await repo.withTransaction((tx) =>
    repo.insertSection(scope.organizationId, { courseId, name: input.name }, tx),
  )
  return toSection(row)
}

/**
 * Adds an existing institution member to the section by email (D-062). An address that is not a
 * member yet is `NOT_SECTION_MEMBER`, which is what makes the roster screen offer the invitation
 * instead (UI-031); the invitation itself is tenancy's, not this module's.
 */
export async function addSectionMember(
  actor: SessionUser,
  sectionId: string,
  input: AddSectionMemberInput,
): Promise<SectionMember> {
  const scope = await requireSectionInstructor(actor, sectionId)

  const person = await repo.findOrgMemberByEmail(scope.organizationId, input.email)
  if (!person) notSectionMember()

  const membership = await repo.withTransaction(async (tx) => {
    const row = await repo.upsertSectionMembership(
      scope.organizationId,
      { sectionId, userId: person.id, role: input.role },
      tx,
    )
    if (!row) sectionNotFound()
    await audit(tx, {
      actorId: actor.id,
      orgId: scope.organizationId,
      action: 'section_member.add',
      targetType: 'section_membership',
      targetId: row.id,
      // The address is on the row itself; audit metadata carries no email (10 §3 redaction).
      metadata: { sectionId, role: input.role, userId: person.id },
    })
    return row
  })

  return { userId: person.id, name: person.name, email: person.email, role: membership.role }
}

/**
 * Removes a membership. Refused while the person has a run in the section that is not voided
 * (`MEMBER_HAS_RUNS`): the roster is what a run's reviewer scope is read from, so dropping someone
 * mid-course would orphan their work.
 */
export async function removeSectionMember(
  actor: SessionUser,
  sectionId: string,
  userId: string,
): Promise<void> {
  const scope = await requireSectionInstructor(actor, sectionId)

  const runs = await repo.countActiveRunsForSectionMember(scope.organizationId, sectionId, userId)
  if (runs > 0) memberHasRuns()

  const removed = await repo.withTransaction((tx) =>
    repo.deleteSectionMembership(scope.organizationId, sectionId, userId, tx),
  )
  if (!removed) sectionNotFound()
}

/** The roster (SYS-005): the section's instructor, or a program lead of the institution (07 §5). */
export async function listSectionMembers(
  actor: SessionUser,
  sectionId: string,
  input: PageQuery = {},
): Promise<repo.Page<SectionMember>> {
  const found = await resolveSection(actor, sectionId)
  const role = await requireVisibleMembership(actor, found.course.organizationId)
  if (role !== 'program_lead' && !(await instructsCourse(actor, found.course.id))) forbidden()

  const page = await repo.pageSectionMembers(found.course.organizationId, sectionId, input)
  return { items: page.items.map(toSectionMember), nextCursor: page.nextCursor }
}

// ---------------------------------------------------------------------------------------------
// Assignments (FR-200)
// ---------------------------------------------------------------------------------------------

/** The confirmed version and the variant that belongs to it (10 §3), or the code that refuses. */
async function requirePackageVersionAndVariant(
  tenantId: string,
  packageVersionId: string,
  variantId: string,
): Promise<{ version: repo.ScenarioPackageVersion; variant: repo.ScenarioVariant }> {
  const found = await repo.findPackageVersion(tenantId, packageVersionId)
  if (!found) packageNotConfirmed()
  if (found.version.status !== 'confirmed') packageNotConfirmed()
  const variant = await repo.findVariantOfVersion(packageVersionId, variantId)
  if (!variant) variantMismatch()
  return { version: found.version, variant }
}

/**
 * The confirmed versions of an institution with the live variants of each (10 §3's package select).
 * Both screens that point an assignment at a version need the whole shelf: UI-030's "New assignment"
 * to choose one, UI-032 to re-point an existing assignment, and a version's own variants are what
 * its radio offers.
 *
 * The read belongs to the scenarios module, which Phase 5 owns; until that module exists this is
 * the only place it can honestly live, because `courses` is what already resolves the institution
 * and already reads these two tables (`requirePackageVersionAndVariant`). Phase 5 may move it.
 *
 * Instructors and program leads only: a student never chooses a package version (08 §4).
 */
export async function listConfirmedPackageVersions(
  actor: SessionUser,
  orgId: string,
): Promise<ConfirmedPackageVersion[]> {
  const role = await requireVisibleMembership(actor, orgId)
  if (!COURSE_READERS.includes(role)) forbidden()

  const versions = await repo.listConfirmedPackageVersions(orgId)
  const variants = await repo.listVariantsOfVersions(
    orgId,
    versions.map((row) => row.version.id),
  )

  const byVersion = new Map<string, Array<{ id: string; key: VariantKeyValue }>>()
  for (const variant of variants) {
    const list = byVersion.get(variant.packageVersionId)
    if (list) list.push({ id: variant.id, key: variant.key })
    else byVersion.set(variant.packageVersionId, [{ id: variant.id, key: variant.key }])
  }

  return versions.map((row) => ({
    id: row.version.id,
    version: row.version.version,
    packageTitle: row.packageTitle,
    calibrationStatus: row.version.calibrationStatus,
    workingClockSeconds: row.version.workingClockSeconds,
    variants: byVersion.get(row.version.id) ?? [],
  }))
}

export async function createAssignment(
  actor: SessionUser,
  sectionId: string,
  input: CreateAssignmentInput,
): Promise<Assignment> {
  const scope = await requireSectionInstructor(actor, sectionId)
  const { version, variant } = await requirePackageVersionAndVariant(
    scope.organizationId,
    input.packageVersionId,
    input.variantId,
  )

  const row = await repo.withTransaction((tx) =>
    repo.insertAssignment(
      scope.organizationId,
      {
        sectionId,
        label: input.label,
        ...(input.runType === undefined ? {} : { runType: input.runType }),
        packageVersionId: input.packageVersionId,
        variantId: input.variantId,
        ...(input.workingClockSeconds === undefined
          ? {}
          : { workingClockSeconds: input.workingClockSeconds }),
        ...(input.weight === undefined ? {} : { weight: String(input.weight) }),
        ...(input.isWalkthrough === undefined ? {} : { isWalkthrough: input.isWalkthrough }),
        ...(input.opensAt === undefined || input.opensAt === null
          ? {}
          : { opensAt: input.opensAt }),
      },
      tx,
    ),
  )

  await trackAssignment(actor, scope.course, row, version, variant, true)
  return toAssignment(row)
}

/**
 * Changes an assignment's configuration. Once a run that is not voided exists the setup is what
 * that run was taken under, so only the three fields that do not change the run itself stay open —
 * label, walkthrough flag, opening time — and anything else is `ASSIGNMENT_IN_USE` (10 §3).
 */
export async function updateAssignment(
  actor: SessionUser,
  assignmentId: string,
  input: UpdateAssignmentInput,
): Promise<Assignment> {
  const context = await resolveAssignment(actor, assignmentId)
  await requireCourseInstructor(actor, context.course.id)
  const tenantId = context.course.organizationId

  const structural = STRUCTURAL_ASSIGNMENT_FIELDS.filter((field) => has(input, field))
  if (structural.length > 0) {
    const started = await repo.countActiveRunsForAssignment(tenantId, assignmentId)
    if (started > 0) assignmentInUse()
  }

  const packageVersionId = input.packageVersionId ?? context.assignment.packageVersionId
  const variantId = input.variantId ?? context.assignment.variantId
  const { version, variant } =
    input.packageVersionId === undefined && input.variantId === undefined
      ? { version: context.packageVersion, variant: context.variant }
      : await requirePackageVersionAndVariant(tenantId, packageVersionId, variantId)

  const row = await repo.withTransaction((tx) =>
    repo.updateAssignment(
      tenantId,
      assignmentId,
      {
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.runType === undefined ? {} : { runType: input.runType }),
        ...(input.packageVersionId === undefined ? {} : { packageVersionId }),
        ...(input.variantId === undefined ? {} : { variantId }),
        ...(has(input, 'workingClockSeconds')
          ? { workingClockSeconds: input.workingClockSeconds ?? null }
          : {}),
        ...(has(input, 'weight')
          ? {
              weight:
                input.weight === undefined || input.weight === null ? null : String(input.weight),
            }
          : {}),
        ...(input.isWalkthrough === undefined ? {} : { isWalkthrough: input.isWalkthrough }),
        ...(has(input, 'opensAt') ? { opensAt: input.opensAt ?? null } : {}),
      },
      tx,
    ),
  )
  if (!row) assignmentNotFound()

  await trackAssignment(actor, context.course, row, version, variant, false)
  return toAssignment(row)
}

/** AN-002 (17 §3.1); `is_new` is what separates the create from the edit. */
async function trackAssignment(
  actor: SessionUser,
  course: repo.Course,
  assignment: repo.Assignment,
  version: repo.ScenarioPackageVersion,
  variant: repo.ScenarioVariant,
  isNew: boolean,
): Promise<void> {
  track(
    'assignment_configured',
    {
      assignment_id: assignment.id,
      course_id: course.id,
      section_id: assignment.sectionId,
      package_version_id: assignment.packageVersionId,
      variant: variant.key,
      is_new: isNew,
      is_walkthrough: assignment.isWalkthrough,
      working_clock_seconds: assignment.workingClockSeconds ?? version.workingClockSeconds,
      weight_overridden: assignment.weight !== null,
      ms_since_first_sign_in: await msSinceFirstSignIn(actor),
    },
    { userId: actor.id, organizationId: course.organizationId },
  )
}

/**
 * The assignment with what it points at and the two values UI-032 shows resolved. Readable by any
 * member of its section (07 §5) and by the course's instructor, who configures it.
 */
export async function getAssignment(
  actor: SessionUser,
  assignmentId: string,
): Promise<AssignmentView> {
  const context = await resolveAssignment(actor, assignmentId)
  await requireAssignmentReader(actor, context)

  const tenantId = context.course.organizationId
  const packageRow = await repo.findPackageVersion(tenantId, context.assignment.packageVersionId)
  const started = await repo.countActiveRunsForAssignment(tenantId, assignmentId)
  return {
    ...toAssignment(context.assignment),
    courseId: context.course.id,
    courseName: context.course.name,
    sectionName: context.section.name,
    packageTitle: packageRow?.packageTitle ?? '',
    packageVersion: context.packageVersion.version,
    variantKey: context.variant.key,
    effectiveWorkingClockSeconds:
      context.assignment.workingClockSeconds ?? context.packageVersion.workingClockSeconds,
    effectiveWeight: numOrNull(context.assignment.weight) ?? num(context.course.defaultRunWeight),
    inUse: started > 0,
  }
}

/** A member of the assignment's section, or the instructor of its course (07 §5, 08 §4). */
async function requireAssignmentReader(
  actor: SessionUser,
  context: repo.AssignmentContext,
): Promise<void> {
  if (await heldSectionRole(actor, context.section.id, SECTION_MEMBER_ROLES)) return
  if (await instructsCourse(actor, context.course.id)) return
  forbidden()
}

/**
 * What the run start screen shows before the student may begin (FR-201, UI-021). `uncalibrated` and
 * `countsStatement` are constants of this build: no package version is calibrated yet (PRD §7.19),
 * and the run always counts — the sentence itself is `courses.countsStatement` in the i18n table,
 * so the wire carries the flag and the screen carries the words.
 */
export async function getPolicyDisplay(
  actor: SessionUser,
  assignmentId: string,
): Promise<PolicyDisplay> {
  const context = await resolveAssignment(actor, assignmentId)
  await requireAssignmentReader(actor, context)

  const { assignment, course, packageVersion } = context
  return {
    outsideAiPolicy: course.outsideAiPolicy,
    weight: numOrNull(assignment.weight) ?? num(course.defaultRunWeight),
    mapping: course.mapping,
    runType: assignment.runType,
    workingClockSeconds: assignment.workingClockSeconds ?? packageVersion.workingClockSeconds,
    uncalibrated: true,
    countsStatement: true,
  }
}

/**
 * The assignments in the actor's sections with their own latest attempt (07 §3 `GET
 * /me/assignments`). The actor is the whole scope — the query is keyed by their id and their
 * memberships — so no permission helper appears: another student's work is not reachable from here.
 */
export async function listMyAssignments(
  actor: SessionUser,
  input: PageQuery = {},
): Promise<repo.Page<StudentAssignment>> {
  const tenantId = (await tenantsOf(actor))[0]
  if (!tenantId) return { items: [], nextCursor: null }
  const page = await repo.pageAssignmentsForStudent(tenantId, actor.id, input)
  return { items: page.items.map(toStudentAssignment), nextCursor: page.nextCursor }
}

// ---------------------------------------------------------------------------------------------
// Walkthrough runs (D-104)
// ---------------------------------------------------------------------------------------------

/**
 * Deletes one run of a walkthrough assignment (D-104): the instructor of the run's section, and
 * only while `assignments.is_walkthrough` — a run that counts is never deleted, only voided
 * (Phase 11). The row goes with its children through the foreign keys, and the audit row is
 * written in the same transaction so the deletion is still visible afterwards (08 §4).
 */
export async function deleteWalkthroughRun(actor: SessionUser, runId: string): Promise<void> {
  const scope = await requireRunInstructor(actor, runId)

  const found = await repo.findRunWithAssignment(scope.organizationId, runId)
  if (!found) runNotFound()
  if (!found.assignment.isWalkthrough) forbidden(t('courses.runNotWalkthrough'))

  await repo.withTransaction(async (tx) => {
    const deleted = await repo.deleteRun(scope.organizationId, runId, tx)
    if (!deleted) runNotFound()
    await audit(tx, {
      actorId: actor.id,
      orgId: scope.organizationId,
      action: 'run.delete',
      targetType: 'run',
      targetId: runId,
      metadata: {
        assignmentId: found.assignment.id,
        sectionId: found.section.id,
        attemptNo: found.run.attemptNo,
        state: found.run.state,
      },
    })
  })
}
