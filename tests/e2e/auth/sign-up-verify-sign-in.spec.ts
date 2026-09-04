// Step 3.4's walk through UI-001 to UI-003 (SYS-001, SYS-002): create an account, confirm the
// address with the link the console transport wrote, arrive signed in, sign out, and come back.
// Every screen the person passes through is checked with axe on the way (NFR-012).
//
// The account is created by the spec (a fresh address per run) and left signed out, so the seed
// seats and the walkthrough institution are untouched by it.
import { TEST_PASSWORD, axe, expect, test, uniqueEmail, waitForEmailLink } from '../fixtures'

const NAME = 'Casey Rivera'

test('sign up, confirm the emailed link, land on home, then sign out and sign in again', async ({
  page,
}) => {
  const email = uniqueEmail('signup')

  // UI-001 → UI-002: the sign-in screen offers the way to an account that does not exist yet.
  await page.goto('/sign-in')
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Tassl' })).toBeVisible()
  await axe(page)
  await page.getByRole('link', { name: 'Create an account' }).click()

  await expect(page).toHaveURL(/\/sign-up$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Create your Tassl account' }),
  ).toBeVisible()
  await axe(page)

  const sentAfter = Date.now()
  await page.getByLabel('Your name').fill(NAME)
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()

  // UI-003 "sent": the address is on the screen, and nothing claims the account is usable yet.
  await page.waitForURL(/\/verify-email\?sent=1/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Confirm your email address' }),
  ).toBeVisible()
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resend the link' })).toBeVisible()
  await axe(page)

  // The link the person would click in their inbox, read from the console transport's copy.
  const link = await waitForEmailLink(page, email, { since: sentAfter })
  expect(link).toContain('/api/auth/verify-email?token=')

  await page.goto(link)

  // Better Auth signs the account in as it verifies (autoSignInAfterVerification), so the screen
  // only has to offer the way onward.
  await page.waitForURL(/\/verify-email\?verified=1/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Email address confirmed' }),
  ).toBeVisible()
  await axe(page)

  await page.getByRole('link', { name: 'Continue to Tassl' }).click()
  await page.waitForURL(/\/home$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
  // A brand-new account belongs to no institution yet, and the shell says so rather than pretending.
  await expect(
    page.getByRole('heading', { level: 3, name: 'Waiting for an invitation' }),
  ).toBeVisible()
  await axe(page)

  // UI-008: signing out from the account menu revokes the session and lands on /sign-in.
  await page.getByRole('button', { name: `Account: ${NAME}` }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.waitForURL(/\/sign-in/)
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Tassl' })).toBeVisible()

  // The session is gone, not just the page: /home is no longer reachable.
  await page.goto('/home')
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fhome$/)

  // UI-001 for real: the same credentials, typed into the form.
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  // `next` was carried through the redirect, so the second sign-in lands where the visit was aimed.
  await page.waitForURL(/\/home$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
  await expect(page.getByRole('button', { name: `Account: ${NAME}` })).toBeVisible()

  // The account this spec created ends the run signed out.
  await page.getByRole('button', { name: `Account: ${NAME}` }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.waitForURL(/\/sign-in/)
})
