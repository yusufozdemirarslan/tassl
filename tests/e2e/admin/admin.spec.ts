// Step 13.5, UI-050 (SYS-006, D-016): the platform screens, and the door they are behind.
//
// The account whose role changes is this spec's own (14 §2). A platform role change revokes every
// session the person holds, so doing it to a seeded seat would sign that seat out from under
// whatever other spec is using it — and the seeded editor's `tassl_scenario_editor` role is what
// the authoring specs stand on.
//
// Two things are proven here that no unit test can reach: the confirmation dialog says out loud
// that the person is signed out, and a student who types the address gets the not-found page rather
// than a refusal that tells them the address is real.
import type { Page } from '@playwright/test'
import {
  createVerifiedAccount,
  expect,
  signIn,
  signInAs,
  signOut,
  test,
  TEST_PASSWORD,
  uniqueEmail,
  waitForEmailLink,
} from '../fixtures'

const INSTITUTION = 'Walkthrough University'

test('an admin sets a platform role, the audit log shows it, and a student cannot see the screen', async ({
  page,
}) => {
  const email = uniqueEmail('admin-role')

  // The account this spec will promote. Created signed-out, then the browser signs in as the admin.
  await createVerifiedAccount(page, { name: 'Role Subject', email, password: TEST_PASSWORD })
  await signOut(page)

  await signInAs(page, 'admin')

  // The rail offers the destination to a platform admin.
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible()

  await page.goto('/admin/users', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible()

  // Search, so the row this spec cares about is the only one on the screen.
  await page.getByLabel('Search by email address').fill(email)
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(email).replace('.', '\\.')}`))
  await expect(page.getByRole('rowheader', { name: /Role Subject/ })).toBeVisible()

  // The role control names the person it belongs to, so a dense table stays unambiguous.
  const role = page.getByRole('combobox', { name: 'Platform role for Role Subject' })
  // `toContainText`, not `toHaveText`: the trigger holds the value and the chevron, and WebKit and
  // Firefox both render the icon into the element's text.
  await expect(role).toContainText('None')
  await role.click()
  await page.getByRole('option', { name: 'Scenario editor' }).click()

  // The dialog says the consequence before it is accepted.
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('signs them out of every device')
  await dialog.getByRole('button', { name: 'Change the role' }).click()

  await expect(dialog).toBeHidden()
  await expect(role).toContainText('Scenario editor')

  // The audit log is the record of it, and the row names the act, the target and a request id.
  await page.goto('/admin/audit', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible()
  const auditRow = page.getByRole('row').filter({ hasText: 'role.set' }).first()
  await expect(auditRow).toBeVisible()
  await expect(auditRow).toContainText('user ')

  // The flags screen says what this deployment is actually running with.
  await page.goto('/admin/flags', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1, name: 'Flags' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'FEATURE_AI' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Effective model provider' })).toBeVisible()
  await expect(page.getByText('mock', { exact: true })).toBeVisible()

  await signOut(page)

  // A student gets the not-found page: a resource you may not see does not exist (08 §5).
  await signInAs(page, 'student1')
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0)
  await page.goto('/admin/users', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible()
  // The not-found page, not a refusal: nothing on it says the address exists.
  await expect(page.getByText('There is nothing at this address.')).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
})

/** Opens the users screen filtered to one address, as the signed-in admin. */
async function openUserRow(page: Page, email: string, name: string): Promise<void> {
  await page.goto(`/admin/users?q=${encodeURIComponent(email)}`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: new RegExp(name) })).toBeVisible()
}

/** Chooses a seat in the row's institution-role select and confirms it. */
async function setInstitutionRole(page: Page, name: string, from: string, to: string) {
  const seat = page.getByRole('combobox', {
    name: `Institution role for ${name} at ${INSTITUTION}`,
  })
  await expect(seat).toContainText(from)
  await seat.click()
  // Student and Instructor are two separate choices, and they are the only two offered.
  await expect(page.getByRole('option')).toHaveText(['Student', 'Instructor'])
  await page.getByRole('option', { name: to, exact: true }).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Change this institution role?')
  await expect(dialog).toContainText('signs them out of every device')
  await dialog.getByRole('button', { name: 'Change the role' }).click()
  await expect(dialog).toBeHidden()
  await expect(seat).toContainText(to)
}

// D-747. Student and Instructor are institution seats, and the users table offered only the platform
// role, so an admin could not give either. The account is this spec's own: an instructor invites it
// into the walkthrough institution as a teaching assistant, the admin makes it a Student and then an
// Instructor, and each change is proven where it lands — on the home screen the person sees the next
// time they sign in. Closing the account at the end removes the membership, so the institution is
// left with the seats it was seeded with.
test('an admin makes a member a Student, then an Instructor, and each takes effect at the next sign-in', async ({
  page,
}) => {
  const email = uniqueEmail('admin-seat')
  const name = 'Seat Subject'
  const sentAfter = Date.now()

  await signInAs(page, 'instructor')
  const me = (await (await page.request.get('/api/v1/me')).json()) as {
    memberships: { organizationId: string; name: string }[]
  }
  const institution = me.memberships.find((membership) => membership.name === INSTITUTION)
  expect(institution).toBeDefined()
  const invited = await page.request.post(
    `/api/v1/institutions/${institution?.organizationId}/invitations`,
    {
      data: { email, role: 'teaching_assistant' },
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'tassl' },
    },
  )
  expect(invited.status(), await invited.text()).toBe(201)
  const link = await waitForEmailLink(page, email, { since: sentAfter })
  await signOut(page)

  await createVerifiedAccount(page, { name, email, password: TEST_PASSWORD })
  try {
    await page.goto(link)
    await page.getByRole('button', { name: 'Accept the invitation' }).click()
    await page.waitForURL(/\/home$/)
    await signOut(page)

    // Student.
    await signInAs(page, 'admin')
    await openUserRow(page, email, name)
    await setInstitutionRole(page, name, 'Teaching assistant', 'Student')
    await signOut(page)

    await signIn(page, email, TEST_PASSWORD)
    await expect(page.getByRole('heading', { level: 2, name: 'Your runs' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Runs', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Courses' })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 2, name: 'Packages' })).toHaveCount(0)
    await signOut(page)

    // Instructor.
    await signInAs(page, 'admin')
    await openUserRow(page, email, name)
    await setInstitutionRole(page, name, 'Student', 'Instructor')

    // The audit log records it against the institution.
    await page.goto('/admin/audit', { waitUntil: 'networkidle' })
    await expect(page.getByRole('row').filter({ hasText: 'role.set' }).first()).toBeVisible()
    await signOut(page)

    await signIn(page, email, TEST_PASSWORD)
    await expect(page.getByRole('heading', { level: 2, name: 'Courses' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Packages' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Courses', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Your runs' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Runs', exact: true })).toHaveCount(0)
  } finally {
    await page.context().clearCookies()
    await signIn(page, email, TEST_PASSWORD)
    const deleted = await page.request.delete('/api/v1/me', {
      headers: { 'X-Requested-With': 'tassl' },
    })
    expect(deleted.status()).toBe(204)
    await page.context().clearCookies()
  }
})
