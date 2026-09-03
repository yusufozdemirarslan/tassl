// Repository of the `courses` module (docs/tech/10-backend-spec-modules.md §3): courses, sections,
// section memberships, assignments, mapping changes, and the run lists instructors and students
// read (DATA-008 to DATA-011, DATA-055). Query bodies only; the service owns the rules.
import { and, desc, eq, exists, gt, inArray, isNull, max, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  assignments,
  courseExports,
  courseMappingChanges,
  courses,
  runScores,
  runs,
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
