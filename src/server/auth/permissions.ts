// Permission helpers (docs/tech/08-auth-authz.md §5). The matrix in 08 §4 is the source of truth;
// these functions are the only place it is enforced. Routes and Server Actions call them, and every
// service that touches a run, package, course, or agreement calls the matching helper as its first
// statement, so a missed check in a handler cannot widen access.
//
// One role per account (D-748). `user.platform_role` is Student, Scenario Editor, Instructor or
// Platform Admin, and it is the only thing a guard asks about the person. The two memberships are
// facts about *where*, not *what*: a `member` row says which institution a person belongs to — the
// tenant every read is scoped to — and a `section_memberships` row says which section roster they
// are on, which for a Student is an enrolment and for an Instructor is a section they teach.
//
//   Student          — takes the runs assigned on the sections they are enrolled in; reads their own
//   Scenario Editor  — a Student's access, plus authoring and publishing scenario packages
//   Instructor       — courses, sections, rosters, invitations, assignments, and review of learner
//                      results on the courses they run; reads packages to assign them
//   Platform Admin   — full access: every guard below admits the admin, in every institution
//
// Shape rules, applied without exception:
//   - the actor comes first, so a helper can never be called without one;
//   - a helper throws `AppError('FORBIDDEN')` (or `'UNAUTHENTICATED'`) and otherwise returns the
//     scope it proved, so the caller does not repeat the lookup;
//   - a resource in another organization answers `NOT_FOUND`, never `FORBIDDEN`, so an id cannot be
//     probed for existence (08 §4 "Cross-tenant").
import { AppError, isAppError } from '@/lib/errors'
import {
  findCourse,
  findPackage,
  findRunContext,
  findSection,
  findSectionMembership,
  isMember,
  onCourseRoster,
  organizationExists,
} from '@/server/auth/queries'
import type { PlatformRole, SessionUser } from '@/server/auth/types'

export { getSession, requireSession } from '@/server/auth/session'
export type { PlatformRole, SessionUser } from '@/server/auth/types'

/** What `requireSectionSeat` proved: the section, its organization, and the actor's role. */
export type SectionScope = { sectionId: string; role: PlatformRole; organizationId: string }

/** What the run guards proved. */
export type RunScope = {
  runId: string
  organizationId: string
  studentId: string
  sectionId: string
  /** The course the run's section belongs to; what `canReviewSection` is asked about (D-483). */
  courseId: string
}

/** The roles that take runs: a Student, and a Scenario Editor, who has a Student's access. */
export const LEARNER_ROLES: readonly PlatformRole[] = ['student', 'tassl_scenario_editor']

/** The role that runs courses and reviews learner results. */
export const TEACHING_ROLES: readonly PlatformRole[] = ['instructor']

/** The role that authors and publishes scenario packages. */
export const AUTHORING_ROLES: readonly PlatformRole[] = ['tassl_scenario_editor']

/** The roles that read a package: its authors, and the instructors who assign it. */
export const PACKAGE_READER_ROLES: readonly PlatformRole[] = ['tassl_scenario_editor', 'instructor']

// Function declarations, not arrows: TypeScript only narrows after a `never`-returning call when the
// callee is a function declaration (or an explicitly annotated const) — the narrowing is what lets
// every guard below read `if (!row) notFound()` and then use `row`.
function forbidden(): never {
  throw new AppError('FORBIDDEN')
}

function notFound(): never {
  throw new AppError('NOT_FOUND')
}

/** The Platform Admin, whom every guard admits (D-748). */
export function isPlatformAdmin(actor: SessionUser): boolean {
  return actor.platformRole === 'admin'
}

/** True when the actor's role is one of `roles`, or the actor is the Platform Admin. */
export function hasRole(actor: SessionUser, roles: readonly PlatformRole[]): boolean {
  return isPlatformAdmin(actor) || roles.includes(actor.platformRole)
}

// ---------------------------------------------------------------------------------------------
// Platform and organization
// ---------------------------------------------------------------------------------------------

