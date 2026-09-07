// NFR-012: the instructor screens of Phase 4 — the courses list, the four sub-views of one course,
// a section roster, and an assignment's configuration — carry no WCAG 2.1 A/AA violation.
//
// Every screen is scanned with something in it rather than empty: an empty table has no header
// cells to associate, no controls to name, and no rows to read, so a scan of one proves very little
// about the screen a class actually meets. The rows are this spec's own (14 §2) and
// `tests/e2e/global-setup.ts` takes them out at the end of the run.
import { seededPackage, suiteName } from '../fixture-package'
import { axe, expect, seatEmail, signInAs, signOut, test, type Seat } from '../fixtures'
import {
  addSectionMember,
  createAssignment,
  createCourse,
  createSection,
  createStudentAssignment,
  signInAsInstructor,
  walkthroughOrgId,
} from '../instructor/api'
import { driveRunToScored, post, readJson } from '../walkthrough/scored-run'

const SECTION_NAME = 'Section X'

test('the Phase 4 instructor screens have no axe violations', async ({ page }) => {
  // Eight full-page axe scans, and the four fixture writes in front of them share one seat's
  // D-026 budget with every other instructor spec in the lane — `../instructor/api.ts` waits a
  // refusal out rather than failing on it, and the wait has to fit inside the test (D-188).
  test.setTimeout(300_000)

  await signInAs(page, 'instructor')

  const orgId = await walkthroughOrgId(page)
  const course = await createCourse(page, orgId, 'Axe')
  const section = await createSection(page, course.id, SECTION_NAME)
  await addSectionMember(page, section.id, { email: 'student2@tassl.local', role: 'student' })
  // The instructor takes a row on the section as well as owning the course. It is the real
  // arrangement — every review lane in this suite makes it — and it is what UI-035 needs:
  // `listCourseExports` admits a reviewer of the assignment's *section*
  // (`records/service.ts`'s `requireSectionRole`), where `listAssignmentRuns` one screen up also
  // admits the course's own instructor. Without the row the export history is a 404.
  await addSectionMember(page, section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })
  const label = suiteName('Decision Run')
  const assignment = await createAssignment(page, section.id, {
    label,
    packageVersionId: seededPackage().versionId,
    variantId: seededPackage().variantIds.defective,
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

  // And the preview state, which is where the mapping screen grows a table, a checkbox and a second
  // button (UI-030, FR-206). The four fields already hold this course's mapping, so previewing them
  // asks a real question and answers it with an empty affected list — the shape an instructor meets
  // before any run is confirmed.
  await page.getByRole('button', { name: 'Preview changes' }).click()
  await expect(page.getByRole('heading', { name: 'What would change' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(
    page.getByRole('checkbox', { name: 'I understand every confirmed run will be re-exported.' }),
  ).toBeVisible()
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

  // UI-035, the assignment's export history. Scanned with nothing in it on purpose: no run on this
  // fixture is confirmed, and the empty state is the face most assignments wear for most of a term.
  // The filled table is scanned by `../walkthrough/14-export-record.spec.ts`, which has one.
  await page.goto(`/assignments/${assignment.id}/exports`)
  await expect(page.getByRole('heading', { level: 1, name: 'Course exports' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'No export yet' })).toBeVisible()
  await axe(page)

  await signOut(page)
})

// UI-033, in the two states a faculty seat meets it in: `scored`, where the seven decisions are
// open, and `confirmed`, where they are on the record and the points sentence is written.
//
// Both states are scanned, and both matter. The `scored` scan covers the controls — seven radio
// groups, seven note fields, two buttons per dimension, the trace's filter form and its scrolling
// region — and the `confirmed` scan covers what replaces them: the decided bands, the arithmetic,
// the export table, and the dialogs' triggers. A screen that is accessible while empty and
// inaccessible once decided is the usual shape of this defect.
//
// Every tab is scanned rather than the default one. They are five addresses, so a scan of
// `?tab=overview` says nothing about the trace table or the claim object; each is its own document.
//
// The run is driven to `scored` through the documented endpoints (`../walkthrough/scored-run.ts`)
// because there is no other way to reach the state, and on `student2` for the reason that file's
// header gives: the walkthrough seats are spread so that no one of them spends another's D-026
// budget in a burst.
const REPLAY_STUDENT: Seat = 'student2'

const REPLAY_TABS = ['overview', 'bands', 'trace', 'package', 'actions'] as const

test('the faculty replay has no axe violations in `scored` or in `confirmed`', async ({
  page,
  request,
}) => {
  // A full run driven to a scored one, then ten full-page axe scans, is far past Playwright's
  // default patience (D-188). The assertions are unchanged, only the wait.
  test.setTimeout(600_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Axe replay',
    studentEmail: seatEmail(REPLAY_STUDENT),
    variant: 'defective',
  })
  await addSectionMember(request, assignment.section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  await signInAs(page, REPLAY_STUDENT)
  const runId = await driveRunToScored(page.request, assignment.assignment.id)
  await signOut(page)

  await signInAs(page, 'instructor')

  // `scored`: every decision open, nothing on the record.
  for (const tab of REPLAY_TABS) {
    await page.goto(`/review/runs/${runId}?tab=${tab}`)
    await expect(page.getByRole('navigation', { name: 'Replay views' })).toBeVisible()
    await axe(page)
  }

  // The claim object is a sub-view of the package tab and a document of its own.
  await page.goto(`/review/runs/${runId}?tab=package&claim=C3`)
  await expect(page.getByRole('heading', { level: 2, name: 'Claim C3' })).toBeVisible()
  await axe(page)

  // `confirmed`: the seven on the record, the arithmetic written, the export filed.
  await post(request, `/api/v1/review/runs/${runId}/confirm-remaining`)
  const confirmed = await readJson<{ run: { state: string } }>(
    request,
    `/api/v1/review/runs/${runId}`,
  )
  expect(confirmed.run.state).toBe('confirmed')

  for (const tab of REPLAY_TABS) {
    await page.goto(`/review/runs/${runId}?tab=${tab}`)
    await expect(page.getByRole('navigation', { name: 'Replay views' })).toBeVisible()
    await axe(page)
  }

  await signOut(page)
})
