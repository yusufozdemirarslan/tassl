// Step 3.4, UI-004 (SYS-002): ask for a reset link, spend it, and prove the change took — the old
// password is refused and the new one signs in.
//
// The account is created by the spec rather than borrowed from the seats: a reset revokes every
// session of the account it touches (`revokeSessionsOnPasswordReset`), which a seat account shared
// with the rest of the suite must not have done to it.
import {
  TEST_PASSWORD,
  axe,
  createVerifiedAccount,
  expect,
  signOut,
  test,
  uniqueEmail,
  waitForEmailLink,
} from '../fixtures'

const NEW_PASSWORD = 'Walkthrough-Reset-2026' // gitleaks:allow

test('a reset link sets a new password and retires the old one', async ({ page }) => {
  const email = uniqueEmail('reset')
  await createVerifiedAccount(page, { name: 'Robin Adeyemi', email, password: TEST_PASSWORD })
  await signOut(page)

  // UI-004, request half. The answer is the same sentence whether or not the address has an
  // account (08 §2.3), so the screen is what is asserted, not a claim about this address.
  await page.goto('/sign-in')
  const sentAfter = Date.now()
  await page.getByRole('link', { name: 'Forgot your password?' }).click()
  await expect(page).toHaveURL(/\/forgot-password$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeVisible()
  await axe(page)

  await page.getByLabel('Email address').fill(email)
  await page.getByRole('button', { name: 'Email me a link' }).click()
  await expect(
    page.getByText('If that address exists, we sent a link. It works for one hour.'),
  ).toBeVisible()
  await axe(page)

  // UI-004, reset half. Better Auth checks the token on its own route and redirects here with it.
  const link = await waitForEmailLink(page, email, { since: sentAfter })
  await page.goto(link)
  await expect(page).toHaveURL(/\/reset-password\?token=/)
  await expect(page.getByRole('heading', { level: 1, name: 'Choose a new password' })).toBeVisible()
  await axe(page)

  // The two fields must agree before the form will submit anything.
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel('New password again').fill(`${NEW_PASSWORD}-typo`)
  await page.getByRole('button', { name: 'Save the new password' }).click()
  await expect(page.getByText('Both passwords must be the same.')).toBeVisible()

  await page.getByLabel('New password again').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Save the new password' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Password changed' })).toBeVisible()
  await axe(page)

  await page.getByRole('link', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/sign-in$/)

  // The old password is now nobody's: the refusal never says which half was wrong.
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(
    page.getByText('That email address and password do not match an account.'),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/sign-in$/)

  // The new one is.
  await page.getByLabel('Password').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/home$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()

  await signOut(page)
})