/** `user.platform_role` is `role`; the admin satisfies every platform-role check (08 §5). */
export function requirePlatformRole(actor: SessionUser, role: PlatformRole): PlatformRole {
  if (!hasRole(actor, [role])) forbidden()
  return actor.platformRole
}

/** The actor's role is one of `roles` (or they are the admin); FORBIDDEN otherwise. */
export function requireAnyRole(actor: SessionUser, roles: readonly PlatformRole[]): PlatformRole {
  if (!hasRole(actor, roles)) forbidden()
  return actor.platformRole
}

/**
 * The actor belongs to the organization — a `member` row — and, when `roles` is given, holds one of
 * them (08 §5). The admin belongs everywhere: an organization that exists is enough, and one that
 * does not is NOT_FOUND. A person outside the organization is FORBIDDEN here; the callers that must
 * not confirm an id's existence turn that into NOT_FOUND themselves.
 */
export async function requireMembership(
  actor: SessionUser,
  orgId: string,
  roles?: readonly PlatformRole[],
): Promise<PlatformRole> {
  if (isPlatformAdmin(actor)) {
    if (!(await organizationExists(orgId))) notFound()
    return actor.platformRole
  }
  if (!(await isMember(actor.id, orgId))) forbidden()
  if (roles && !roles.includes(actor.platformRole)) forbidden()
  return actor.platformRole
}

// ---------------------------------------------------------------------------------------------
// Sections and courses
// ---------------------------------------------------------------------------------------------

/**
 * The actor is on the roster of a live section and holds one of `roles` (08 §5). The organization is
 * read from the section itself, so the scope handed back is the section's tenant, never the actor's
 * active organization. The admin needs no roster row.
 */
export async function requireSectionSeat(
  actor: SessionUser,
  sectionId: string,
  roles: readonly PlatformRole[],
): Promise<SectionScope> {
  if (isPlatformAdmin(actor)) {
    const section = await findSection(sectionId)
    if (!section) notFound()
    return { sectionId, role: actor.platformRole, organizationId: section.organizationId }
  }
  const membership = await findSectionMembership(actor.id, sectionId)
  if (!membership) {
    // A section in an institution the actor does not belong to, or no section at all, answers
    // NOT_FOUND (08 §5 "Cross-tenant"): a section id must not be confirmable from another tenant.
    // A member of the institution who is not on the roster is FORBIDDEN (D-710).
    const section = await findSection(sectionId)
    if (!section) notFound()
    if (!(await isMember(actor.id, section.organizationId))) notFound()
    forbidden()
  }
  if (!roles.includes(actor.platformRole)) forbidden()
  return { sectionId, role: actor.platformRole, organizationId: membership.organizationId }
}

/**
 * The instructor of a course: an Instructor who created it or is on the roster of one of its
 * sections (08 §5). A course the actor's organization does not contain answers NOT_FOUND rather than
 * FORBIDDEN; the admin runs every course.
 *
 * **Creating a course is not a permission that outlives the role that had it** (D-516, D-748).
 * `courses.created_by` is a record of who made the row, not a grant: a creator whose role an admin
 * later changes to Student no longer runs the course, because the role is asked first.
 */
export async function requireCourseInstructor(
  actor: SessionUser,
  courseId: string,
): Promise<{ courseId: string; organizationId: string }> {
  const course = await findCourse(courseId)
  if (!course) notFound()
  if (isPlatformAdmin(actor)) return { courseId, organizationId: course.organizationId }
  if (!(await isMember(actor.id, course.organizationId))) notFound()
  if (actor.platformRole !== 'instructor') forbidden()
  const runsIt = course.createdBy === actor.id || (await onCourseRoster(actor.id, courseId))
  if (!runsIt) forbidden()
  return { courseId, organizationId: course.organizationId }
}

