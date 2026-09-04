// Setup the instructor specs need but do not prove.
//
// Each of these is one documented endpoint of `07-api-spec.md` §5, called through the page's own
// request context so it carries the browser's session cookie — the same exchange the screen makes.
// Creating a course through `/courses` and a section through the course screen is what
// ./courses.spec.ts proves; repeating it by hand in the roster, assignment and a11y specs would
// only make them slower and give them a second reason to fail.
//
// Every name goes through `suiteName`, so `tests/e2e/global-setup.ts` finds these rows again and
// takes them out at the end of the run.
import { expect, type Page } from '@playwright/test'
import { suiteName } from '../fixture-package'

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
const WRITE_HEADERS = { 'content-type': 'application/json', 'X-Requested-With': 'tassl' } as const

const INSTITUTION = 'Walkthrough University'

export type CreatedCourse = { id: string; name: string }
export type CreatedSection = { id: string; name: string }
export type CreatedAssignment = { id: string; label: string }

/** The seeded institution the signed-in seat belongs to (06 §5). */
export async function walkthroughOrgId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/me')
  expect(response.status(), await response.text()).toBe(200)
  const { memberships } = (await response.json()) as {
    memberships: { organizationId: string; name: string; role: string }[]
  }
  const walkthrough = memberships.find((membership) => membership.name === INSTITUTION)
  expect(walkthrough, `memberships: ${JSON.stringify(memberships)}`).toBeDefined()
  return walkthrough?.organizationId ?? ''
}

export async function createCourse(
  page: Page,
  orgId: string,
  what: string,
): Promise<CreatedCourse> {
  const name = suiteName(what)
  const response = await page.request.post(`/api/v1/institutions/${orgId}/courses`, {
    data: { name, term: '2026-fall' },
    headers: WRITE_HEADERS,
  })
  expect(response.status(), await response.text()).toBe(201)
  const course = (await response.json()) as CreatedCourse
  return { id: course.id, name }
}

export async function createSection(
  page: Page,
  courseId: string,
  name: string,
): Promise<CreatedSection> {
  const response = await page.request.post(`/api/v1/courses/${courseId}/sections`, {
    data: { name },
    headers: WRITE_HEADERS,
  })
  expect(response.status(), await response.text()).toBe(201)
  const section = (await response.json()) as CreatedSection
  return { id: section.id, name }
}

export async function addSectionMember(
  page: Page,
  sectionId: string,
  input: { email: string; role: 'student' | 'instructor' | 'ta' },
): Promise<void> {
  const response = await page.request.post(`/api/v1/sections/${sectionId}/members`, {
    data: input,
    headers: WRITE_HEADERS,
  })
  expect(response.status(), await response.text()).toBe(201)
}

export async function createAssignment(
  page: Page,
  sectionId: string,
  input: { label: string; packageVersionId: string; variantId: string },
): Promise<CreatedAssignment> {
  const response = await page.request.post(`/api/v1/sections/${sectionId}/assignments`, {
    data: input,
    headers: WRITE_HEADERS,
  })
  expect(response.status(), await response.text()).toBe(201)
  const assignment = (await response.json()) as CreatedAssignment
  return { id: assignment.id, label: input.label }
}
