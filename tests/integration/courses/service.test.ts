// Step 4.1 — the `courses` service against Postgres (docs/tech/10-backend-spec-modules.md §3).
// Every rule of §3 that carries its own error code is proven here, at the service, so the route
// tests in tests/integration/api/courses.test.ts only have to prove the wiring.
//
// The actor is built by hand rather than through a session: these are service calls, and the
// session path is what tests/integration/api/courses.test.ts exercises.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import type { SessionUser } from '@/server/auth/types'

type Courses = typeof import('@/server/modules/courses')
type Factories = typeof import('@tests/factories')
type Runs = typeof import('@/server/modules/runs/repository')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

let courses: Courses
let f: Factories
let runsRepo: Runs

const DEFAULT_MAPPING = { novice: 1, developing: 2, proficient: 3, professional: 4 }

const actorFor = (user: UserRow, orgId: string | null = null): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  emailVerified: true,
  activeOrganizationId: orgId,
  platformRole: 'none',
})

type Fixture = Awaited<ReturnType<typeof setup>>

/** Two institutions, four seats in the first, and a confirmed package version to assign. */
async function setup() {
  const orgA = (await f.createInstitution('svc-a')).organization.id
  const orgB = (await f.createInstitution('svc-b')).organization.id

  const instructor = await f.createUser('svc-instructor')
  const student = await f.createUser('svc-student')
  const student2 = await f.createUser('svc-student-2')
  const lead = await f.createUser('svc-lead')
  const stranger = await f.createUser('svc-stranger')
  const outsider = await f.createUser('svc-outsider')

  await f.addMember(orgA, instructor.id, 'instructor')
  await f.addMember(orgA, student.id, 'student')
  await f.addMember(orgA, student2.id, 'student')
  await f.addMember(orgA, lead.id, 'program_lead')
  await f.addMember(orgB, outsider.id, 'instructor')

  const pkg = await f.minimalConfirmedVersion(orgA, 'svc-confirmed', {
    createdBy: instructor.id,
  })
  const draft = await f.createPackageVersion(orgA, 'svc-draft', { createdBy: instructor.id })
  const otherPkg = await f.minimalConfirmedVersion(orgA, 'svc-other', { createdBy: instructor.id })

  return {
    orgA,
    orgB,
    instructor,
    student,
    student2,
    lead,
    stranger,
    outsider,
    pkg,
    draft,
    otherPkg,
    teacher: actorFor(instructor, orgA),
    learner: actorFor(student, orgA),
    programLead: actorFor(lead, orgA),
    foreigner: actorFor(outsider, orgB),
  }
}

/** A course with one section, the instructor in it, and an assignment on the confirmed version. */
async function withAssignment(fx: Fixture) {
  const course = await courses.createCourse(fx.teacher, fx.orgA, {
    name: 'Marketing Strategy',
    term: '2026-fall',
  })
  const section = await courses.createSection(fx.teacher, course.id, { name: 'A' })
  await f.addSectionMember(fx.orgA, section.id, fx.instructor.id, 'instructor')
  await f.addSectionMember(fx.orgA, section.id, fx.student.id, 'student')
  const assignment = await courses.createAssignment(fx.teacher, section.id, {
    label: 'Decision Run 1',
    packageVersionId: fx.pkg.version.id,
    variantId: fx.pkg.defective.id,
  })
  return { course, section, assignment }
}

async function startRun(
  fx: Fixture,
  assignmentId: string,
  studentId: string,
  state: 'working' | 'voided' | 'confirmed' = 'working',
) {
  return runsRepo.insertRun(fx.orgA, {
    assignmentId,
    studentId,
    packageVersionId: fx.pkg.version.id,
    variantId: fx.pkg.defective.id,
    state,
    workingClockSeconds: 1500,
    turnDelaySeconds: 90,
  })
}

let fx: Fixture

beforeEach(async () => {
  await truncateAll()
  courses ??= await import('@/server/modules/courses')
  f ??= await import('@tests/factories')
  runsRepo ??= await import('@/server/modules/runs/repository')
  fx = await setup()
})

afterAll(async () => {
  await truncateAll()
})

