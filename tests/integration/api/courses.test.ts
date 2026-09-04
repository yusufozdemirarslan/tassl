// Step 4.1 — every endpoint of docs/tech/07-api-spec.md §5 this step owns, with one allow case and
// one deny case each, called as a real `Request` through the handler `src/app/api/v1/**/route.ts`
// exports. The deny cases are the "—" cells of 08-auth-authz.md §4 for these rows, plus the
// cross-tenant rule of 07 §1: a course, section, assignment or run in another institution answers
// 404, never 403.
//
// The mapping preview and apply rows, `GET /assignments/{id}/runs` and the export rows belong to
// Phases 11 and 6 and have no handler yet.
//
// `asUser()` supplies the session cookie; non-GET requests carry `X-Requested-With: tassl`, the
// CSRF header `defineRoute` requires of cookie-authenticated mutations (08 §2.7).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, truncateAll } from '@tests/setup/integration'

type OrgCourses = typeof import('@/app/api/v1/institutions/[orgId]/courses/route')
type CourseRoute = typeof import('@/app/api/v1/courses/[courseId]/route')
type SectionsRoute = typeof import('@/app/api/v1/courses/[courseId]/sections/route')
type MembersRoute = typeof import('@/app/api/v1/sections/[sectionId]/members/route')
type MemberRoute = typeof import('@/app/api/v1/sections/[sectionId]/members/[userId]/route')
type AssignmentsRoute = typeof import('@/app/api/v1/sections/[sectionId]/assignments/route')
type AssignmentRoute = typeof import('@/app/api/v1/assignments/[assignmentId]/route')
type PolicyDisplayRoute =
  typeof import('@/app/api/v1/assignments/[assignmentId]/policy-display/route')
type RunRoute = typeof import('@/app/api/v1/runs/[runId]/route')
type Factories = typeof import('@tests/factories')
type Runs = typeof import('@/server/modules/runs/repository')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

let orgCourses: OrgCourses
let courseRoute: CourseRoute
let sectionsRoute: SectionsRoute
let membersRoute: MembersRoute
let memberRoute: MemberRoute
let assignmentsRoute: AssignmentsRoute
let assignmentRoute: AssignmentRoute
let policyDisplayRoute: PolicyDisplayRoute
let runRoute: RunRoute
let f: Factories
let runsRepo: Runs

type Called = { status: number; body: Record<string, unknown> | null }

