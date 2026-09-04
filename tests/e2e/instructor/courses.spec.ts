// Step 4.2, UI-030 (FR-200, FR-205): an instructor creates a course, gives it a section, and sets
// the policy the runs under it are taken with — and a student who is in the institution but not in
// that course meets the not-found page rather than the course.
//
// The course is created by this spec rather than taken from the seed (14 §2): the policy save and
// the section are writes, and the seeded walkthrough course is what every other spec reads. Its
// name carries SUITE_PREFIX, which is how `tests/e2e/global-setup.ts` finds it again and takes it
// out at the end of the run.
import type { Page } from '@playwright/test'
import { expect, signInAs, signOut, test } from '../fixtures'
import { suiteName } from '../fixture-package'

const TERM = '2026-fall'
const SECTION_NAME = 'Section E2E'
const CONCEPTS = 'pricing power\ncannibalization'

/**
 * Opens a dialog whose trigger is a client component.
 *
 * A production build paints the courses table before React has attached, so a click that lands in
 * that gap is swallowed — the trigger is a button with no href and nothing else happens. The click
 * is retried until the dialog is actually open, which is what a person does too.
 */
async function openDialog(page: Page, triggerName: string, title: string) {
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: title }) })
  await expect(async () => {
    await page.getByRole('button', { name: triggerName }).click()
    await expect(dialog).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 30_000 })
  return dialog
}

test('an instructor creates a course, adds a section, and sets its policy', async ({ page }) => {
  const courseName = suiteName('Courses')

  await signInAs(page, 'instructor')
  await page.goto('/courses')
  await expect(page.getByRole('heading', { level: 1, name: 'Courses' })).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()

  // UI-030 → "New course": two fields, and the course that results is where everything else is set.
  const newCourse = await openDialog(page, 'New course', 'New course')
  await expect(
    newCourse.getByText(
      'Name it and give it a term. Policy, weight, and the band mapping are set on the course once it exists.',
    ),
  ).toBeVisible()
  await newCourse.getByLabel('Course name').fill(courseName)
  await newCourse.getByLabel('Term').fill(TERM)
  await newCourse.getByRole('button', { name: 'Create course' }).click()

  // The form lands on the course itself, which is where the policy and the mapping live.
  await page.waitForURL(/\/courses\/[0-9a-f-]{36}$/)
  const courseId = new URL(page.url()).pathname.split('/').at(-1) ?? ''
  expect(courseId).toMatch(/^[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1, name: courseName })).toBeVisible()
  await expect(page.getByText(`Term ${TERM}`)).toBeVisible()

  // The four sub-views are links, so each one is an address (UI-030 Tree).
  const views = page.getByRole('navigation', { name: 'Course views' })
  for (const label of ['Sections', 'Assignments', 'Policy', 'Mapping']) {
    await expect(views.getByRole('link', { name: label, exact: true })).toBeVisible()
  }

  // Sections: the empty state first, then the section this spec adds.
  await expect(page.getByRole('heading', { level: 2, name: 'Sections' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'No sections yet' })).toBeVisible()

  const newSection = await openDialog(page, 'New section', 'New section')
  await newSection.getByLabel('Section name').fill(SECTION_NAME)
  await newSection.getByRole('button', { name: 'Add section' }).click()
  await expect(page.getByText(`Section ${SECTION_NAME} added.`)).toBeVisible()

  const sectionRow = page.getByRole('row').filter({ hasText: SECTION_NAME })
  await expect(sectionRow).toBeVisible()
  // Nobody is in it and nothing runs on it yet; the roster is the way to the first of those.
  await expect(sectionRow.getByRole('cell').nth(1)).toHaveText('0')
  await expect(sectionRow.getByRole('cell').nth(2)).toHaveText('0')
  await expect(
    sectionRow.getByRole('link', { name: `Open the roster for ${SECTION_NAME}` }),
  ).toBeVisible()

  // Policy (FR-205, PRD §7.19): the three plain-language options, the weight, the taught concepts.
  await views.getByRole('link', { name: 'Policy', exact: true }).click()
  await page.waitForURL(/\?tab=policy$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Policy and weight' })).toBeVisible()
  // Tassl displays the policy and never enforces it; the legend has to say so (FR-062).
  await expect(
    page.getByText(
      'Tassl displays this policy and never enforces it. It does not detect, infer, or estimate undeclared use, and a declaration never lowers a band or a point.',
    ),
  ).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Declared' })).toBeChecked()

  await page.getByRole('radio', { name: 'In-Environment Only' }).check()
  await page.getByLabel('Default run weight').fill('4')
  await page.getByLabel('Taught concepts').fill(CONCEPTS)
  await page.getByRole('button', { name: 'Save policy' }).click()
  await expect(page.getByText('Policy saved.')).toBeVisible()

  // Saved, not just echoed: a fresh server render carries the same three answers.
  await page.reload()
  await expect(page.getByRole('radio', { name: 'In-Environment Only' })).toBeChecked()
  await expect(page.getByLabel('Default run weight')).toHaveValue('4')
  await expect(page.getByLabel('Taught concepts')).toHaveValue(CONCEPTS)

  // The list now counts what hangs off the course (UI-030 list columns).
  await page.goto('/courses')
  const courseRow = page.getByRole('row').filter({ hasText: courseName })
  await expect(courseRow.getByRole('cell').nth(1)).toHaveText(TERM)
  await expect(courseRow.getByRole('cell').nth(2)).toHaveText('1')
  await expect(courseRow.getByRole('cell').nth(3)).toHaveText('0')

  await signOut(page)

  // A student of the same institution who holds no membership in this course: the course does not
  // exist for them (08 §4), and it is not in their list either.
  await signInAs(page, 'student1')
  await page.goto('/courses')
  await expect(page.getByRole('link', { name: `Open ${courseName}` })).toHaveCount(0)

  await page.goto(`/courses/${courseId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible()
  await expect(
    page.getByText(
      'There is nothing at this address. It may have moved, or the link may be wrong.',
    ),
  ).toBeVisible()
  // The shell is still around it, so the reader has every way out (UI-007 inside the shell).
  await expect(page.getByRole('link', { name: 'Go home' })).toBeVisible()

  await signOut(page)
})