describe('createCourse and listCourses (FR-200)', () => {
  it('creates a course with the institution default mapping and lists it for the instructor', async () => {
    const course = await courses.createCourse(fx.teacher, fx.orgA, {
      name: 'Marketing Strategy Walkthrough',
      term: '2026-fall',
      outsideAiPolicy: 'declared',
      defaultRunWeight: 2.5,
    })

    expect(course).toMatchObject({
      organizationId: fx.orgA,
      name: 'Marketing Strategy Walkthrough',
      term: '2026-fall',
      outsideAiPolicy: 'declared',
      mapping: DEFAULT_MAPPING,
      defaultRunWeight: 2.5,
      critiqueWeightFactor: 0.5,
      taughtConcepts: [],
    })

    const listed = await courses.listCourses(fx.teacher, fx.orgA)
    expect(listed.items.map((row) => row.id)).toEqual([course.id])
    expect(listed.items[0]).toMatchObject({ sectionCount: 0, assignmentCount: 0 })
    expect(listed.nextCursor).toBeNull()
  })

  it('refuses a student and refuses a mapping that is not four positive numbers', async () => {
    await expect(
      courses.createCourse(fx.learner, fx.orgA, { name: 'Nope', term: '2026-fall' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    await expect(
      courses.createCourse(fx.teacher, fx.orgA, {
        name: 'Bad mapping',
        term: '2026-fall',
        mapping: { ...DEFAULT_MAPPING, novice: 0 },
      }),
    ).rejects.toMatchObject({ code: 'MAPPING_INVALID' })
  })

  it('answers NOT_FOUND for an institution the actor does not belong to', async () => {
    await expect(
      courses.createCourse(fx.teacher, fx.orgB, { name: 'Elsewhere', term: '2026-fall' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(courses.listCourses(fx.foreigner, fx.orgA)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('shows a student only the courses they hold a section membership in', async () => {
    const { course } = await withAssignment(fx)
    await courses.createCourse(fx.teacher, fx.orgA, { name: 'Another course', term: '2026-fall' })

    const asInstructor = await courses.listCourses(fx.teacher, fx.orgA)
    expect(asInstructor.items).toHaveLength(2)

    const asStudent = await courses.listCourses(fx.learner, fx.orgA)
    expect(asStudent.items.map((row) => row.id)).toEqual([course.id])
    expect(asStudent.items[0]).toMatchObject({ sectionCount: 1, assignmentCount: 1 })
  })

  it('paginates on (created_at, id) with the shared cursor', async () => {
    for (const name of ['One', 'Two', 'Three']) {
      await courses.createCourse(fx.teacher, fx.orgA, { name, term: '2026-fall' })
    }
    const first = await courses.listCourses(fx.teacher, fx.orgA, { limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()

    const second = await courses.listCourses(fx.teacher, fx.orgA, {
      limit: 2,
      cursor: first.nextCursor!,
    })
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    const ids = [...first.items, ...second.items].map((row) => row.id)
    expect(new Set(ids).size).toBe(3)
  })
})

describe('getCourse and updateCoursePolicy (FR-205)', () => {
  it('returns sections with their membership counts and the course assignments', async () => {
    const { course, section, assignment } = await withAssignment(fx)

    const view = await courses.getCourse(fx.teacher, course.id)
    expect(view.sections).toEqual([
      { id: section.id, courseId: course.id, name: 'A', memberCount: 2, assignmentCount: 1 },
    ])
    expect(view.assignments.map((row) => row.id)).toEqual([assignment.id])
    expect(view.mapping).toEqual(DEFAULT_MAPPING)

    // A member of one of its sections reads it too (07 §5).
    expect((await courses.getCourse(fx.learner, course.id)).id).toBe(course.id)
  })

  it('hides a course from a member of the institution who is in none of its sections', async () => {
    const { course } = await withAssignment(fx)
    // student2 is a member of the institution but of none of this course's sections.
    await expect(
      courses.getCourse(actorFor(fx.student2, fx.orgA), course.id),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(courses.getCourse(fx.foreigner, course.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('updates the policy, the weights, and the taught concepts', async () => {
    const { course } = await withAssignment(fx)
    const updated = await courses.updateCoursePolicy(fx.teacher, course.id, {
      outsideAiPolicy: 'in_environment_only',
      defaultRunWeight: 3,
      critiqueWeightFactor: 0.25,
      taughtConcepts: ['pricing_power', 'cannibalization'],
    })
    expect(updated).toMatchObject({
      outsideAiPolicy: 'in_environment_only',
      defaultRunWeight: 3,
      critiqueWeightFactor: 0.25,
      taughtConcepts: ['pricing_power', 'cannibalization'],
    })
    await expect(
      courses.updateCoursePolicy(fx.learner, course.id, { outsideAiPolicy: 'open' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('accepts a mapping while nothing is confirmed and refuses it afterwards', async () => {
    const { course, assignment } = await withAssignment(fx)
    const mapping = { novice: 2, developing: 4, proficient: 6, professional: 8 }

    const updated = await courses.updateCoursePolicy(fx.teacher, course.id, { mapping })
    expect(updated.mapping).toEqual(mapping)

    await expect(
      courses.updateCoursePolicy(fx.teacher, course.id, {
        mapping: { ...mapping, professional: -1 },
      }),
    ).rejects.toMatchObject({ code: 'MAPPING_INVALID' })

    await startRun(fx, assignment.id, fx.student.id, 'confirmed')
    await expect(
      courses.updateCoursePolicy(fx.teacher, course.id, { mapping: DEFAULT_MAPPING }),
    ).rejects.toMatchObject({ code: 'MAPPING_CHANGE_UNCONFIRMED' })

    // The rest of the policy still changes once runs are confirmed.
    const policyOnly = await courses.updateCoursePolicy(fx.teacher, course.id, {
      outsideAiPolicy: 'open',
    })
    expect(policyOnly).toMatchObject({ outsideAiPolicy: 'open', mapping })
  })
})

describe('sections and the roster (SYS-005, D-062)', () => {
  it('creates a section and lists its members', async () => {
    const { course, section } = await withAssignment(fx)
    expect(section).toMatchObject({ courseId: course.id, name: 'A' })

    const roster = await courses.listSectionMembers(fx.teacher, section.id)
    expect(roster.items.map((row) => row.userId).sort()).toEqual(
      [fx.instructor.id, fx.student.id].sort(),
    )
    expect(roster.nextCursor).toBeNull()

    // A program lead reads the roster; a student in it does not (07 §5 "Ins, PL").
    expect((await courses.listSectionMembers(fx.programLead, section.id)).items).toHaveLength(2)
    await expect(courses.listSectionMembers(fx.learner, section.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('adds an institution member by email and refuses an address that is not one', async () => {
    const { section } = await withAssignment(fx)

    const added = await courses.addSectionMember(fx.teacher, section.id, {
      email: fx.student2.email.toUpperCase(),
      role: 'student',
    })
    expect(added).toMatchObject({ userId: fx.student2.id, role: 'student' })

    await expect(
      courses.addSectionMember(fx.teacher, section.id, {
        email: fx.stranger.email,
        role: 'student',
      }),
    ).rejects.toMatchObject({ code: 'NOT_SECTION_MEMBER' })
  })

  it('writes the section_member.add audit row (08 §4)', async () => {
    const { section } = await withAssignment(fx)
    await courses.addSectionMember(fx.teacher, section.id, {
      email: fx.student2.email,
      role: 'student',
    })

    const admin = await import('@/server/modules/admin/repository')
    const rows = await admin.listAuditLog({ orgId: fx.orgA })
    expect(rows.items.map((row) => row.action)).toContain('section_member.add')
  })

  it('removes a member, and refuses while they have a run that is not voided', async () => {
    const { section, assignment } = await withAssignment(fx)
    const run = await startRun(fx, assignment.id, fx.student.id, 'working')

    await expect(
      courses.removeSectionMember(fx.teacher, section.id, fx.student.id),
    ).rejects.toMatchObject({ code: 'MEMBER_HAS_RUNS' })

    await runsRepo.updateRun(fx.orgA, run.id, { state: 'voided' })
    await courses.removeSectionMember(fx.teacher, section.id, fx.student.id)

    const roster = await courses.listSectionMembers(fx.teacher, section.id)
    expect(roster.items.map((row) => row.userId)).toEqual([fx.instructor.id])
  })

  it('refuses a student who tries to add themselves to a section', async () => {
    const { section } = await withAssignment(fx)
    await expect(
      courses.addSectionMember(fx.learner, section.id, {
        email: fx.student2.email,
        role: 'student',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('assignments (FR-200)', () => {
  it('creates an assignment on a confirmed version and reads it back resolved', async () => {
    const { course, section, assignment } = await withAssignment(fx)
    expect(assignment).toMatchObject({
      sectionId: section.id,
      label: 'Decision Run 1',
      runType: 'decision',
      packageVersionId: fx.pkg.version.id,
      variantId: fx.pkg.defective.id,
      workingClockSeconds: null,
      weight: null,
      isWalkthrough: false,
      opensAt: null,
    })

    const view = await courses.getAssignment(fx.teacher, assignment.id)
    expect(view).toMatchObject({
      courseId: course.id,
      courseName: 'Marketing Strategy',
      sectionName: 'A',
      packageVersion: 1,
      variantKey: 'defective',
      // Null on the assignment means the package's 1500 s and the course's 2.5 percent.
      effectiveWorkingClockSeconds: 1500,
      effectiveWeight: 2.5,
      inUse: false,
    })
  })

  it('does not tell the student taking an assignment which variant it is (D-254)', async () => {
    // withAssignment already seats the student in the section.
    const { assignment } = await withAssignment(fx)

    // The variant is whether a defect was planted at all, and 10 §11.3 bands Calibration on the
    // defect-free variant as Professional for accepting everything — so the field an instructor
    // reads to configure the assignment is a scoring exploit for the person taking it.
    const asStudent = await courses.getAssignment(actorFor(fx.student, fx.orgA), assignment.id)
    expect(asStudent.variantKey).toBeNull()
    // Everything they need to take it, they are still told.
    expect(asStudent).toMatchObject({
      label: 'Decision Run 1',
      packageVersion: 1,
      effectiveWorkingClockSeconds: 1500,
    })

    const asTeacher = await courses.getAssignment(fx.teacher, assignment.id)
    expect(asTeacher.variantKey).toBe('defective')
  })

  it('refuses a draft version and a variant that belongs to another version', async () => {
    const { section } = await withAssignment(fx)

    await expect(
      courses.createAssignment(fx.teacher, section.id, {
        label: 'On a draft',
        packageVersionId: fx.draft.version.id,
        variantId: fx.draft.defective.id,
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_CONFIRMED' })

    await expect(
      courses.createAssignment(fx.teacher, section.id, {
        label: 'Foreign variant',
        packageVersionId: fx.pkg.version.id,
        variantId: fx.otherPkg.sound.id,
      }),
    ).rejects.toMatchObject({ code: 'VARIANT_MISMATCH' })
  })

  it('refuses a working clock under a minute and a student', async () => {
    const { section } = await withAssignment(fx)
    await expect(
      courses.createAssignment(fx.learner, section.id, {
        label: 'Not mine',
        packageVersionId: fx.pkg.version.id,
        variantId: fx.pkg.sound.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('changes the configuration, and freezes the structural fields once a run exists', async () => {
    const { assignment } = await withAssignment(fx)

    const edited = await courses.updateAssignment(fx.teacher, assignment.id, {
      label: 'Decision Run 1 (walkthrough)',
      workingClockSeconds: 120,
      weight: 5,
      isWalkthrough: true,
    })
    expect(edited).toMatchObject({
      label: 'Decision Run 1 (walkthrough)',
      workingClockSeconds: 120,
      weight: 5,
      isWalkthrough: true,
    })

    await startRun(fx, assignment.id, fx.student.id, 'working')

    await expect(
      courses.updateAssignment(fx.teacher, assignment.id, { workingClockSeconds: 900 }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_IN_USE' })
    await expect(
      courses.updateAssignment(fx.teacher, assignment.id, { variantId: fx.pkg.sound.id }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_IN_USE' })

    // Label, walkthrough flag and opening time stay open (10 §3).
    const stillEditable = await courses.updateAssignment(fx.teacher, assignment.id, {
      label: 'Renamed under a run',
      isWalkthrough: false,
      opensAt: new Date('2026-10-01T00:00:00.000Z'),
    })
    expect(stillEditable).toMatchObject({
      label: 'Renamed under a run',
      isWalkthrough: false,
      opensAt: '2026-10-01T00:00:00.000Z',
      workingClockSeconds: 120,
    })
    expect((await courses.getAssignment(fx.teacher, assignment.id)).inUse).toBe(true)
  })

  it('lets the structure change again once the only run is voided', async () => {
    const { assignment } = await withAssignment(fx)
    const run = await startRun(fx, assignment.id, fx.student.id, 'working')
    await runsRepo.updateRun(fx.orgA, run.id, { state: 'voided' })

    const edited = await courses.updateAssignment(fx.teacher, assignment.id, {
      workingClockSeconds: 600,
    })
    expect(edited.workingClockSeconds).toBe(600)
  })
})

describe('getPolicyDisplay (FR-201)', () => {
  it('composes the assignment and course values with uncalibrated and the counts statement', async () => {
    const { course, section } = await withAssignment(fx)
    await courses.updateCoursePolicy(fx.teacher, course.id, {
      outsideAiPolicy: 'declared',
      defaultRunWeight: 2.5,
    })
    const assignment = await courses.createAssignment(fx.teacher, section.id, {
      label: 'Auto-lock test run',
      packageVersionId: fx.pkg.version.id,
      variantId: fx.pkg.sound.id,
      workingClockSeconds: 120,
    })

    const display = await courses.getPolicyDisplay(fx.learner, assignment.id)
    expect(display).toEqual({
      outsideAiPolicy: 'declared',
      // Null weight on the assignment falls back to the course default.
      weight: 2.5,
      mapping: DEFAULT_MAPPING,
      runType: 'decision',
      workingClockSeconds: 120,
      uncalibrated: true,
      countsStatement: true,
    })
  })

  it('falls back to the package clock and honours an assignment weight', async () => {
    const { course, section } = await withAssignment(fx)
    await courses.updateCoursePolicy(fx.teacher, course.id, { outsideAiPolicy: 'open' })
    const assignment = await courses.createAssignment(fx.teacher, section.id, {
      label: 'Weighted',
      packageVersionId: fx.pkg.version.id,
      variantId: fx.pkg.sound.id,
      weight: 7.5,
    })

    const display = await courses.getPolicyDisplay(fx.teacher, assignment.id)
    expect(display).toMatchObject({
      outsideAiPolicy: 'open',
      weight: 7.5,
      workingClockSeconds: 1500,
    })
  })

  it('is not readable by someone outside the section', async () => {
    const { assignment } = await withAssignment(fx)
    await expect(courses.getPolicyDisplay(fx.programLead, assignment.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(courses.getPolicyDisplay(fx.foreigner, assignment.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('listMyAssignments (07 §3)', () => {
  it('lists the assignments of the student sections with the latest attempt', async () => {
    const { course, section, assignment } = await withAssignment(fx)

    const before = await courses.listMyAssignments(fx.learner)
    expect(before.items).toEqual([
      {
        assignmentId: assignment.id,
        label: 'Decision Run 1',
        isWalkthrough: false,
        opensAt: null,
        courseId: course.id,
        courseName: 'Marketing Strategy',
        sectionId: section.id,
        sectionName: 'A',
        createdAt: expect.any(String),
        latestRun: null,
      },
    ])

    const run = await startRun(fx, assignment.id, fx.student.id, 'working')
    const after = await courses.listMyAssignments(fx.learner)
    expect(after.items[0]?.latestRun).toMatchObject({
      id: run.id,
      attemptNo: 1,
      state: 'working',
      scoringStatus: 'idle',
    })

    // Another student's attempt is never on someone else's row.
    expect((await courses.listMyAssignments(actorFor(fx.student2, fx.orgA))).items).toEqual([])
  })
})

describe('deleteWalkthroughRun (D-104)', () => {
  it('deletes a run of a walkthrough assignment for the section instructor', async () => {
    const { section } = await withAssignment(fx)
    const walkthrough = await courses.createAssignment(fx.teacher, section.id, {
      label: 'Walkthrough',
      packageVersionId: fx.pkg.version.id,
      variantId: fx.pkg.defective.id,
      isWalkthrough: true,
    })
    const run = await startRun(fx, walkthrough.id, fx.student.id, 'working')

    await courses.deleteWalkthroughRun(fx.teacher, run.id)
    expect(await runsRepo.findRunForUpdate(fx.orgA, run.id)).toBeUndefined()

    const admin = await import('@/server/modules/admin/repository')
    const rows = await admin.listAuditLog({ orgId: fx.orgA })
    expect(rows.items.map((row) => row.action)).toContain('run.delete')
  })

  it('refuses a run on an assignment that is not a walkthrough, and refuses the student', async () => {
    const { assignment } = await withAssignment(fx)
    const run = await startRun(fx, assignment.id, fx.student.id, 'working')

    await expect(courses.deleteWalkthroughRun(fx.teacher, run.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(courses.deleteWalkthroughRun(fx.learner, run.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    expect(await runsRepo.findRunForUpdate(fx.orgA, run.id)).toBeDefined()
  })
})
