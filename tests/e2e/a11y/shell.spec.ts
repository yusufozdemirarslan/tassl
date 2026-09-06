// NFR-012: the signed-in shell (UI-008) and the screens it frames — home, the three account
// settings sections, and the notifications list — carry no WCAG 2.1 A/AA violation.
// student1 is read here, never written: the seat's own data is what makes the shell real (a
// membership in the switcher, a rail derived from the student role).
import { axe, expect, signInAs, signOut, test } from '../fixtures'

test('the signed-in shell and its screens have no axe violations', async ({ page }) => {
  await signInAs(page, 'student1')

  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
  await axe(page)

  await page.goto('/settings')
  await expect(page.getByRole('heading', { level: 1, name: 'Account settings' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Profile' })).toBeVisible()
  await axe(page)

  await page.goto('/settings/security')
  await expect(page.getByRole('heading', { level: 2, name: 'Password' })).toBeVisible()
  // The device list is fetched in the browser; axe reads the loaded list, not the loading line.
  await expect(page.getByText('This device')).toBeVisible()
  await axe(page)

  await page.goto('/settings/data')
  await expect(page.getByRole('heading', { level: 2, name: 'Download my data' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Delete account' })).toBeVisible()
  await axe(page)

  await page.goto('/notifications')
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
  // Either face of the page is correct, and which one this seat gets is not this spec's business:
  // Step 10.4 sends a `run_scored` notification, and the walkthrough scores a run, so whether the
  // list is empty depends on what else has run. What an accessibility spec is here to prove is
  // that the page renders something axe can read — so it asserts one of the two, and scans it.
  const empty = page.getByRole('heading', { level: 3, name: 'Nothing yet' })
  const rows = page.getByRole('listitem')
  await expect(async () => {
    expect((await empty.count()) + (await rows.count())).toBeGreaterThan(0)
  }).toPass()
  await axe(page)

  await signOut(page)
})
