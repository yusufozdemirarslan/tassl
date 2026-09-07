// Step 1 of the walkthrough (PRD §12): **the instructor picks the package and can see what it is**
// (UI-033's Package tab, FR-180, FR-195, FR-198).
//
// The walkthrough opens with an instructor choosing a confirmed package version for an assignment.
// What makes that a decision rather than a click is being able to read the thing chosen: which
// package and which version the student will meet, and the element-by-element record of what its
// author signed off on. The replay is where a faculty seat reads that about a run in flight, and
// this spec is the assertion that the tab actually carries it.
//
// The run here is one press old — created and nothing else. `getReplay` is gated on the seat and
// not on the run's state, which is what lets an instructor look at the material behind a run
// somebody is in the middle of taking; driving this one to `scored` would cost four minutes and
// prove nothing about the package.
import { seededPackage } from '../fixture-package'
import { expect, seatEmail, signInAs, signOut, test, type Seat } from '../fixtures'
import { addSectionMember, createStudentAssignment, signInAsInstructor } from '../instructor/api'
import { myAssignment, post } from './scored-run'

/** `student1` is fine here: this spec spends one write, not fourteen. */
const STUDENT_SEAT: Seat = 'student1'

test('walkthrough step 1: the faculty seat reads the package behind a run — id, version, and the confirmation record', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Package',
    studentEmail: seatEmail(STUDENT_SEAT),
    variant: 'defective',
  })
  await addSectionMember(request, assignment.section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  await signInAs(page, STUDENT_SEAT)
  const mine = await myAssignment(page.request, assignment.label)
  const { id: runId } = await post<{ id: string }>(
    page.request,
    `/api/v1/assignments/${mine.assignmentId}/runs`,
    {},
    201,
  )
  await signOut(page)

  await signInAs(page, 'instructor')
  await page.goto(`/review/runs/${runId}?tab=package`)

  const seeded = seededPackage()
  const panel = page.locator('#replay-package')
  await expect(
    page.getByRole('heading', { level: 2, name: 'The package this run was drawn from' }),
  ).toBeVisible()

  // The four facts the tab opens with, read off the definition list that holds them: which package
  // by name and by id (an id nobody can read is an id nobody can quote in a bug), which version and
  // that it is a confirmed one — an assignment refuses any other — and which of the two variants
  // this student drew, which FR-183 makes a per-run fact rather than a per-assignment one.
  const facts = panel.locator('dl').first()
  await expect(facts).toContainText(seeded.title)
  await expect(facts).toContainText(seeded.packageId)
  await expect(facts).toContainText(String(seeded.versionNumber))
  await expect(facts).toContainText('Confirmed')
  await expect(facts).toContainText('Defective')

  // The confirmation record itself: the seed confirms every element of the fixture on import, so
  // the by-type summary has a row for each element type the package carries.
  await expect(panel.getByRole('heading', { level: 3, name: 'Confirmation record' })).toBeVisible()
  const summary = panel.getByRole('region', { name: /decisions by element type/i })
  await expect(summary).toBeVisible()
  await expect(summary.getByRole('row').filter({ hasText: 'Claim' }).first()).toBeVisible()
  await expect(summary.getByRole('row').filter({ hasText: 'Document' }).first()).toBeVisible()

  // And the way out to the version's own screen, which is where the seed record and the export live.
  await expect(panel.getByRole('link', { name: 'Open the package version' })).toHaveAttribute(
    'href',
    `/packages/${seeded.packageId}/versions/${seeded.versionId}`,
  )

  await signOut(page)
})
