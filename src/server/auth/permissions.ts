// Permission helpers (docs/tech/08-auth-authz.md §5). The matrix in 08 §4 is the source of truth;
// these functions are the only place it is enforced. Routes and Server Actions call them, and every
// service that touches a run, package, course, or agreement calls the matching helper as its first
// statement, so a missed check in a handler cannot widen access.
//
// Shape rules, applied without exception:
//   - the actor comes first, so a helper can never be called without one;
//   - a helper throws `AppError('FORBIDDEN')` (or `'UNAUTHENTICATED'`) and otherwise returns the
//     scope it proved, so the caller does not repeat the lookup;
//   - a resource in another organization answers `NOT_FOUND`, never `FORBIDDEN`, so an id cannot be
//     probed for existence (08 §4 "Cross-tenant").
import { AppError, isAppError } from '@/lib/errors'
import {
  findActiveAgreement,
  findCourse,
  findOrganizationRole,
  findPackage,
  findRunContext,
  findSectionMembership,
  teachesCourse,
} from '@/server/auth/queries'
import type { PlatformRole, SessionUser } from '@/server/auth/types'
import type { OrganizationRole } from '@/server/auth/access-control-shared'

export { getSession, requireSession } from '@/server/auth/session'
export type { PlatformRole, SessionUser } from '@/server/auth/types'

/** `section_memberships.role` (08 §3). */
export type SectionRole = 'student' | 'instructor' | 'ta'

/** What `requireSectionRole` proved: the role held and the organization the section belongs to. */
export type SectionScope = { sectionId: string; role: SectionRole; organizationId: string }

/** What the run guards proved. */
export type RunScope = {
  runId: string
  organizationId: string
  studentId: string
  sectionId: string
  /** The course the run's section belongs to; what `canReviewSection` is asked about (D-483). */
  courseId: string
}

const REVIEWER_ROLES: readonly SectionRole[] = ['instructor', 'ta']

/** Organization roles that may author a package (08 §4 "Create package from seed"). */
const PACKAGE_AUTHOR_ROLES: readonly OrganizationRole[] = ['instructor', 'scenario_author']

// Function declarations, not arrows: TypeScript only narrows after a `never`-returning call when the
// callee is a function declaration (or an explicitly annotated const) — the narrowing is what lets
// every guard below read `if (!row) notFound()` and then use `row`.
function forbidden(): never {
  throw new AppError('FORBIDDEN')
}

function notFound(): never {
  throw new AppError('NOT_FOUND')
}

// ---------------------------------------------------------------------------------------------
// Platform and organization
// ---------------------------------------------------------------------------------------------

/** `user.platform_role === role`; `admin` satisfies every platform-role check (08 §5). */
export function requirePlatformRole(actor: SessionUser, role: PlatformRole): PlatformRole {
  if (actor.platformRole === 'admin') return actor.platformRole
  if (actor.platformRole !== role) forbidden()
  return actor.platformRole
}

/**
 * A `member` row in the organization, with a role in `roles` when given (08 §5). The platform
 * `admin` role is deliberately not a bypass: 08 §4 gives the admin platform operations, not the
 * institution's own course and run operations.
 */
export async function requireMembership(
  actor: SessionUser,
  orgId: string,
  roles?: readonly OrganizationRole[],
): Promise<OrganizationRole> {
  const role = await findOrganizationRole(actor.id, orgId)
  if (role === null) forbidden()
  if (roles && !roles.includes(role as OrganizationRole)) forbidden()
  return role as OrganizationRole
}

// ---------------------------------------------------------------------------------------------
// Sections and courses
// ---------------------------------------------------------------------------------------------

/**
 * A `section_memberships` row on a live section with a role in `roles` (08 §5). The organization is
 * read from the section itself, so the scope handed back is the section's tenant, never the actor's
 * active organization.
 */
export async function requireSectionRole(
  actor: SessionUser,
  sectionId: string,
  roles: readonly SectionRole[],
): Promise<SectionScope> {
  const membership = await findSectionMembership(actor.id, sectionId)
  if (!membership) forbidden()
  const role = membership.role as SectionRole
  if (!roles.includes(role)) forbidden()
  return { sectionId, role, organizationId: membership.organizationId }
}

