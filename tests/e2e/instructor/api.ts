// Setup the instructor specs need but do not prove.
//
// Each of these is one documented endpoint of `07-api-spec.md` §5, called through the caller's own
// request context so it carries that context's session cookie — the same exchange the screen makes.
// Creating a course through `/courses` and a section through the course screen is what
// ./courses.spec.ts proves; repeating it by hand in the roster, assignment, walkthrough and a11y
// specs would only make them slower and give them a second reason to fail.
//
// Every name goes through `suiteName`, so `tests/e2e/global-setup.ts` finds these rows again and
// takes them out at the end of the run.
//
// A helper takes either a `Page` — whose request context shares the browser's cookie jar, so the
// screens and these calls are one session — or a bare `APIRequestContext`, which has a jar of its
// own. The second is what a *student* spec wants: it needs an instructor to build the course it
// runs on, and signing that instructor in must not disturb the student session the browser holds.
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { seededPackage, suiteName } from '../fixture-package'
import { seatEmail, SEED_PASSWORD } from '../fixtures'

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
const WRITE_HEADERS = { 'content-type': 'application/json', 'X-Requested-With': 'tassl' } as const

const INSTITUTION = 'Walkthrough University'

/** The deployment's own origin, which Better Auth requires on a cookie-authenticated POST. */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

/** A browser page (calls go through its cookie jar) or a request context with a jar of its own. */
export type Requester = Page | APIRequestContext

const api = (target: Requester): APIRequestContext =>
  'request' in target ? target.request : target

export type CreatedCourse = { id: string; name: string }
export type CreatedSection = { id: string; name: string }
export type CreatedAssignment = { id: string; label: string }

/**
 * An instructor session on the given context.
 *
 * The `origin` header is what `signOut` in `../fixtures.ts` carries and for the same reason: Better
 * Auth refuses a cookie-authenticated POST that arrives without one (`MISSING_OR_NULL_ORIGIN`), and
 * a browser sets it while a standalone API context does not.
 */
export async function signInAsInstructor(target: Requester): Promise<void> {
  const response = await api(target).post('/api/auth/sign-in/email', {
    data: { email: seatEmail('instructor'), password: SEED_PASSWORD, rememberMe: true },
    headers: { 'content-type': 'application/json', origin: BASE_URL },
  })
  expect(response.ok(), `sign-in as instructor: ${await response.text()}`).toBe(true)
}

/** The seeded institution the signed-in seat belongs to (06 §5). */
export async function walkthroughOrgId(target: Requester): Promise<string> {
  const response = await api(target).get('/api/v1/me')
  expect(response.status(), await response.text()).toBe(200)
  const { memberships } = (await response.json()) as {
    memberships: { organizationId: string; name: string; role: string }[]
  }
  const walkthrough = memberships.find((membership) => membership.name === INSTITUTION)
  expect(walkthrough, `memberships: ${JSON.stringify(memberships)}`).toBeDefined()
  return walkthrough?.organizationId ?? ''
}

export async function createCourse(
  target: Requester,
  orgId: string,
  what: string,
): Promise<CreatedCourse> {
  const name = suiteName(what)
  const response = await api(target).post(`/api/v1/institutions/${orgId}/courses`, {
    data: { name, term: '2026-fall' },
    headers: WRITE_HEADERS,
  })
  expect(response.status(), await response.text()).toBe(201)
  const course = (await response.json()) as CreatedCourse
  return { id: course.id, name }
}

export async function createSection(
  target: Requester,
  courseId: string,
  name: string,
): Promise<CreatedSection> {
  const response = await api(target).post(`/api/v1/courses/${courseId}/sections`, {
    data: { name },
    headers: WRITE_HEADERS,
  })
  expect(response.status(), await response.text()).toBe(201)
  const section = (await response.json()) as CreatedSection
  return { id: section.id, name }
}

export async function addSectionMember(
  target: Requester,
  sectionId: string,
  input: { email: string; role: 'student' | 'instructor' | 'ta' },
): Promise<void> {
  const response = await api(target).post(`/api/v1/sections/${sectionId}/members`, {
    data: input,
    headers: WRITE_HEADERS,
  })
  expect(response.status(), await response.text()).toBe(201)
}

export async function createAssignment(
  target: Requester,
  sectionId: string,
  input: { label: string; packageVersionId: string; variantId: string },
): Promise<CreatedAssignment> {
  const response = await api(target).post(`/api/v1/sections/${sectionId}/assignments`, {
    data: input,
    headers: WRITE_HEADERS,
  })
  expect(response.status(), await response.text()).toBe(201)
  const assignment = (await response.json()) as CreatedAssignment
  return { id: assignment.id, label: input.label }
}

export type StudentAssignmentFixture = {
  course: CreatedCourse
  section: CreatedSection
  assignment: CreatedAssignment
  /** The assignment's label; the student specs find their own row in the list by it. */
  label: string
}

/**
 * A course, a section with one student seat on it, and an assignment on the **seeded** confirmed
 * package version — everything a student spec needs before it can press Start, and nothing it is
 * there to prove.
 *
 * A student spec needs this because a run is not repeatable otherwise: D-041 allows one run per
 * student per assignment until it is voided, so a spec that started its run on the seeded
 * walkthrough assignment ("Decision Run 1 (walkthrough)") collided with the other two browser
 * projects inside one run of the suite, and with its own earlier attempt on the next one. An
 * assignment of its own gives every project and every re-run a fresh one, and
 * `tests/e2e/global-setup.ts` takes the run and the rows back out afterwards.
 *
 * The *package* is still the seeded one (06 §5 item 4). Only the assignment is new: the run has to
 * meet the Meridian Roast brief, its nine documents and its sixteen readiness items, because that
 * is the package the walkthrough is defined on.
 */
export async function createStudentAssignment(
  target: Requester,
  input: {
    /** What the rows are named after, under SUITE_PREFIX (e.g. `Walkthrough`). */
    what: string
    /** The seeded seat enrolled as a student on the new section. */
    studentEmail: string
    variant?: 'defective' | 'sound'
  },
): Promise<StudentAssignmentFixture> {
  const orgId = await walkthroughOrgId(target)
  const course = await createCourse(target, orgId, input.what)
  const section = await createSection(target, course.id, `${input.what} section`)
  await addSectionMember(target, section.id, { email: input.studentEmail, role: 'student' })

  const label = suiteName(`${input.what} run`)
  const assignment = await createAssignment(target, section.id, {
    label,
    packageVersionId: seededPackage().versionId,
    variantId: seededPackage().variantIds[input.variant ?? 'defective'],
  })
  return { course, section, assignment, label }
}
