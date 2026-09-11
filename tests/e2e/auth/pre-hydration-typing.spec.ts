// QA-074 / D-738: the sign-in screen is server-rendered and readable well before React has
// hydrated it — on a cold serverless start that window is seconds, and production's own cold
// `/api/ready` was measured at 3.16 s. A person who knows the screen types into it inside that
// window. React Hook Form used to register each field with its empty default, which overwrote what
// they had typed and then refused the form with "Enter a valid email address" for an address they
// had entered correctly.
//
// D-182 saw the same class of thing from the other side and answered it in the lane: the `page`
// every other spec is handed waits for the network to fall quiet after each navigation, so a spec
// never types into a form React has not attached to yet. That wait is what this spec has to do
// without — it is the window that has to be reproduced — so the page here is opened from the
// browser directly, with the suite's own context options, and `waitUntil: 'commit'` returns as soon
// as the document starts arriving. The order below then matters: hydration is waited for *before*
// the values are read back, or the assertion could pass against the DOM a moment before the form
// took the values away.
import { SEED_PASSWORD, expect, seatEmail, test, waitForHydration } from '../fixtures'

test('what is typed into the sign-in form before it hydrates survives and signs in', async ({
  browser,
  contextOptions,
}) => {
  const context = await browser.newContext(contextOptions)
  const page = await context.newPage()

  // The window has to be the same width on every engine or the spec only guards the slowest one:
  // unthrottled, Chromium and Firefox attach in twenty milliseconds and no typing fits in front of
  // them, while WebKit takes ten times that. Holding the client bundle back for a second is what a
  // cold start does to it anyway — the document is served and readable, and the script that will
  // bring it to life is still on its way.
  await context.route('**/_next/static/chunks/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await route.continue()
  })

  await page.goto('/sign-in?next=%2Fhome', { waitUntil: 'commit' })

  // The server HTML carries the inputs; nothing is listening to them yet.
  const email = page.locator('input[name="email"]')
  const password = page.locator('input[name="password"]')
  await email.waitFor({ state: 'attached' })

  await email.fill(seatEmail('student2'))
  await password.fill(SEED_PASSWORD)

  // Hydration lands here. Before the fix it took both values with it.
  await waitForHydration(page, 'input[name="email"]')
  await expect(email).toHaveValue(seatEmail('student2'))
  await expect(password).toHaveValue(SEED_PASSWORD)

  // And the values are the form's, not only the DOM's: submitting uses them. If they had been
  // overwritten this stays on /sign-in with "Enter a valid email address", which is exactly what a
  // person met.
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/home$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()

  await context.close()
})
