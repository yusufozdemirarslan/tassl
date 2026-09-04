// Step 4.3, UI-031 (SYS-005, D-062): the roster is a list of people and three things done to it —
// add someone the institution already knows, take them out again, and, when the address belongs to
// nobody, invite them instead.
//
// The section is this spec's own (14 §2): adding and removing a member is a write, and section A of
// the seeded course is what the rest of the suite reads. The two people are the seeded seats, so
// the roster shows a real name and a real address rather than a fixture's.
import { SUITE_INVITE_PREFIX } from '../fixture-package'
import { expect, signInAs, signOut, test, uniqueEmail, waitForEmail } from '../fixtures'
import { createCourse, createSection, walkthroughOrgId } from './api'

const SEAT_EMAIL = 'student2@tassl.local'
const SEAT_NAME = 'Student Two'
const SECTION_NAME = 'Section R'

test('an instructor adds a seat to a section, removes it, adds it again, and invites an address the institution does not know', async ({
  page,
}) => {
  await signInAs(page, 'instructor')
  const orgId = await walkthroughOrgId(page)
  const course = await createCourse(page, orgId, 'Roster')
  const section = await createSection(page, course.id, SECTION_NAME)

  // The add form is the first thing this spec touches, so the page is given until the network
  // settles: a value typed before React attaches is a value the form never sees.
  await page.goto(`/courses/${course.id}/sections/${section.id}/roster`, {
    waitUntil: 'networkidle',
  })
  await expect(page.getByRole('heading', { level: 1, name: 'Section roster' })).toBeVisible()
  await expect(page.getByText(`${course.name} · ${SECTION_NAME}`)).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 3, name: 'Nobody is in this section yet' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'No invitations yet' })).toBeVisible()

  const email = page.getByLabel('Email address')
  const add = page.getByRole('button', { name: 'Add to section' })
  const memberRow = page.getByRole('row').filter({ hasText: SEAT_EMAIL })
  const addedToast = page.getByText(`${SEAT_EMAIL} is now in this section.`)

  // Added by address: the role the form offers by default is the one most of a roster holds.
  await expect(page.locator('#roster-add-role')).toContainText('Student')
  await email.fill(SEAT_EMAIL)
  await add.click()
  await expect(addedToast).toBeVisible()
  await expect(memberRow).toBeVisible()
  await expect(memberRow.getByRole('cell').nth(0)).toHaveText(SEAT_NAME)
  await expect(memberRow.getByRole('cell').nth(2)).toHaveText('Student')
  // The address is emptied for the next person; the role stays where the instructor left it.
  await expect(email).toHaveValue('')

  // Removed: the person has no runs in the section, so nothing refuses it (MEMBER_HAS_RUNS).
  await memberRow.getByRole('button', { name: `Remove ${SEAT_NAME} from this section` }).click()
  await expect(page.getByText(`${SEAT_NAME} is out of this section.`)).toBeVisible()
  await expect(memberRow).toHaveCount(0)
  await expect(
    page.getByRole('heading', { level: 3, name: 'Nobody is in this section yet' }),
  ).toBeVisible()

  // The same sentence is about to be said again, so the first one is waited out: two identical
  // toasts on screen at once would make the next assertion ambiguous rather than false.
  await expect(addedToast).toHaveCount(0, { timeout: 15_000 })

  // Added again: the membership is upserted, so a person can come back to a section they left.
  await email.fill(SEAT_EMAIL)
  await add.click()
  await expect(addedToast).toBeVisible()
  await expect(memberRow).toBeVisible()
  await expect(memberRow.getByRole('cell').nth(2)).toHaveText('Student')

  // An address the institution does not know: the refusal is under the form, with the way forward
  // beside it rather than in a toast that disappears (D-062).
  const invited = uniqueEmail(SUITE_INVITE_PREFIX)
  await email.fill(invited)
  await add.click()

  const refusal = page.locator('#roster-add').getByRole('alert')
  await expect(refusal).toContainText('That address does not belong to this institution yet.')
  await expect(memberRow).toBeVisible() // the refusal changed nothing about the roster

  const since = Date.now()
  await refusal.getByRole('button', { name: 'Invite to institution' }).click()
  await expect(page.getByText(`An invitation is on its way to ${invited}.`)).toBeVisible()
  // The refusal is gone with the reason for it: the alert region collapses when it holds nothing.
  await expect(refusal).toHaveCount(0)

  // Pending, with its expiry: an invitation lasts seven days and can be accepted once.
  const inviteRow = page
    .locator('#roster-invitations')
    .getByRole('row')
    .filter({ hasText: invited })
  await expect(inviteRow).toBeVisible()
  await expect(inviteRow.getByRole('cell').nth(1)).toHaveText('Student')
  const expiry = inviteRow.getByRole('cell').nth(2).locator('time')
  await expect(expiry).toContainText('UTC')
  const expiresAt = Date.parse((await expiry.getAttribute('datetime')) ?? '')
  const days = (expiresAt - Date.now()) / 86_400_000
  expect(days).toBeGreaterThan(6)
  expect(days).toBeLessThan(8)

  // The invitation is real: the address has the link it was told about (SYS-005).
  const message = await waitForEmail(page, invited, { since })
  expect(message.text).toContain('/invitations/')

  await signOut(page)
})
