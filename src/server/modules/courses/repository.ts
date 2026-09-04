// Repository of the `courses` module (docs/tech/10-backend-spec-modules.md §3): courses, sections,
// section memberships, assignments, mapping changes, and the run lists instructors and students
// read (DATA-008 to DATA-011, DATA-055). Query bodies only; the service owns the rules.
import { and, desc, eq, exists, gt, inArray, isNull, max, ne, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  afterCursor,
  clampLimit,
  cursorOrder,
  decodeCursor,
  toPage,
  type Page,
  type PageInput,
} from '@/server/db/pagination'
import {
  assignments,
  courseExports,
  courseMappingChanges,
  courses,
  member,
  runScores,
  runs,
  scenarioPackages,
  scenarioPackageVersions,
  scenarioVariants,
  sectionMemberships,
  sections,
  user,
  type Assignment,
  type Course,
  type CourseMappingChange,
  type NewAssignment,
  type NewCourse,
  type NewCourseMappingChange,
  type NewSection,
  type NewSectionMembership,
  type Run,
  type RunScore,
  type ScenarioPackageVersion,
  type ScenarioVariant,
  type Section,
  type SectionMembership,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

// The service may not import `@/server/db` (04 §2, D-173), so the row types it hands out, the page
// shape, and the transaction boundary it opens are re-exported by the layer that owns the database.
export type {
  Assignment,
  BandMapping,
  Course,
  Run,
  ScenarioPackageVersion,
  ScenarioVariant,
  Section,
  SectionMembership,
} from '@/server/db/schema'
export { DEFAULT_BAND_MAPPING } from '@/server/db/schema'
export type { Page, PageInput } from '@/server/db/pagination'
export type { DbOrTx, Tx } from '@/server/db/tx'
export { withTransaction } from '@/server/db/tx'

type WithoutTenant<T> = Omit<T, 'organizationId'>
type UserRow = typeof user.$inferSelect

/** The person behind a membership or a run, as rosters and run lists show them. */
export type UserSummary = Pick<UserRow, 'id' | 'name' | 'email'>

export type CoursePatch = Partial<
  Pick<
    NewCourse,
    | 'name'
    | 'term'
    | 'outsideAiPolicy'
    | 'mapping'
    | 'defaultRunWeight'
    | 'critiqueWeightFactor'
    | 'taughtConcepts'
    | 'policyOverrides'
  >
>

export type AssignmentPatch = Partial<
  Pick<
    NewAssignment,
    | 'label'
    | 'runType'
    | 'packageVersionId'
    | 'variantId'
    | 'workingClockSeconds'
    | 'weight'
    | 'isWalkthrough'
    | 'opensAt'
  >
>

export type MembershipInput = Pick<NewSectionMembership, 'sectionId' | 'userId' | 'role'>

/** A confirmed or recorded run of a course with the assignment it belongs to and its score row. */
export type ConfirmedRunRow = { run: Run; assignment: Assignment; score: RunScore | null }

export type SectionMemberRow = { membership: SectionMembership; user: UserSummary }

export type AssignmentContext = {
  assignment: Assignment
  section: Section
  course: Course
  packageVersion: ScenarioPackageVersion
  variant: ScenarioVariant
}

/** A run of an assignment as reviewers list it, with the newest course export version if any. */
export type AssignmentRunRow = {
  run: Run
  student: UserSummary
  latestExportVersion: number | null
}

/** An assignment in one of the student's sections with the student's latest run on it, if any. */
export type StudentAssignmentRow = {
  assignment: Assignment
  section: Section
  course: Course
  membership: SectionMembership
  latestRun: Run | null
}

function one<T>(rows: readonly T[]): T {
  const row = rows[0]
  if (row === undefined) throw new AppError('INTERNAL_ERROR', 'The statement returned no row.')
  return row
}

// ---------------------------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------------------------

export async function findCourse(
  tenantId: string,
  courseId: string,
  dbx: DbOrTx = db,
): Promise<Course | null> {
  const rows = await dbx
    .select()
    .from(courses)
    .where(
      and(
        eq(courses.id, courseId),
        eq(courses.organizationId, tenantId),
        isNull(courses.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function listCoursesForOrg(tenantId: string, dbx: DbOrTx = db): Promise<Course[]> {
  return dbx
    .select()
    .from(courses)
    .where(and(eq(courses.organizationId, tenantId), isNull(courses.deletedAt)))
    .orderBy(desc(courses.createdAt), desc(courses.id))
}

/** Courses in which the user holds a section membership of any role. */
export async function listCoursesForStudent(
  tenantId: string,
  userId: string,
  dbx: DbOrTx = db,
): Promise<Course[]> {
  const membershipInCourse = dbx
    .select({ one: sql`1` })
    .from(sectionMemberships)
    .innerJoin(sections, eq(sections.id, sectionMemberships.sectionId))
    .where(
      and(
        eq(sections.courseId, courses.id),
        isNull(sections.deletedAt),
        eq(sectionMemberships.userId, userId),
        eq(sectionMemberships.organizationId, tenantId),
      ),
    )
  return dbx
    .select()
    .from(courses)
    .where(
      and(
        eq(courses.organizationId, tenantId),
        isNull(courses.deletedAt),
        exists(membershipInCourse),
      ),
    )
    .orderBy(desc(courses.createdAt), desc(courses.id))
}

export async function insertCourse(
  tenantId: string,
  values: WithoutTenant<NewCourse>,
  dbx: DbOrTx = db,
): Promise<Course> {
  const rows = await dbx
    .insert(courses)
    .values({ ...values, organizationId: tenantId })
    .returning()
  return one(rows)
}

export async function updateCourse(
  tenantId: string,
  courseId: string,
  patch: CoursePatch,
  dbx: DbOrTx = db,
): Promise<Course | null> {
  const rows = await dbx
    .update(courses)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(
      and(
        eq(courses.id, courseId),
        eq(courses.organizationId, tenantId),
        isNull(courses.deletedAt),
      ),
    )
    .returning()
  return rows[0] ?? null
}

export async function insertMappingChange(
  tenantId: string,
  values: WithoutTenant<NewCourseMappingChange>,
  dbx: DbOrTx = db,
): Promise<CourseMappingChange> {
  const rows = await dbx
    .insert(courseMappingChanges)
    .values({ ...values, organizationId: tenantId })
    .returning()
  return one(rows)
}

/** Runs of the course in state `confirmed` or `recorded`, with their assignment and score row. */
export async function listConfirmedRunsForCourse(
  tenantId: string,
  courseId: string,
  dbx: DbOrTx = db,
): Promise<ConfirmedRunRow[]> {
  return dbx
    .select({ run: runs, assignment: assignments, score: runScores })
    .from(runs)
    .innerJoin(assignments, eq(assignments.id, runs.assignmentId))
    .innerJoin(sections, eq(sections.id, assignments.sectionId))
    .leftJoin(runScores, eq(runScores.runId, runs.id))
    .where(
      and(
        eq(runs.organizationId, tenantId),
        eq(sections.organizationId, tenantId),
        eq(sections.courseId, courseId),
        inArray(runs.state, ['confirmed', 'recorded']),
      ),
    )
    .orderBy(desc(runs.createdAt), desc(runs.id))
}

// ---------------------------------------------------------------------------------------------
// Sections and memberships
// ---------------------------------------------------------------------------------------------

export async function insertSection(
  tenantId: string,
  values: WithoutTenant<NewSection>,
  dbx: DbOrTx = db,
): Promise<Section> {
  const rows = await dbx
    .insert(sections)
    .values({ ...values, organizationId: tenantId })
    .returning()
  return one(rows)
}

/** Adds the member or changes the role of the existing (section, user) membership. */
export async function upsertSectionMembership(
  tenantId: string,
  values: MembershipInput,
  dbx: DbOrTx = db,
): Promise<SectionMembership | null> {
  const rows = await dbx
    .insert(sectionMemberships)
    .values({ ...values, organizationId: tenantId })
    .onConflictDoUpdate({
      target: [sectionMemberships.sectionId, sectionMemberships.userId],
      set: { role: values.role, updatedAt: sql`now()` },
      setWhere: eq(sectionMemberships.organizationId, tenantId),
    })
    .returning()
  return rows[0] ?? null
}

export async function deleteSectionMembership(
  tenantId: string,
  sectionId: string,
  userId: string,
  dbx: DbOrTx = db,
): Promise<SectionMembership | null> {
  const rows = await dbx
    .delete(sectionMemberships)
    .where(
      and(
        eq(sectionMemberships.sectionId, sectionId),
        eq(sectionMemberships.userId, userId),
        eq(sectionMemberships.organizationId, tenantId),
      ),
    )
    .returning()
  return rows[0] ?? null
}

export async function listSectionMembers(
  tenantId: string,
  sectionId: string,
  dbx: DbOrTx = db,
): Promise<SectionMemberRow[]> {
  return dbx
    .select({
      membership: sectionMemberships,
      user: { id: user.id, name: user.name, email: user.email },
    })
    .from(sectionMemberships)
    .innerJoin(user, eq(user.id, sectionMemberships.userId))
    .where(
      and(
        eq(sectionMemberships.sectionId, sectionId),
        eq(sectionMemberships.organizationId, tenantId),
      ),
    )
    .orderBy(desc(sectionMemberships.createdAt), desc(sectionMemberships.id))
}

// ---------------------------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------------------------

export async function insertAssignment(
  tenantId: string,
  values: WithoutTenant<NewAssignment>,
  dbx: DbOrTx = db,
): Promise<Assignment> {
  const rows = await dbx
    .insert(assignments)
    .values({ ...values, organizationId: tenantId })
    .returning()
  return one(rows)
}

export async function updateAssignment(
  tenantId: string,
  assignmentId: string,
  patch: AssignmentPatch,
  dbx: DbOrTx = db,
): Promise<Assignment | null> {
  const rows = await dbx
    .update(assignments)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, tenantId),
        isNull(assignments.deletedAt),
      ),
    )
    .returning()
  return rows[0] ?? null
}

/** The assignment with its section, course, package version, and variant. */
export async function findAssignmentWithContext(
  tenantId: string,
  assignmentId: string,
  dbx: DbOrTx = db,
): Promise<AssignmentContext | null> {
  const rows = await dbx
    .select({
      assignment: assignments,
      section: sections,
      course: courses,
      packageVersion: scenarioPackageVersions,
      variant: scenarioVariants,
    })
    .from(assignments)
    .innerJoin(sections, eq(sections.id, assignments.sectionId))
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .innerJoin(
      scenarioPackageVersions,
      eq(scenarioPackageVersions.id, assignments.packageVersionId),
    )
    .innerJoin(scenarioVariants, eq(scenarioVariants.id, assignments.variantId))
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, tenantId),
        eq(scenarioPackageVersions.organizationId, tenantId),
        isNull(assignments.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

/** Every run of the assignment with its student and the newest course export version. */
export async function listRunsForAssignment(
  tenantId: string,
  assignmentId: string,
  dbx: DbOrTx = db,
): Promise<AssignmentRunRow[]> {
  const latestExport = dbx
    .select({ runId: courseExports.runId, version: max(courseExports.version).as('version') })
    .from(courseExports)
    .where(eq(courseExports.organizationId, tenantId))
    .groupBy(courseExports.runId)
    .as('latest_export')
  return dbx
    .select({
      run: runs,
      student: { id: user.id, name: user.name, email: user.email },
      latestExportVersion: latestExport.version,
    })
    .from(runs)
    .innerJoin(user, eq(user.id, runs.studentId))
    .leftJoin(latestExport, eq(latestExport.runId, runs.id))
    .where(and(eq(runs.assignmentId, assignmentId), eq(runs.organizationId, tenantId)))
    .orderBy(desc(runs.createdAt), desc(runs.id))
}

/** Assignments in the user's sections, each with the user's highest-attempt run on it. */
export async function listAssignmentsForStudent(
  tenantId: string,
  userId: string,
  dbx: DbOrTx = db,
): Promise<StudentAssignmentRow[]> {
  const latestRun = alias(runs, 'latest_run')
  const laterRun = alias(runs, 'later_run')
  const noLaterAttempt = notExists(
    dbx
      .select({ one: sql`1` })
      .from(laterRun)
      .where(
        and(
          eq(laterRun.assignmentId, latestRun.assignmentId),
          eq(laterRun.studentId, latestRun.studentId),
          gt(laterRun.attemptNo, latestRun.attemptNo),
        ),
      ),
  )
  return dbx
    .select({
      assignment: assignments,
      section: sections,
      course: courses,
      membership: sectionMemberships,
      latestRun,
    })
    .from(sectionMemberships)
    .innerJoin(sections, eq(sections.id, sectionMemberships.sectionId))
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .innerJoin(assignments, eq(assignments.sectionId, sections.id))
    .leftJoin(
      latestRun,
      and(
        eq(latestRun.assignmentId, assignments.id),
        eq(latestRun.studentId, userId),
        eq(latestRun.organizationId, tenantId),
        noLaterAttempt,
      ),
    )
    .where(
      and(
        eq(sectionMemberships.userId, userId),
        eq(sectionMemberships.organizationId, tenantId),
        eq(assignments.organizationId, tenantId),
        isNull(assignments.deletedAt),
        isNull(sections.deletedAt),
        isNull(courses.deletedAt),
      ),
    )
    .orderBy(desc(assignments.createdAt), desc(assignments.id))
}

// ---------------------------------------------------------------------------------------------
// People (Step 4.1)
//
// `addSectionMember` takes an email and 10 §3 requires it to belong to an institution member, so
// the lookup is a join of Better Auth's `user` and `member` scoped to the tenant: an address that
// is not a member of *this* institution simply is not found, which is `NOT_SECTION_MEMBER`.
// ---------------------------------------------------------------------------------------------

/** The institution's member with this address, matched case-insensitively as sign-in does. */
export async function findOrgMemberByEmail(
  tenantId: string,
  email: string,
  dbx: DbOrTx = db,
): Promise<UserSummary | null> {
  const rows = await dbx
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, tenantId),
        sql`lower(${user.email}) = lower(${email})`,
        isNull(user.deleted_at),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

// ---------------------------------------------------------------------------------------------
// Paginated lists (10-backend-spec.md §11, D-020)
// ---------------------------------------------------------------------------------------------

/** How many live sections and live assignments hang off each of the given courses (UI-030). */
export type CourseCountsRow = { courseId: string; sectionCount: number; assignmentCount: number }

export async function countCourseChildren(
  tenantId: string,
  courseIds: readonly string[],
  dbx: DbOrTx = db,
): Promise<CourseCountsRow[]> {
  if (courseIds.length === 0) return []
  return dbx
    .select({
      courseId: sections.courseId,
      sectionCount: sql<number>`count(distinct ${sections.id})::int`,
      assignmentCount: sql<number>`count(${assignments.id})::int`,
    })
    .from(sections)
    .leftJoin(
      assignments,
      and(eq(assignments.sectionId, sections.id), isNull(assignments.deletedAt)),
    )
    .where(
      and(
        eq(sections.organizationId, tenantId),
        inArray(sections.courseId, [...courseIds]),
        isNull(sections.deletedAt),
      ),
    )
    .groupBy(sections.courseId)
}

export async function pageCoursesForOrg(
  tenantId: string,
  input: PageInput = {},
  dbx: DbOrTx = db,
): Promise<Page<Course>> {
  const limit = clampLimit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const rows = await dbx
    .select()
    .from(courses)
    .where(
      and(
        eq(courses.organizationId, tenantId),
        isNull(courses.deletedAt),
        afterCursor({ createdAt: courses.createdAt, id: courses.id }, cursor),
      ),
    )
    .orderBy(...cursorOrder({ createdAt: courses.createdAt, id: courses.id }))
    .limit(limit + 1)
  return toPage(rows, limit)
}

/** The same page, narrowed to the courses the user holds a section membership in (10 §3). */
export async function pageCoursesForStudent(
  tenantId: string,
  userId: string,
  input: PageInput = {},
  dbx: DbOrTx = db,
): Promise<Page<Course>> {
  const limit = clampLimit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const membershipInCourse = dbx
    .select({ one: sql`1` })
    .from(sectionMemberships)
    .innerJoin(sections, eq(sections.id, sectionMemberships.sectionId))
    .where(
      and(
        eq(sections.courseId, courses.id),
        isNull(sections.deletedAt),
        eq(sectionMemberships.userId, userId),
        eq(sectionMemberships.organizationId, tenantId),
      ),
    )
  const rows = await dbx
    .select()
    .from(courses)
    .where(
      and(
        eq(courses.organizationId, tenantId),
        isNull(courses.deletedAt),
        exists(membershipInCourse),
        afterCursor({ createdAt: courses.createdAt, id: courses.id }, cursor),
      ),
    )
    .orderBy(...cursorOrder({ createdAt: courses.createdAt, id: courses.id }))
    .limit(limit + 1)
  return toPage(rows, limit)
}

/** A roster row keyed for the cursor (10 §11); the membership carries the ordering columns. */
export type SectionMemberPageRow = {
  id: string
  createdAt: Date
  role: SectionMembership['role']
  user: UserSummary
}

export async function pageSectionMembers(
  tenantId: string,
  sectionId: string,
  input: PageInput = {},
  dbx: DbOrTx = db,
): Promise<Page<SectionMemberPageRow>> {
  const limit = clampLimit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const rows = await dbx
    .select({
      id: sectionMemberships.id,
      createdAt: sectionMemberships.createdAt,
      role: sectionMemberships.role,
      user: { id: user.id, name: user.name, email: user.email },
    })
    .from(sectionMemberships)
    .innerJoin(user, eq(user.id, sectionMemberships.userId))
    .where(
      and(
        eq(sectionMemberships.sectionId, sectionId),
        eq(sectionMemberships.organizationId, tenantId),
        afterCursor({ createdAt: sectionMemberships.createdAt, id: sectionMemberships.id }, cursor),
      ),
    )
    .orderBy(...cursorOrder({ createdAt: sectionMemberships.createdAt, id: sectionMemberships.id }))
    .limit(limit + 1)
  return toPage(rows, limit)
}

/** `listAssignmentsForStudent` as a page, keyed on the assignment's own (created_at, id). */
export type StudentAssignmentPageRow = {
  id: string
  createdAt: Date
  assignment: Assignment
  section: Section
  course: Course
  latestRun: Run | null
}

export async function pageAssignmentsForStudent(
  tenantId: string,
  userId: string,
  input: PageInput = {},
  dbx: DbOrTx = db,
): Promise<Page<StudentAssignmentPageRow>> {
  const limit = clampLimit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const latestRun = alias(runs, 'latest_run')
  const laterRun = alias(runs, 'later_run')
  const noLaterAttempt = notExists(
    dbx
      .select({ one: sql`1` })
      .from(laterRun)
      .where(
        and(
          eq(laterRun.assignmentId, latestRun.assignmentId),
          eq(laterRun.studentId, latestRun.studentId),
          gt(laterRun.attemptNo, latestRun.attemptNo),
        ),
      ),
  )
  const rows = await dbx
    .select({
      id: assignments.id,
      createdAt: assignments.createdAt,
      assignment: assignments,
      section: sections,
      course: courses,
      latestRun,
    })
    .from(sectionMemberships)
    .innerJoin(sections, eq(sections.id, sectionMemberships.sectionId))
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .innerJoin(assignments, eq(assignments.sectionId, sections.id))
    .leftJoin(
      latestRun,
      and(
        eq(latestRun.assignmentId, assignments.id),
        eq(latestRun.studentId, userId),
        eq(latestRun.organizationId, tenantId),
        noLaterAttempt,
      ),
    )
    .where(
      and(
        eq(sectionMemberships.userId, userId),
        eq(sectionMemberships.organizationId, tenantId),
        eq(assignments.organizationId, tenantId),
        isNull(assignments.deletedAt),
        isNull(sections.deletedAt),
        isNull(courses.deletedAt),
        afterCursor({ createdAt: assignments.createdAt, id: assignments.id }, cursor),
      ),
    )
    .orderBy(...cursorOrder({ createdAt: assignments.createdAt, id: assignments.id }))
    .limit(limit + 1)
  return toPage(rows, limit)
}

// ---------------------------------------------------------------------------------------------
// Course detail (getCourse)
// ---------------------------------------------------------------------------------------------

export type SectionWithCountsRow = {
  section: Section
  memberCount: number
  assignmentCount: number
}

/** The course's live sections with the two counts the detail screen shows (10 §3 `getCourse`). */
export async function listSectionsForCourse(
  tenantId: string,
  courseId: string,
  dbx: DbOrTx = db,
): Promise<SectionWithCountsRow[]> {
  const memberCounts = dbx
    .select({
      sectionId: sectionMemberships.sectionId,
      total: sql<number>`count(*)::int`.as('member_total'),
    })
    .from(sectionMemberships)
    .where(eq(sectionMemberships.organizationId, tenantId))
    .groupBy(sectionMemberships.sectionId)
    .as('member_counts')
  const assignmentCounts = dbx
    .select({
      sectionId: assignments.sectionId,
      total: sql<number>`count(*)::int`.as('assignment_total'),
    })
    .from(assignments)
    .where(and(eq(assignments.organizationId, tenantId), isNull(assignments.deletedAt)))
    .groupBy(assignments.sectionId)
    .as('assignment_counts')
  return dbx
    .select({
      section: sections,
      memberCount: sql<number>`coalesce(${memberCounts.total}, 0)::int`,
      assignmentCount: sql<number>`coalesce(${assignmentCounts.total}, 0)::int`,
    })
    .from(sections)
    .leftJoin(memberCounts, eq(memberCounts.sectionId, sections.id))
    .leftJoin(assignmentCounts, eq(assignmentCounts.sectionId, sections.id))
    .where(
      and(
        eq(sections.courseId, courseId),
        eq(sections.organizationId, tenantId),
        isNull(sections.deletedAt),
      ),
    )
    .orderBy(sections.name, sections.id)
}

/** Every live assignment of the course, across its sections (10 §3 `getCourse`). */
export async function listAssignmentsForCourse(
  tenantId: string,
  courseId: string,
  dbx: DbOrTx = db,
): Promise<Assignment[]> {
  const rows = await dbx
    .select({ assignment: assignments })
    .from(assignments)
    .innerJoin(sections, eq(sections.id, assignments.sectionId))
    .where(
      and(
        eq(assignments.organizationId, tenantId),
        eq(sections.courseId, courseId),
        isNull(assignments.deletedAt),
        isNull(sections.deletedAt),
      ),
    )
    .orderBy(desc(assignments.createdAt), desc(assignments.id))
  return rows.map((row) => row.assignment)
}

// ---------------------------------------------------------------------------------------------
// Sections, packages, and the run counts the rules read
// ---------------------------------------------------------------------------------------------

export type SectionWithCourse = { section: Section; course: Course }

/** The section with the course it belongs to: the guard needs the course to know who teaches it. */
export async function findSectionWithCourse(
  tenantId: string,
  sectionId: string,
  dbx: DbOrTx = db,
): Promise<SectionWithCourse | null> {
  const rows = await dbx
    .select({ section: sections, course: courses })
    .from(sections)
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .where(
      and(
        eq(sections.id, sectionId),
        eq(sections.organizationId, tenantId),
        isNull(sections.deletedAt),
        isNull(courses.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export type PackageVersionRow = { version: ScenarioPackageVersion; packageTitle: string }

/** The package version an assignment points at, with the family title the form shows. */
export async function findPackageVersion(
  tenantId: string,
  versionId: string,
  dbx: DbOrTx = db,
): Promise<PackageVersionRow | null> {
  const rows = await dbx
    .select({ version: scenarioPackageVersions, packageTitle: scenarioPackages.title })
    .from(scenarioPackageVersions)
    .innerJoin(scenarioPackages, eq(scenarioPackages.id, scenarioPackageVersions.packageId))
    .where(
      and(
        eq(scenarioPackageVersions.id, versionId),
        eq(scenarioPackageVersions.organizationId, tenantId),
        isNull(scenarioPackages.deletedAt),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

/** The variant, only when it belongs to the version — which is what `VARIANT_MISMATCH` asserts. */
export async function findVariantOfVersion(
  versionId: string,
  variantId: string,
  dbx: DbOrTx = db,
): Promise<ScenarioVariant | null> {
  const rows = await dbx
    .select()
    .from(scenarioVariants)
    .where(
      and(eq(scenarioVariants.id, variantId), eq(scenarioVariants.packageVersionId, versionId)),
    )
    .limit(1)
  return rows[0] ?? null
}

/** Runs on the assignment that are not voided (`ASSIGNMENT_IN_USE`). */
export async function countActiveRunsForAssignment(
  tenantId: string,
  assignmentId: string,
  dbx: DbOrTx = db,
): Promise<number> {
  const rows = await dbx
    .select({ total: sql<number>`count(*)::int` })
    .from(runs)
    .where(
      and(
        eq(runs.organizationId, tenantId),
        eq(runs.assignmentId, assignmentId),
        ne(runs.state, 'voided'),
      ),
    )
  return rows[0]?.total ?? 0
}

/** Runs the person has in the section that are not voided (`MEMBER_HAS_RUNS`). */
export async function countActiveRunsForSectionMember(
  tenantId: string,
  sectionId: string,
  userId: string,
  dbx: DbOrTx = db,
): Promise<number> {
  const rows = await dbx
    .select({ total: sql<number>`count(*)::int` })
    .from(runs)
    .innerJoin(assignments, eq(assignments.id, runs.assignmentId))
    .where(
      and(
        eq(runs.organizationId, tenantId),
        eq(runs.studentId, userId),
        eq(assignments.sectionId, sectionId),
        ne(runs.state, 'voided'),
      ),
    )
  return rows[0]?.total ?? 0
}

/** Runs of the course already confirmed or recorded; a mapping is fixed once one exists (D-095). */
export async function countConfirmedRunsForCourse(
  tenantId: string,
  courseId: string,
  dbx: DbOrTx = db,
): Promise<number> {
  const rows = await dbx
    .select({ total: sql<number>`count(*)::int` })
    .from(runs)
    .innerJoin(assignments, eq(assignments.id, runs.assignmentId))
    .innerJoin(sections, eq(sections.id, assignments.sectionId))
    .where(
      and(
        eq(runs.organizationId, tenantId),
        eq(sections.courseId, courseId),
        inArray(runs.state, ['confirmed', 'recorded']),
      ),
    )
  return rows[0]?.total ?? 0
}

// ---------------------------------------------------------------------------------------------
// The walkthrough run deletion (D-104)
// ---------------------------------------------------------------------------------------------

export type RunWithAssignment = { run: Run; assignment: Assignment; section: Section }

export async function findRunWithAssignment(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<RunWithAssignment | null> {
  const rows = await dbx
    .select({ run: runs, assignment: assignments, section: sections })
    .from(runs)
    .innerJoin(assignments, eq(assignments.id, runs.assignmentId))
    .innerJoin(sections, eq(sections.id, assignments.sectionId))
    .where(and(eq(runs.id, runId), eq(runs.organizationId, tenantId)))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Hard-deletes the run row. 10 §3 deletes "the run and children (FK cascade)": the children go with
 * it through the foreign keys, never through a statement here — `run_events`, `run_frames`,
 * `run_turn_responses` and `run_addenda` have DELETE revoked from the application role (migration
 * 0009), so an explicit child delete would fail under least privilege in production.
 */
export async function deleteRun(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<boolean> {
  const rows = await dbx
    .delete(runs)
    .where(and(eq(runs.id, runId), eq(runs.organizationId, tenantId)))
    .returning({ id: runs.id })
  return rows.length > 0
}

/**
 * The role the user holds in any section of the course, or null. `getCourse` admits a member of one
 * of the course's sections alongside the institution's instructors and program leads (07 §5).
 */
export async function findCourseMembership(
  tenantId: string,
  courseId: string,
  userId: string,
  dbx: DbOrTx = db,
): Promise<SectionMembership['role'] | null> {
  const rows = await dbx
    .select({ role: sectionMemberships.role })
    .from(sectionMemberships)
    .innerJoin(sections, eq(sections.id, sectionMemberships.sectionId))
    .where(
      and(
        eq(sectionMemberships.userId, userId),
        eq(sectionMemberships.organizationId, tenantId),
        eq(sections.courseId, courseId),
        isNull(sections.deletedAt),
      ),
    )
    .limit(1)
  return rows[0]?.role ?? null
}

// ---------------------------------------------------------------------------------------------
// The actor's own account
//
// The one read here that names no tenant, and the reason it sits last: `ms_since_first_sign_in`
// (17 §3.1) is measured from the account row, and an account belongs to a person, not to an
// institution. Every other function in this file is `tenantId` first (D-006).
// ---------------------------------------------------------------------------------------------

/**
 * When the actor's account row was created — the instant 17 §3.1 calls "first sign in", because the
 * row is written at sign-up or at the first Google sign-in. Keyed by the actor, so no tenant.
 */
export async function findUserCreatedAt(userId: string, dbx: DbOrTx = db): Promise<Date | null> {
  const rows = await dbx
    .select({ createdAt: user.createdAt })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return rows[0]?.createdAt ?? null
}