/**
 * A reviewer of a section: an Instructor on its roster, **or** the instructor of its course (08 §4
 * "Reviewer", read with D-062 and §5's `requireCourseInstructor`), or the admin.
 *
 * The second half is not a widening: between creating a section and putting anyone on it, the
 * course's creator is the only instructor who exists (D-483).
 *
 * Returns a boolean rather than throwing, because both callers need it twice over: once to gate the
 * read and once to decide whether a screen offers the link that leads to it.
 */
export async function canReviewSection(
  actor: SessionUser,
  courseId: string,
  sectionId: string,
): Promise<boolean> {
  if (isPlatformAdmin(actor)) return true
  if (actor.platformRole !== 'instructor') return false
  if (await findSectionMembership(actor.id, sectionId)) return true
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
// ---------------------------------------------------------------------------------------------

async function requireRun(runId: string): Promise<RunScope> {
  const run = await findRunContext(runId)
  if (!run) notFound()
  return run
}

/**
 * `runs.student_id === actor.id`, or the admin. Another person's run is NOT_FOUND, not FORBIDDEN
 * (08 §4).
 */
export async function requireRunOwner(actor: SessionUser, runId: string): Promise<RunScope> {
  const run = await requireRun(runId)
  if (isPlatformAdmin(actor)) return run
  if (run.studentId !== actor.id) notFound()
  return run
}

/**
 * A reviewer of the run's section (`canReviewSection`), or the admin (08 §5).
 *
 * Refusals keep their meaning: the run's own learner is FORBIDDEN — they know the run exists, and
 * the answer says whose screen this is — and everyone else who is not a reviewer of it, a classmate
 * or an instructor of another course alike, is NOT_FOUND, so a run id cannot be probed.
 */
export async function requireRunReviewer(actor: SessionUser, runId: string): Promise<RunScope> {
  const run = await requireRun(runId)
  if (await canReviewSection(actor, run.courseId, run.sectionId)) return run
  if (run.studentId === actor.id) forbidden()
  notFound()
}

/** The reader of a filed **course export** (08 §4, D-483): the same predicate as the reviewer. */
export async function requireCourseExportReader(
  actor: SessionUser,
  runId: string,
): Promise<RunScope> {
  return requireRunReviewer(actor, runId)
}

/**
 * The instructor acts on a run — void, re-offer, neutralize (08 §5). With one Instructor role there
 * is no reviewer who may read a run and not act on it, so this is the reviewer's predicate.
 */
export async function requireRunInstructor(actor: SessionUser, runId: string): Promise<RunScope> {
  return requireRunReviewer(actor, runId)
}

// ---------------------------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------------------------

async function requirePackageRole(
  actor: SessionUser,
  packageId: string,
  roles: readonly PlatformRole[],
): Promise<{ packageId: string; organizationId: string; role: PlatformRole }> {
  const pkg = await findPackage(packageId)
  if (!pkg) notFound()
  if (isPlatformAdmin(actor)) {
    return { packageId, organizationId: pkg.organizationId, role: actor.platformRole }
  }
  if (!(await isMember(actor.id, pkg.organizationId))) notFound()
  if (!roles.includes(actor.platformRole)) forbidden()
  return { packageId, organizationId: pkg.organizationId, role: actor.platformRole }
}

/**
 * A Scenario Editor of the package's institution, or the admin: create, edit, generate, confirm
 * (publish), retire (08 §4, D-748).
 */
export async function requireAuthorOnPackage(
  actor: SessionUser,
  packageId: string,
): Promise<{ packageId: string; organizationId: string; role: PlatformRole }> {
  return requirePackageRole(actor, packageId, AUTHORING_ROLES)
}

/**
 * A reader of the package: its institution's Scenario Editors, and its Instructors, who choose a
 * confirmed version for an assignment and read it back in review (08 §4, D-748).
 */
export async function requirePackageReader(
  actor: SessionUser,
  packageId: string,
): Promise<{ packageId: string; organizationId: string; role: PlatformRole }> {
  return requirePackageRole(actor, packageId, PACKAGE_READER_ROLES)
}
