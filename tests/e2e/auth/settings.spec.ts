// Step 3.5, UI-010 (SYS-003, SYS-004): the three account settings sections do what they say.
//
// The two tests split by what they cost the rest of the suite. A seat account can have its name
// changed and put back (and can open the deletion dialog as far as the dialog goes), so student1
// proves the profile form and the confirmation guard. Everything that cannot be undone — changing
// a password, which revokes every other session of that account; spending the two-an-hour export
// budget; deleting the account — runs against an account this spec creates.
import {
  TEST_PASSWORD,
  createVerifiedAccount,
  expect,
  signInAs,
  signOut,
  test,
  uniqueEmail,
} from '../fixtures'

const SEAT_NAME = 'Student One'
const RENAMED = 'Student One (renamed by the e2e)'
const NEW_PASSWORD = 'Walkthrough-Settings-2026' // gitleaks:allow

test('a seat renames itself, and the deletion dialog will not act until the address is typed', async ({
  page,
}) => {
  await signInAs(page, 'student1')

  try {
    await page.goto('/settings')
    const name = page.getByLabel('Your name')
    await expect(name).toHaveValue(SEAT_NAME)
    // The address is the account's identity and the form says so rather than pretending otherwise.
    await expect(page.getByLabel('Email address')).toBeDisabled()

    await name.fill(RENAMED)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Your name is saved.')).toBeVisible()

    // Saved, not just echoed: the value survives a fresh render, and the shell reads it too.
    await page.reload()
    await expect(page.getByLabel('Your name')).toHaveValue(RENAMED)
    await expect(page.getByRole('button', { name: `Account: ${RENAMED}` })).toBeVisible()
  } finally {
    // The seat is shared with the rest of the suite, so its name goes back whatever happened above.
    const restored = await page.request.patch('/api/v1/me', {
      data: { name: SEAT_NAME },
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'tassl' },
    })
    expect(restored.status(), await restored.text()).toBe(200)
  }

  // UI-010 Data: the dialog states what deletion does and then asks for the address in full.
  await page.goto('/settings/data')
  await page.getByRole('button', { name: 'Delete my account' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByText('Delete your account?')).toBeVisible()

  const confirm = dialog.getByRole('button', { name: 'Delete my account' })
  await expect(confirm).toBeDisabled()

  const typed = dialog.getByRole('textbox')
  await typed.fill('student1@tassl.loca')
  await expect(confirm).toBeDisabled()
  await typed.fill('student2@tassl.local')
  await expect(confirm).toBeDisabled()
  await typed.fill('student1@tassl.local')
  await expect(confirm).toBeEnabled()

  // Cancelling leaves the account exactly where it was.
  await dialog.getByRole('button', { name: 'Keep my account' }).click()
  await expect(dialog).toBeHidden()
  await page.goto('/home')
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()

  await signOut(page)
})

test('an account changes its password, downloads its data twice, and deletes itself', async ({
  page,
}) => {
  const email = uniqueEmail('settings')
  await createVerifiedAccount(page, { name: 'Devon Marsh', email, password: TEST_PASSWORD })

  // UI-010 Security. The panel warns before the fact that other devices are signed out (08 §2.8).
  // WebKit drops a value typed into a password field before React attaches, so the form is filled
  // only once the page has settled (the same race a person would meet in the first moments).
  await page.goto('/settings/security', { waitUntil: 'networkidle' })
  await expect(
    page.getByText('Choosing a new password signs out every other device straight away.'),
  ).toBeVisible()

  const newPassword = page.getByLabel('New password', { exact: true })
  await page.getByLabel('Current password').fill(`${TEST_PASSWORD}-wrong`)
  await newPassword.fill(NEW_PASSWORD)
  await page.getByLabel('New password again').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('That is not your current password.')).toBeVisible()

  await page.getByLabel('Current password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(
    page.getByText('Your password is changed. Other devices are signed out.'),
  ).toBeVisible()
  // The session that made the change is the one that survives, so the page still belongs to it.
  await expect(page.getByText('This device')).toBeVisible()

  // UI-010 Data → the export. Two an hour (08 §2.9), so the third is refused with the sentence
  // from the envelope rather than a generic failure.
  // The panel hands the body to the browser as a blob, which is gone by the time a Playwright
  // response object could be read, so the exchange is copied out in a route handler and passed
  // through untouched.
  const answers: { status: number; disposition: string | undefined; body: string }[] = []
  await page.route('**/api/v1/me/export', async (route) => {
    const response = await route.fetch()
    answers.push({
      status: response.status(),
      disposition: response.headers()['content-disposition'],
      body: await response.text(),
    })
    await route.fulfill({ response })
  })

  // A successful change refreshes this route so the device list loses the sessions it revoked, and
  // that fetch is still in flight when the sentence above appears. Firefox cancels a document load
  // that starts while one is outstanding (NS_BINDING_ABORTED), so the refresh is waited out first.
  await page.waitForLoadState('networkidle')
  await page.goto('/settings/data')
  const download = page.getByRole('button', { name: 'Download my data' })

  await download.click()
  await expect.poll(() => answers.length).toBe(1)
  expect(answers[0]?.status).toBe(200)
  expect(answers[0]?.disposition).toContain('attachment')
  const body = JSON.parse(answers[0]?.body ?? '{}') as {
    exportedAt: string
    profile: { email: string; name: string; emailVerified: boolean }
    memberships: unknown[]
  }
  expect(body.profile).toMatchObject({ email, name: 'Devon Marsh', emailVerified: true })
  expect(body.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  expect(body.memberships).toEqual([])
  await expect(page.getByText('Your file is downloading.')).toBeVisible()

  await download.click()
  await expect.poll(() => answers.length).toBe(2)
  expect(answers[1]?.status).toBe(200)

  await download.click()
  await expect.poll(() => answers.length).toBe(3)
  expect(answers[2]?.status).toBe(429)
  expect(JSON.parse(answers[2]?.body ?? '{}')).toMatchObject({
    error: { code: 'EXPORT_RATE_LIMITED' },
  })
  await expect(
    page.getByText('You can download your data twice an hour. Try again shortly.'),
  ).toBeVisible()
  await page.unroute('**/api/v1/me/export')

  // UI-010 Data → deletion. The typed address matches, so the account closes and the session ends.
  await page.getByRole('button', { name: 'Delete my account' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('textbox').fill(email)
  await dialog.getByRole('button', { name: 'Delete my account' }).click()

  await page.waitForURL(/\/sign-in/)
  // The sign-out behind the deletion is still settling here: a navigation started on top of it is
  // replaced by the client's own, which lands on a bare /sign-in and would read as a proxy that
  // forgot where the visitor was going. The redirect only means anything once the page is idle.
  await page.waitForLoadState('networkidle')
  await page.goto('/home')
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fhome$/)
})
