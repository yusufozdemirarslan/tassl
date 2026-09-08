// NFR-012: the seven public screens of UI-001 to UI-004 and UI-006 carry no WCAG 2.1 A/AA
// violation. Each is visited in the state a signed-out visitor reaches by typing the address: the
// two screens that also have a token state (verification, reset) are checked with their token in
// the flow specs, tests/e2e/auth/*.
//
// The legal pages are here rather than in a suite of their own because that is what they are: two
// documents a person reads before they have an account, on the same public shell as the four
// screens above them (UI-006).
import { axe, expect, test } from '../fixtures'

const PUBLIC_SCREENS = [
  { path: '/sign-in', heading: 'Sign in to Tassl' },
  { path: '/sign-up', heading: 'Create your Tassl account' },
  { path: '/verify-email', heading: 'Confirm your email address' },
  { path: '/forgot-password', heading: 'Reset your password' },
  // Without a token there is nothing to spend, so this is the screen's refusal state.
  { path: '/reset-password', heading: 'That reset link no longer works' },
  { path: '/privacy', heading: 'Privacy' },
  { path: '/terms', heading: 'Terms' },
] as const

for (const { path, heading } of PUBLIC_SCREENS) {
  test(`${path} has no axe violations`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await axe(page)
  })
}
