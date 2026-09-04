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
  // The invitations panel is the institution's, not this section's, and every browser project runs
  // this spec against the same seeded institution — so "no invitations yet" is not a state this
  // spec owns, and the row it creates below is what it may assert. The empty case is covered where
  // it is deterministic: tests/unit/components/roster/section-roster.test.tsx.
  await expect(page.getByRole('heading', { level: 2, name: 'Invitations' })).toBeVisible()

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
  // Unseating someone is destructive, so the row's button opens a confirmation that names the
  // person, their address and the section; the removal happens on the dialog's own destructive
  // action, and pressing Remove alone changes nothing.
  await memberRow.getByRole('button', { name: `Remove ${SEAT_NAME} from this section` }).click()
  const removeConfirm = page.getByRole('alertdialog')
  await expect(removeConfirm).toContainText('Take this person off the roster?')
  await expect(removeConfirm).toContainText(SEAT_EMAIL)
  await expect(removeConfirm).toContainText(SECTION_NAME)

  // Cancelling leaves the roster exactly as it was: the question is a real one, and while it is on
  // screen the page behind it is inert, so the row can only be checked once the dialog is gone.
  await removeConfirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(removeConfirm).toHaveCount(0)
  await expect(memberRow).toBeVisible()

  await memberRow.getByRole('button', { name: `Remove ${SEAT_NAME} from this section` }).click()
  await removeConfirm.getByRole('button', { name: 'Remove from section' }).click()
  await expect(page.getByText(`${SEAT_NAME} is out of this section.`)).toBeVisible()
  await expect(removeConfirm).toHaveCount(0)
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
  // Institution mail is not sent by a single press: the action opens a form carrying the address
  // the add form could not place, and the invitation goes out when that form is submitted.
  await refusal.getByRole('button', { name: 'Invite to institution' }).click()
  const inviteDialog = page.getByRole('dialog')
  await expect(inviteDialog).toContainText('Invite to the institution')
  await expect(inviteDialog.getByLabel('Email address')).toHaveValue(invited)
  await inviteDialog.getByRole('button', { name: 'Send invitation' }).click()
  await expect(page.getByText(`An invitation is on its way to ${invited}.`)).toBeVisible()
  await expect(inviteDialog).toHaveCount(0)
  // The refusal is gone with the reason for it: the alert region collapses when it holds nothing.
  await expect(refusal).toHaveCount(0)

  // Pending, with its expiry: an invitation lasts seven days and can be accepted once.
  const inviteRow = page
    .locator('#roster-invitations')
    .getByRole('row')
    .filter({ hasText: invited })
  await expect(inviteRow).toBeVisible()
  await expect(inviteRow.getByRole('cell').nth(1)).toHaveText('Student')
  // Address, seat, standing, expiry: an invitation that has not been accepted and has not run out
  // is pending, and the row says which of the two it is rather than leaving the date to be read.
  await expect(inviteRow.getByRole('cell').nth(2)).toContainText('Pending')
  const expiry = inviteRow.getByRole('cell').nth(3).locator('time')
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
