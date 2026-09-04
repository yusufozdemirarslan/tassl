// NFR-012: the instructor screens of Phase 4 — the courses list, the four sub-views of one course,
// a section roster, and an assignment's configuration — carry no WCAG 2.1 A/AA violation.
//
// Every screen is scanned with something in it rather than empty: an empty table has no header
// cells to associate, no controls to name, and no rows to read, so a scan of one proves very little
// about the screen a class actually meets. The rows are this spec's own (14 §2) and
// `tests/e2e/global-setup.ts` takes them out at the end of the run.
import { FIXTURE_VARIANT_IDS, FIXTURE_VERSION_ID, suiteName } from '../fixture-package'
import { axe, expect, signInAs, signOut, test } from '../fixtures'
import {
  addSectionMember,
  createAssignment,
  createCourse,
  createSection,
  walkthroughOrgId,
} from '../instructor/api'

const SECTION_NAME = 'Section X'

test('the Phase 4 instructor screens have no axe violations', async ({ page }) => {
  await signInAs(page, 'instructor')

  const orgId = await walkthroughOrgId(page)
  const course = await createCourse(page, orgId, 'Axe')
  const section = await createSection(page, course.id, SECTION_NAME)
  await addSectionMember(page, section.id, { email: 'student2@tassl.local', role: 'student' })
  const label = suiteName('Decision Run')
  const assignment = await createAssignment(page, section.id, {
    label,
    packageVersionId: FIXTURE_VERSION_ID,
    variantId: FIXTURE_VARIANT_IDS.defective,
  })

  // UI-030, the list.
  await page.goto('/courses')
  await expect(page.getByRole('heading', { level: 1, name: 'Courses' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: course.name })).toBeVisible()
  await axe(page)

  // UI-030, the detail: four sub-views, each its own address.
  await page.goto(`/courses/${course.id}?tab=sections`)
  await expect(page.getByRole('heading', { level: 1, name: course.name })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: SECTION_NAME })).toBeVisible()
  await axe(page)

  await page.goto(`/courses/${course.id}?tab=assignments`)
  await expect(page.getByRole('heading', { level: 2, name: 'Assignments' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: label })).toBeVisible()
  await axe(page)

  await page.goto(`/courses/${course.id}?tab=policy`)
  await expect(page.getByRole('heading', { level: 2, name: 'Policy and weight' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Declared' })).toBeVisible()
  await axe(page)

  await page.goto(`/courses/${course.id}?tab=mapping`)
  await expect(
    page.getByRole('heading', { level: 2, name: 'Band-to-points mapping' }),
  ).toBeVisible()
  await expect(page.getByLabel('Professional')).toBeVisible()
  await axe(page)

  // UI-031, with a person on the roster and the add form under it.
  await page.goto(`/courses/${course.id}/sections/${section.id}/roster`)
  await expect(page.getByRole('heading', { level: 1, name: 'Section roster' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'student2@tassl.local' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Add member' })).toBeVisible()
  await axe(page)

  // UI-032, the configuration form and the runs panel it sits above.
  await page.goto(`/assignments/${assignment.id}`)
  await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Configuration' })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Walkthrough' })).toBeVisible()
  await axe(page)

  await signOut(page)
})
