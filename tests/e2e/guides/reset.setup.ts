// The reset stage of the guide chain (playwright.config.ts `guideProjects`, D-707).
//
// Runs before each engine's instructor guide and again before its demo path: takes the previous
// stage's runs off the seeded assignments and its "Guide …" rows out (`resetGuideData`, the same
// purge `globalSetup` runs once), and empties the server's in-memory rate-limit windows through
// the test-only route, so the third engine's student is not refused the data export the first
// engine's student already took twice, and a failed sign-in in one stage does not lock the next.
import { expect, test as setup, SEED_PASSWORD } from './fixtures'
import { resetGuideData, walkthroughOrganizationId } from '../global-setup'

setup('reset the demo seats between guide stages', async ({ request }) => {
  const organizationId = await walkthroughOrganizationId()
  await resetGuideData(organizationId)

  const signedIn = await request.post('/api/auth/sign-in/email', {
    data: { email: 'instructor@tassl.local', password: SEED_PASSWORD },
    headers: { 'content-type': 'application/json' },
  })
  expect(signedIn.ok(), await signedIn.text()).toBe(true)
  const reset = await request.post('/api/v1/test/rate-limits/reset', {
    headers: { 'X-Requested-With': 'tassl' },
  })
  expect(reset.status(), await reset.text()).toBe(200)
})