/**
 * The course's creator, or an `instructor` in one of its sections (08 §5). A course the actor's
 * organization does not contain answers NOT_FOUND rather than FORBIDDEN.
 *
 * **Creating a course is not a permission that outlives the seat that had it** (D-516). The
 * creator branch used to ask only whether an organization membership *existed*, not what it was —
 * so a course's creator who was later demoted to `student` or `teaching_assistant` still held every
 * operation this guard admits: the mapping, the assignments, the runs, and now the export history
 * and the replay link on it. `courses.created_by` is a record of who made the row, not a grant. The
 * grant is 08 §3's `instructor` organization role, which is the only one the access-control
 * statement gives `course: update` to.
 *
 * The second branch is untouched and needs no role check of its own: a live `instructor` row on a
 * section of this course *is* the grant 08 §4 names, and it is the one a demoted creator who still
 * teaches a section keeps.
 */
export async function requireCourseInstructor(
  actor: SessionUser,
  courseId: string,
): Promise<{ courseId: string; organizationId: string }> {
  const course = await findCourse(courseId)
  if (!course) notFound()
  const orgRole = await findOrganizationRole(actor.id, course.organizationId)
  if (orgRole === null) notFound()
  const isInstructor =
    (course.createdBy === actor.id && orgRole === 'instructor') ||
    (await teachesCourse(actor.id, courseId))
  if (!isInstructor) forbidden()
  return { courseId, organizationId: course.organizationId }
}

/**
 * A reviewer of a section: an `instructor` or `ta` row on it, **or** the instructor of its course
 * (08 §4 "Reviewer", read with D-062 and §5's `requireCourseInstructor`).
 *
 * The second half is not a widening. 08 §5 already reads "the section's instructor" as "the course's
 * creator, or an instructor in one of its sections" — that is what `requireCourseInstructor` is, and
 * `courses.requireSectionInstructor` uses it for exactly the reason D-062 gives: between creating a
 * section and putting anyone in it, the course's creator is the only instructor who exists. A guard
 * that asked only for the section row refused an instructor the runs and the exports on their own
 * course's assignment, which is why this is one predicate rather than two that agree by hand
 * (D-483).
 *
 * Returns a boolean rather than throwing, because both callers need it twice over: once to gate the
 * read and once to decide whether a screen offers the link that leads to it.
 */