/** Calls one route handler with a session, the CSRF header, and the matched path parameters. */
async function call(
  handler: RouteHandler,
  options: {
    method?: string
    path: string
    session?: Headers | null
    params?: Record<string, string>
    body?: unknown
  },
): Promise<Called> {
  const method = options.method ?? 'GET'
  const headers = new Headers(options.session ?? undefined)
  if (method !== 'GET') {
    headers.set('x-requested-with', 'tassl')
    headers.set('content-type', 'application/json')
  }
  const request = new Request(`http://localhost:3000/api/v1${options.path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) })
  const text = await response.text()
  return { status: response.status, body: text === '' ? null : (JSON.parse(text) as never) }
}

const errorCode = (called: Called): unknown =>
  (called.body?.error as { code?: unknown } | undefined)?.code

type Fixture = Awaited<ReturnType<typeof seed>>

/**
 * Two institutions; in the first a course with one section holding the instructor and one student,
 * an assignment on a confirmed package version, and a walkthrough assignment with a run on it.
 */
async function seed() {
  const orgA = (await f.createInstitution('api-courses-a')).organization.id
  const orgB = (await f.createInstitution('api-courses-b')).organization.id

  const instructor = await f.createUser('api-courses-instructor')
  const student = await f.createUser('api-courses-student')
  const student2 = await f.createUser('api-courses-student-2')
  const lead = await f.createUser('api-courses-lead')
  const stranger = await f.createUser('api-courses-stranger')
  const outsider = await f.createUser('api-courses-outsider')

  await f.addMember(orgA, instructor.id, 'instructor')
  await f.addMember(orgA, student.id, 'student')
  await f.addMember(orgA, student2.id, 'student')
  await f.addMember(orgA, lead.id, 'program_lead')
  await f.addMember(orgB, outsider.id, 'instructor')

  const pkg = await f.minimalConfirmedVersion(orgA, 'api-courses-confirmed', {
    createdBy: instructor.id,
  })
  const draft = await f.createPackageVersion(orgA, 'api-courses-draft', {
    createdBy: instructor.id,
  })

  const course = await f.createCourse(orgA, 'api-courses', { createdBy: instructor.id })
  const section = await f.createSection(orgA, course.id, 'api-courses-a')
  await f.addSectionMember(orgA, section.id, instructor.id, 'instructor')
  await f.addSectionMember(orgA, section.id, student.id, 'student')

  const assignment = await f.createAssignment(orgA, section.id, 'api-courses-1', {
    packageVersionId: pkg.version.id,
    variantId: pkg.defective.id,
    isWalkthrough: false,
  })
  const walkthrough = await f.createAssignment(orgA, section.id, 'api-courses-walkthrough', {
    packageVersionId: pkg.version.id,
    variantId: pkg.sound.id,
    isWalkthrough: true,
  })
  const walkthroughRun = await runsRepo.insertRun(orgA, {
    assignmentId: walkthrough.id,
    studentId: student.id,
    packageVersionId: pkg.version.id,
    variantId: pkg.sound.id,
    state: 'working',
    workingClockSeconds: 1500,
    turnDelaySeconds: 90,
  })

  // The second institution's own course, section, and package, for the cross-tenant rows.
  const otherCourse = await f.createCourse(orgB, 'api-courses-other', { createdBy: outsider.id })
  const otherSection = await f.createSection(orgB, otherCourse.id, 'api-courses-other-a')

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
    course,
    section,
    assignment,
    walkthrough,
    walkthroughRun,
    otherCourse,
    otherSection,
  }
}

let fx: Fixture

const sessionFor = (user: UserRow, orgId: string | null): Promise<Headers> =>
  asUser(user.id, { activeOrganizationId: orgId })

const asInstructor = (): Promise<Headers> => sessionFor(fx.instructor, fx.orgA)
const asStudent = (): Promise<Headers> => sessionFor(fx.student, fx.orgA)
const asLead = (): Promise<Headers> => sessionFor(fx.lead, fx.orgA)
const asOutsider = (): Promise<Headers> => sessionFor(fx.outsider, fx.orgB)

beforeAll(async () => {
  orgCourses = await import('@/app/api/v1/institutions/[orgId]/courses/route')
  courseRoute = await import('@/app/api/v1/courses/[courseId]/route')
  sectionsRoute = await import('@/app/api/v1/courses/[courseId]/sections/route')
  membersRoute = await import('@/app/api/v1/sections/[sectionId]/members/route')
  memberRoute = await import('@/app/api/v1/sections/[sectionId]/members/[userId]/route')
  assignmentsRoute = await import('@/app/api/v1/sections/[sectionId]/assignments/route')
  assignmentRoute = await import('@/app/api/v1/assignments/[assignmentId]/route')
  policyDisplayRoute = await import('@/app/api/v1/assignments/[assignmentId]/policy-display/route')
  runRoute = await import('@/app/api/v1/runs/[runId]/route')
  f = await import('@tests/factories')
  runsRepo = await import('@/server/modules/runs/repository')
})

beforeEach(async () => {
  await truncateAll()
  fx = await seed()
})

afterAll(async () => {
  await truncateAll()
})

describe('GET /institutions/{orgId}/courses', () => {
  it('lists the institution courses for a member, paginated', async () => {
    const listed = await call(orgCourses.GET, {
      path: `/institutions/${fx.orgA}/courses?limit=10`,
      session: await asInstructor(),
      params: { orgId: fx.orgA },
    })

    expect(listed.status).toBe(200)
    expect(listed.body).toMatchObject({ nextCursor: null })
    const items = listed.body?.items as { id: string; sectionCount: number }[]
    expect(items).toEqual([expect.objectContaining({ id: fx.course.id, sectionCount: 1 })])
  })

  it('answers 404 for an institution the actor does not belong to', async () => {
    const denied = await call(orgCourses.GET, {
      path: `/institutions/${fx.orgA}/courses`,
      session: await asOutsider(),
      params: { orgId: fx.orgA },
    })
    expect(denied.status).toBe(404)
    expect(errorCode(denied)).toBe('NOT_FOUND')
  })

  it('rejects an unknown query parameter', async () => {
    const rejected = await call(orgCourses.GET, {
      path: `/institutions/${fx.orgA}/courses?sort=name`,
      session: await asInstructor(),
      params: { orgId: fx.orgA },
    })
    expect(rejected.status).toBe(400)
    expect(errorCode(rejected)).toBe('VALIDATION_ERROR')
  })
})

describe('POST /institutions/{orgId}/courses', () => {
  it('creates a course for an institution instructor', async () => {
    const created = await call(orgCourses.POST, {
      method: 'POST',
      path: `/institutions/${fx.orgA}/courses`,
      session: await asInstructor(),
      params: { orgId: fx.orgA },
      body: {
        name: 'Marketing Strategy Walkthrough',
        term: '2026-fall',
        outsideAiPolicy: 'declared',
        defaultRunWeight: 2.5,
      },
    })

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      organizationId: fx.orgA,
      name: 'Marketing Strategy Walkthrough',
      outsideAiPolicy: 'declared',
      defaultRunWeight: 2.5,
      mapping: { novice: 1, developing: 2, proficient: 3, professional: 4 },
    })
  })

  it('refuses a student and refuses a mapping that is not four positive numbers', async () => {
    const denied = await call(orgCourses.POST, {
      method: 'POST',
      path: `/institutions/${fx.orgA}/courses`,
      session: await asStudent(),
      params: { orgId: fx.orgA },
      body: { name: 'Nope', term: '2026-fall' },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')

    const invalid = await call(orgCourses.POST, {
      method: 'POST',
      path: `/institutions/${fx.orgA}/courses`,
      session: await asInstructor(),
      params: { orgId: fx.orgA },
      body: {
        name: 'Bad mapping',
        term: '2026-fall',
        mapping: { novice: 0, developing: 2, proficient: 3, professional: 4 },
      },
    })
    expect(invalid.status).toBe(400)
    expect(errorCode(invalid)).toBe('MAPPING_INVALID')
  })
})

describe('GET and PATCH /courses/{courseId}', () => {
  it('returns the course with its sections and assignments for a section member', async () => {
    const read = await call(courseRoute.GET, {
      path: `/courses/${fx.course.id}`,
      session: await asStudent(),
      params: { courseId: fx.course.id },
    })

    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({ id: fx.course.id, outsideAiPolicy: 'declared' })
    const sections = read.body?.sections as { id: string; memberCount: number }[]
    expect(sections).toEqual([expect.objectContaining({ id: fx.section.id, memberCount: 2 })])
    const assignments = read.body?.assignments as { id: string }[]
    expect(assignments.map((row) => row.id).sort()).toEqual(
      [fx.assignment.id, fx.walkthrough.id].sort(),
    )
  })

  it('refuses an institution member who is in none of its sections, and 404s cross-tenant', async () => {
    const denied = await call(courseRoute.GET, {
      path: `/courses/${fx.course.id}`,
      session: await sessionFor(fx.student2, fx.orgA),
      params: { courseId: fx.course.id },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')

    const crossTenant = await call(courseRoute.GET, {
      path: `/courses/${fx.otherCourse.id}`,
      session: await asInstructor(),
      params: { courseId: fx.otherCourse.id },
    })
    expect(crossTenant.status).toBe(404)
    expect(errorCode(crossTenant)).toBe('NOT_FOUND')
  })

  it('updates the policy for the course instructor and refuses a student', async () => {
    const updated = await call(courseRoute.PATCH, {
      method: 'PATCH',
      path: `/courses/${fx.course.id}`,
      session: await asInstructor(),
      params: { courseId: fx.course.id },
      body: { outsideAiPolicy: 'in_environment_only', taughtConcepts: ['pricing_power'] },
    })
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({
      outsideAiPolicy: 'in_environment_only',
      taughtConcepts: ['pricing_power'],
    })

    const denied = await call(courseRoute.PATCH, {
      method: 'PATCH',
      path: `/courses/${fx.course.id}`,
      session: await asStudent(),
      params: { courseId: fx.course.id },
      body: { outsideAiPolicy: 'open' },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')
  })
})

describe('POST /courses/{courseId}/sections', () => {
  it('creates a section for the course instructor', async () => {
    const created = await call(sectionsRoute.POST, {
      method: 'POST',
      path: `/courses/${fx.course.id}/sections`,
      session: await asInstructor(),
      params: { courseId: fx.course.id },
      body: { name: 'B' },
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ courseId: fx.course.id, name: 'B' })
  })

  it('refuses a student', async () => {
    const denied = await call(sectionsRoute.POST, {
      method: 'POST',
      path: `/courses/${fx.course.id}/sections`,
      session: await asStudent(),
      params: { courseId: fx.course.id },
      body: { name: 'C' },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')
  })
})

describe('GET and POST /sections/{sectionId}/members', () => {
  it('lists the roster for the section instructor', async () => {
    const roster = await call(membersRoute.GET, {
      path: `/sections/${fx.section.id}/members`,
      session: await asInstructor(),
      params: { sectionId: fx.section.id },
    })
    expect(roster.status).toBe(200)
    const items = roster.body?.items as { userId: string; role: string }[]
    expect(items.map((row) => row.userId).sort()).toEqual([fx.instructor.id, fx.student.id].sort())
  })

  it('refuses a student on the roster and 404s a section in another institution', async () => {
    const denied = await call(membersRoute.GET, {
      path: `/sections/${fx.section.id}/members`,
      session: await asStudent(),
      params: { sectionId: fx.section.id },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')

    const crossTenant = await call(membersRoute.GET, {
      path: `/sections/${fx.otherSection.id}/members`,
      session: await asInstructor(),
      params: { sectionId: fx.otherSection.id },
    })
    expect(crossTenant.status).toBe(404)
    expect(errorCode(crossTenant)).toBe('NOT_FOUND')
  })

  it('adds an institution member by email and refuses an address that is not one', async () => {
    const added = await call(membersRoute.POST, {
      method: 'POST',
      path: `/sections/${fx.section.id}/members`,
      session: await asInstructor(),
      params: { sectionId: fx.section.id },
      body: { email: fx.student2.email, role: 'student' },
    })
    expect(added.status).toBe(201)
    expect(added.body).toMatchObject({
      userId: fx.student2.id,
      email: fx.student2.email,
      role: 'student',
    })

    const unknown = await call(membersRoute.POST, {
      method: 'POST',
      path: `/sections/${fx.section.id}/members`,
      session: await asInstructor(),
      params: { sectionId: fx.section.id },
      body: { email: fx.stranger.email, role: 'student' },
    })
    expect(unknown.status).toBe(403)
    expect(errorCode(unknown)).toBe('NOT_SECTION_MEMBER')
  })
})

describe('DELETE /sections/{sectionId}/members/{userId}', () => {
  it('removes a member with 204 and no body', async () => {
    // student2 has no run, so nothing holds the membership in place (10 §3 `MEMBER_HAS_RUNS`).
    await f.addSectionMember(fx.orgA, fx.section.id, fx.student2.id, 'student')

    const removed = await call(memberRoute.DELETE, {
      method: 'DELETE',
      path: `/sections/${fx.section.id}/members/${fx.student2.id}`,
      session: await asInstructor(),
      params: { sectionId: fx.section.id, userId: fx.student2.id },
    })
    expect(removed.status).toBe(204)
    expect(removed.body).toBeNull()

    const roster = await call(membersRoute.GET, {
      path: `/sections/${fx.section.id}/members`,
      session: await asInstructor(),
      params: { sectionId: fx.section.id },
    })
    const items = roster.body?.items as { userId: string }[]
    expect(items.map((row) => row.userId)).not.toContain(fx.student2.id)
  })

  it('refuses while the person has a run that is not voided, and refuses a student', async () => {
    await runsRepo.insertRun(fx.orgA, {
      assignmentId: fx.assignment.id,
      studentId: fx.student.id,
      packageVersionId: fx.pkg.version.id,
      variantId: fx.pkg.defective.id,
      state: 'working',
      workingClockSeconds: 1500,
      turnDelaySeconds: 90,
    })

    const blocked = await call(memberRoute.DELETE, {
      method: 'DELETE',
      path: `/sections/${fx.section.id}/members/${fx.student.id}`,
      session: await asInstructor(),
      params: { sectionId: fx.section.id, userId: fx.student.id },
    })
    expect(blocked.status).toBe(409)
    expect(errorCode(blocked)).toBe('MEMBER_HAS_RUNS')

    const denied = await call(memberRoute.DELETE, {
      method: 'DELETE',
      path: `/sections/${fx.section.id}/members/${fx.instructor.id}`,
      session: await asStudent(),
      params: { sectionId: fx.section.id, userId: fx.instructor.id },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')
  })
})

describe('POST /sections/{sectionId}/assignments', () => {
  it('creates an assignment on a confirmed version', async () => {
    const created = await call(assignmentsRoute.POST, {
      method: 'POST',
      path: `/sections/${fx.section.id}/assignments`,
      session: await asInstructor(),
      params: { sectionId: fx.section.id },
      body: {
        label: 'Auto-lock test run',
        packageVersionId: fx.pkg.version.id,
        variantId: fx.pkg.sound.id,
        workingClockSeconds: 120,
        isWalkthrough: true,
      },
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      sectionId: fx.section.id,
      label: 'Auto-lock test run',
      variantId: fx.pkg.sound.id,
      workingClockSeconds: 120,
      isWalkthrough: true,
      runType: 'decision',
    })
  })

  it('refuses a draft version, a foreign variant, a clock under a minute, and a student', async () => {
    const session = await asInstructor()
    const draft = await call(assignmentsRoute.POST, {
      method: 'POST',
      path: `/sections/${fx.section.id}/assignments`,
      session,
      params: { sectionId: fx.section.id },
      body: {
        label: 'On a draft',
        packageVersionId: fx.draft.version.id,
        variantId: fx.draft.sound.id,
      },
    })
    expect(draft.status).toBe(409)
    expect(errorCode(draft)).toBe('PACKAGE_NOT_CONFIRMED')

    const variant = await call(assignmentsRoute.POST, {
      method: 'POST',
      path: `/sections/${fx.section.id}/assignments`,
      session: await asInstructor(),
      params: { sectionId: fx.section.id },
      body: {
        label: 'Foreign variant',
        packageVersionId: fx.pkg.version.id,
        variantId: fx.draft.sound.id,
      },
    })
    expect(variant.status).toBe(400)
    expect(errorCode(variant)).toBe('VARIANT_MISMATCH')

    const tooShort = await call(assignmentsRoute.POST, {
      method: 'POST',
      path: `/sections/${fx.section.id}/assignments`,
      session: await asInstructor(),
      params: { sectionId: fx.section.id },
      body: {
        label: 'Too short',
        packageVersionId: fx.pkg.version.id,
        variantId: fx.pkg.sound.id,
        workingClockSeconds: 30,
      },
    })
    expect(tooShort.status).toBe(400)
    expect(errorCode(tooShort)).toBe('VALIDATION_ERROR')

    const denied = await call(assignmentsRoute.POST, {
      method: 'POST',
      path: `/sections/${fx.section.id}/assignments`,
      session: await asStudent(),
      params: { sectionId: fx.section.id },
      body: {
        label: 'Not mine',
        packageVersionId: fx.pkg.version.id,
        variantId: fx.pkg.sound.id,
      },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')
  })
})

describe('GET and PATCH /assignments/{assignmentId}', () => {
  it('returns the assignment with its package, variant, and resolved values', async () => {
    const read = await call(assignmentRoute.GET, {
      path: `/assignments/${fx.assignment.id}`,
      session: await asStudent(),
      params: { assignmentId: fx.assignment.id },
    })
    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({
      id: fx.assignment.id,
      courseId: fx.course.id,
      sectionName: 'A',
      packageVersion: 1,
      variantKey: 'defective',
      effectiveWorkingClockSeconds: 1500,
      effectiveWeight: 2.5,
      inUse: false,
    })
  })

  it('updates the configuration, freezes it once a run exists, and refuses a student', async () => {
    const updated = await call(assignmentRoute.PATCH, {
      method: 'PATCH',
      path: `/assignments/${fx.assignment.id}`,
      session: await asInstructor(),
      params: { assignmentId: fx.assignment.id },
      body: { workingClockSeconds: 1500 },
    })
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ workingClockSeconds: 1500 })

    await runsRepo.insertRun(fx.orgA, {
      assignmentId: fx.assignment.id,
      studentId: fx.student.id,
      packageVersionId: fx.pkg.version.id,
      variantId: fx.pkg.defective.id,
      state: 'working',
      workingClockSeconds: 1500,
      turnDelaySeconds: 90,
    })

    const frozen = await call(assignmentRoute.PATCH, {
      method: 'PATCH',
      path: `/assignments/${fx.assignment.id}`,
      session: await asInstructor(),
      params: { assignmentId: fx.assignment.id },
      body: { workingClockSeconds: 900 },
    })
    expect(frozen.status).toBe(409)
    expect(errorCode(frozen)).toBe('ASSIGNMENT_IN_USE')

    const renamed = await call(assignmentRoute.PATCH, {
      method: 'PATCH',
      path: `/assignments/${fx.assignment.id}`,
      session: await asInstructor(),
      params: { assignmentId: fx.assignment.id },
      body: { label: 'Renamed' },
    })
    expect(renamed.status).toBe(200)

    const denied = await call(assignmentRoute.PATCH, {
      method: 'PATCH',
      path: `/assignments/${fx.assignment.id}`,
      session: await asStudent(),
      params: { assignmentId: fx.assignment.id },
      body: { label: 'Not mine' },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')
  })

  it('answers 404 for an assignment in another institution', async () => {
    const crossTenant = await call(assignmentRoute.GET, {
      path: `/assignments/${fx.assignment.id}`,
      session: await asOutsider(),
      params: { assignmentId: fx.assignment.id },
    })
    expect(crossTenant.status).toBe(404)
    expect(errorCode(crossTenant)).toBe('NOT_FOUND')
  })
})

describe('GET /assignments/{assignmentId}/policy-display', () => {
  it('returns the policy display values a run start screen shows', async () => {
    const read = await call(policyDisplayRoute.GET, {
      path: `/assignments/${fx.assignment.id}/policy-display`,
      session: await asStudent(),
      params: { assignmentId: fx.assignment.id },
    })
    expect(read.status).toBe(200)
    expect(read.body).toEqual({
      outsideAiPolicy: 'declared',
      weight: 2.5,
      mapping: { novice: 1, developing: 2, proficient: 3, professional: 4 },
      runType: 'decision',
      workingClockSeconds: 1500,
      uncalibrated: true,
      countsStatement: true,
    })
  })

  it('refuses an institution member who is in none of the assignment sections', async () => {
    const denied = await call(policyDisplayRoute.GET, {
      path: `/assignments/${fx.assignment.id}/policy-display`,
      session: await asLead(),
      params: { assignmentId: fx.assignment.id },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')
  })
})

describe('DELETE /runs/{runId}', () => {
  it('deletes a walkthrough run for the section instructor with 204', async () => {
    const deleted = await call(runRoute.DELETE, {
      method: 'DELETE',
      path: `/runs/${fx.walkthroughRun.id}`,
      session: await asInstructor(),
      params: { runId: fx.walkthroughRun.id },
    })
    expect(deleted.status).toBe(204)
    expect(deleted.body).toBeNull()
    expect(await runsRepo.findRunForUpdate(fx.orgA, fx.walkthroughRun.id)).toBeUndefined()
  })

  it('refuses a run that is not on a walkthrough assignment, and refuses the student', async () => {
    const run = await runsRepo.insertRun(fx.orgA, {
      assignmentId: fx.assignment.id,
      studentId: fx.student.id,
      packageVersionId: fx.pkg.version.id,
      variantId: fx.pkg.defective.id,
      state: 'working',
      workingClockSeconds: 1500,
      turnDelaySeconds: 90,
    })

    const notWalkthrough = await call(runRoute.DELETE, {
      method: 'DELETE',
      path: `/runs/${run.id}`,
      session: await asInstructor(),
      params: { runId: run.id },
    })
    expect(notWalkthrough.status).toBe(403)
    expect(errorCode(notWalkthrough)).toBe('FORBIDDEN')

    const denied = await call(runRoute.DELETE, {
      method: 'DELETE',
      path: `/runs/${fx.walkthroughRun.id}`,
      session: await asStudent(),
      params: { runId: fx.walkthroughRun.id },
    })
    expect(denied.status).toBe(403)
    expect(errorCode(denied)).toBe('FORBIDDEN')
  })

  it('answers 404 for a run in another institution', async () => {
    const crossTenant = await call(runRoute.DELETE, {
      method: 'DELETE',
      path: `/runs/${fx.walkthroughRun.id}`,
      session: await asOutsider(),
      params: { runId: fx.walkthroughRun.id },
    })
    expect(crossTenant.status).toBe(404)
    expect(errorCode(crossTenant)).toBe('NOT_FOUND')
  })
})
