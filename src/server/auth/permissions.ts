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
import { AppError } from '@/lib/errors'
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
 */
export async function requireCourseInstructor(
  actor: SessionUser,
  courseId: string,
): Promise<{ courseId: string; organizationId: string }> {
  const course = await findCourse(courseId)
  if (!course) notFound()
  const orgRole = await findOrganizationRole(actor.id, course.organizationId)
  if (orgRole === null) notFound()
  const isInstructor = course.createdBy === actor.id || (await teachesCourse(actor.id, courseId))
  if (!isInstructor) forbidden()
  return { courseId, organizationId: course.organizationId }
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
  if (!REVIEWER_ROLES.includes(membership.role as SectionRole)) forbidden()
  return run
}

/** Section role `instructor` on the run's section (08 §5); a TA is FORBIDDEN, not NOT_FOUND. */
export async function requireRunInstructor(actor: SessionUser, runId: string): Promise<RunScope> {
  const run = await requireRun(runId)
  const membership = await findSectionMembership(actor.id, run.sectionId)
  if (!membership) notFound()
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