export async function canReviewSection(
  actor: SessionUser,
  courseId: string,
  sectionId: string,
): Promise<boolean> {
  const membership = await findSectionMembership(actor.id, sectionId)
  if (membership && REVIEWER_ROLES.includes(membership.role as SectionRole)) return true
  try {
    await requireCourseInstructor(actor, courseId)
    return true
  } catch (error) {
    if (isAppError(error) && (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND'))
      return false
    throw error
  }
}

/** The throwing form of `canReviewSection`, for a service that gates a read on it (08 §5). */
export async function requireSectionReviewer(
  actor: SessionUser,
  courseId: string,
  sectionId: string,
): Promise<void> {
  if (!(await canReviewSection(actor, courseId, sectionId))) forbidden()
}

// ---------------------------------------------------------------------------------------------
// Runs
//
// The run row and its section exist from Phase 2, so ownership and reviewer role are enforced here
// already. Phase 6 (the runs module) adds the remaining half of 08 §5 — "and run state allows the
// action" — as a state argument on these helpers; until a run exists every call answers NOT_FOUND.
// ---------------------------------------------------------------------------------------------

async function requireRun(runId: string): Promise<RunScope> {
  const run = await findRunContext(runId)
  if (!run) notFound()
  return run
}

/** `runs.student_id === actor.id`. Another student's run is NOT_FOUND, not FORBIDDEN (08 §4). */
export async function requireRunOwner(actor: SessionUser, runId: string): Promise<RunScope> {
  const run = await requireRun(runId)
  if (run.studentId !== actor.id) notFound()
  return run
}

/** Section role `instructor` or `ta` on the run's section (08 §5). */
export async function requireRunReviewer(actor: SessionUser, runId: string): Promise<RunScope> {
  const run = await requireRun(runId)
  const membership = await findSectionMembership(actor.id, run.sectionId)
  if (!membership) notFound()
  // A classmate holds a section row and no read of anybody else's run (08 §4): NOT_FOUND, the
  // same answer a stranger gets, so a run id cannot be probed for existence from the next seat.
  // The run's own student is FORBIDDEN: they know the run exists, and the answer says whose
  // screen this is.
  if (membership.role === 'student') {
    if (run.studentId === actor.id) forbidden()
    notFound()
  }
  if (!REVIEWER_ROLES.includes(membership.role as SectionRole)) forbidden()
  return run
}

/**
 * The reader of a filed **course export** (08 §4, D-483).
 *
 * 08 §4 puts "Download a filed course export" and "list an assignment's export history" on one row,
 * so they take one predicate: `canReviewSection`, which is `requireRunReviewer`'s section row *or*
 * the instructor of the course above it. Without this the export history a course's own instructor
 * can now open would list rows whose every download answered 404 — the defect D-483 fixes, one level
 * down. It stays separate from `requireRunReviewer`, which guards the replay, the debrief and the
 * record-form file: those are one student's run, and a section row is the whole of their gate.
 *
 * The two refusals keep `requireRunReviewer`'s meaning. A seat with no section row and no course
 * gets NOT_FOUND, so a run id cannot be probed for existence; a seat that can see the section but
 * holds the wrong role there gets FORBIDDEN.
 */
export async function requireCourseExportReader(
  actor: SessionUser,
  runId: string,
): Promise<RunScope> {
  const run = await requireRun(runId)
  if (await canReviewSection(actor, run.courseId, run.sectionId)) return run
  const membership = await findSectionMembership(actor.id, run.sectionId)
  if (membership && (membership.role !== 'student' || run.studentId === actor.id)) forbidden()
  notFound()
}

/** Section role `instructor` on the run's section (08 §5); a TA is FORBIDDEN, not NOT_FOUND. */
export async function requireRunInstructor(actor: SessionUser, runId: string): Promise<RunScope> {
  const run = await requireRun(runId)
  const membership = await findSectionMembership(actor.id, run.sectionId)
  if (!membership) notFound()
  if (membership.role === 'student') {
    if (run.studentId === actor.id) forbidden()
    notFound()
  }
  if (membership.role !== 'instructor') forbidden()
  return run
}

// ---------------------------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------------------------

/**
 * Organization membership `instructor` or `scenario_author` in the package's organization — which
 * is also the platform editor's route in, since 08 §4 admits an editor only in an organization
 * where they hold a `scenario_author` membership. Phase 5 (the authoring module) adds the
 * confirmation rules that sit on top of this check.
 */
export async function requireAuthorOnPackage(
  actor: SessionUser,
  packageId: string,
): Promise<{ packageId: string; organizationId: string; role: OrganizationRole }> {
  const pkg = await findPackage(packageId)
  if (!pkg) notFound()
  const role = await findOrganizationRole(actor.id, pkg.organizationId)
  if (role === null) notFound()
  if (!PACKAGE_AUTHOR_ROLES.includes(role as OrganizationRole)) forbidden()
  return { packageId, organizationId: pkg.organizationId, role: role as OrganizationRole }
}

// ---------------------------------------------------------------------------------------------
// Identified records (D-055)
// ---------------------------------------------------------------------------------------------

/**
 * D-055 / FR-234: a platform `tassl_scenario_editor` may read identified institution records only
 * under an active `data_agreements` row that names their platform role and at least one purpose.
 * Returns a boolean rather than throwing: callers use it both to gate a read and to shape a
 * capabilities object for the UI.
 */
export async function canReadIdentifiedRecords(
  actor: SessionUser,
  orgId: string,
): Promise<boolean> {
  if (actor.platformRole !== 'tassl_scenario_editor') return false
  const agreement = await findActiveAgreement(orgId)
  if (!agreement) return false
  if (!agreement.permittedPlatformRoles.includes(actor.platformRole)) return false
  return agreement.purposes.length > 0
}

/** The throwing form of `canReadIdentifiedRecords`, for services that gate a read on it. */
export async function requireIdentifiedRecordsAccess(
  actor: SessionUser,
  orgId: string,
): Promise<void> {
  if (!(await canReadIdentifiedRecords(actor, orgId))) forbidden()
}
