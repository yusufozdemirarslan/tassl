// Step 4.4, UI-032 (FR-200): an assignment on a confirmed package version, then the two things an
// instructor changes about one afterwards — the working clock and the walkthrough flag.
//
// The confirmed version is the fixture `tests/e2e/global-setup.ts` writes: no package is confirmed
// in the seeded database until Phase 5, and `createAssignment` refuses a draft
// (`PACKAGE_NOT_CONFIRMED`) and a variant of another version (`VARIANT_MISMATCH`).
//
// The assignment itself is created through `POST /api/v1/sections/{sectionId}/assignments` rather
// than through the course screen: the course detail has no "New assignment" control (see the
// DEFECT note below), so the endpoint the missing control would call is the only way an assignment
// comes into existence in this build. Everything after it is the UI.
//
// DEFECT (reported, not fixed here): step 4.4 lists `src/app/(app)/courses/[courseId]/page.tsx` as
// a file to modify so that "New assignment" opens `AssignmentForm` with the section's id. The
// Assignments sub-view renders `AssignmentsList` and nothing else, so an instructor cannot create
// an assignment anywhere in the product. `AssignmentForm` already accepts the `sectionId` shape the
// control needs.
import { expect, signInAs, signOut, test } from '../fixtures'
import { seededPackage, suiteName } from '../fixture-package'
import { createAssignment, createCourse, createSection, walkthroughOrgId } from './api'

const SECTION_NAME = 'Section A1'
/** `courses.default_run_weight` for a course created without one (06 §3.2). */
const COURSE_DEFAULT_WEIGHT = '2.5'

test('an instructor configures an assignment: the working clock and the walkthrough toggle', async ({
  page,
}) => {
  await signInAs(page, 'instructor')
  const orgId = await walkthroughOrgId(page)
  const course = await createCourse(page, orgId, 'Assignment')
  const section = await createSection(page, course.id, SECTION_NAME)

  const label = suiteName('Decision Run')
  const assignment = await createAssignment(page, section.id, {
    label,
    packageVersionId: seededPackage().versionId,
    variantId: seededPackage().variantIds.defective,
  })

  // The course's Assignments sub-view is the way in (UI-030 → Assignments).
  await page.goto(`/courses/${course.id}?tab=assignments`)
  const listRow = page.getByRole('row').filter({ hasText: label })
  await expect(listRow).toBeVisible()
  await expect(listRow.getByRole('cell').nth(1)).toHaveText('Decision run')
  await expect(listRow.getByRole('cell').nth(2)).toHaveText('Open now')
  // No override yet, so the list names the package's clock rather than a number of its own.
  await expect(listRow.getByRole('cell').nth(3)).toHaveText('Package default')
  await listRow.getByRole('link', { name: `Configure ${label}` }).click()

  await page.waitForURL(`**/assignments/${assignment.id}`)
  await page.waitForLoadState('networkidle')

  // UI-032 configuration: what every run on this assignment is taken under.
  await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible()
  await expect(page.getByText(`${course.name} · ${SECTION_NAME}`)).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Configuration' })).toBeVisible()
  await expect(page.getByLabel('Assignment name')).toHaveValue(label)
  await expect(page.locator('#assignment-package')).toContainText(
    `${seededPackage().title} · version ${seededPackage().versionNumber}`,
  )
  await expect(page.getByRole('radio', { name: 'Defective' })).toBeChecked()

  const clock = page.getByLabel('Working clock (seconds)')
  await expect(clock).toHaveValue('')
  await expect(
    page.getByText(
      `The package sets ${seededPackage().workingClockSeconds} seconds. Leave this empty to follow it.`,
    ),
  ).toBeVisible()
  await expect(page.getByLabel('Weight')).toHaveValue('')
  await expect(
    page.getByText(`The course sets ${COURSE_DEFAULT_WEIGHT}. Leave this empty to follow it.`),
  ).toBeVisible()

  const walkthrough = page.getByRole('switch', { name: 'Walkthrough' })
  await expect(walkthrough).not.toBeChecked()

  // The runs table is Phase 6; the panel says so rather than standing in for it.
  await expect(page.getByRole('heading', { level: 2, name: 'Runs' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'No runs yet' })).toBeVisible()

  const save = page.getByRole('button', { name: 'Save configuration' })

  // A clock under a minute is refused where it is typed, before the round trip (10 §3).
  await clock.fill('30')
  await save.click()
  await expect(page.getByText('Enter whole seconds, at least 60, or leave it empty.')).toBeVisible()

  // The working clock this assignment overrides the package with.
  await clock.fill('900')
  await save.click()
  await expect(page.getByText('The assignment is saved.')).toBeVisible()

  await page.reload()
  await expect(page.getByLabel('Working clock (seconds)')).toHaveValue('900')

  // The walkthrough toggle: a practice assignment, whose runs can be deleted rather than voided.
  const toggle = page.getByRole('switch', { name: 'Walkthrough' })
  await toggle.click()
  await expect(toggle).toBeChecked()
  await page.getByRole('button', { name: 'Save configuration' }).click()
  await expect(page.getByText('The assignment is saved.')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('switch', { name: 'Walkthrough' })).toBeChecked()
  // The header carries the chip a walkthrough assignment is known by everywhere else (LabelChip).
  await expect(page.locator('[data-kind="walkthrough"]')).toHaveText('Walkthrough')

  // Both saves survive a fresh server render of the course, which is where the instructor sees them.
  await page.goto(`/courses/${course.id}?tab=assignments`)
  const savedRow = page.getByRole('row').filter({ hasText: label })
  await expect(savedRow.getByRole('cell').nth(3)).toHaveText('15 min')
  await expect(savedRow.locator('[data-kind="walkthrough"]')).toHaveText('Walkthrough')

  // And the toggle goes back off, which is what makes it a toggle.
  await savedRow.getByRole('link', { name: `Configure ${label}` }).click()
  await page.waitForURL(`**/assignments/${assignment.id}`)
  await page.waitForLoadState('networkidle')
  const back = page.getByRole('switch', { name: 'Walkthrough' })
  await expect(back).toBeChecked()
  await back.click()
  await page.getByRole('button', { name: 'Save configuration' }).click()
  await expect(page.getByText('The assignment is saved.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Walkthrough' })).not.toBeChecked()

  await signOut(page)
})
