// Smoke, the screens half: the home page loads, both demo seats sign in, and one screen per persona
// renders with its own heading. Read-only against the deployment PLAYWRIGHT_BASE_URL names.
import { expect, test } from '../fixtures'

test.describe('@smoke screens', () => {
  test('@smoke the sign-in page renders with its form and the security headers', async ({
    page,
  }) => {
    const response = await page.goto('/sign-in')
    expect(response?.status()).toBe(200)
    const headers = response?.headers() ?? {}
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['content-security-policy']).toMatch(/^default-src 'self'/)
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Tassl' })).toBeVisible()
    await expect(page.getByLabel('Email address')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test('@smoke the instructor signs in and opens Courses and Review', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel('Email address').fill('instructor@tassl.local')
    await page.getByLabel('Password').fill(process.env.SEED_PASSWORD ?? 'Walkthrough-Pass-2026')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
    await page.getByRole('link', { name: 'Courses', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Courses' })).toBeVisible()
    // The seeded course is on the first page of a fresh database (production); on a database the
    // local suites have added courses to it sits behind "Show more", so the pages are walked, which
    // proves the list and its paging together rather than assuming the page it is on.
    const seeded = page.getByText('Marketing Strategy Walkthrough').first()
    for (let pageIndex = 0; pageIndex < 30 && !(await seeded.isVisible()); pageIndex += 1) {
      const more = page.getByRole('link', { name: 'Show more courses' })
      await expect(more).toBeVisible()
      // The next page is a navigation with a new cursor; the walk waits for it, because the old
      // page keeps its heading and its link until the new one lands and a second press on the same
      // link only asks for the same page again.
      const cursorBefore = new URL(page.url()).searchParams.get('cursor')
      await more.click()
      await page.waitForURL((url) => url.searchParams.get('cursor') !== cursorBefore)
      await expect(page.getByRole('heading', { level: 1, name: 'Courses' })).toBeVisible()
    }
    await expect(seeded).toBeVisible()
    await page.getByRole('link', { name: 'Review', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Review' })).toBeVisible()
  })

  test('@smoke the student signs in and opens Runs', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel('Email address').fill('student1@tassl.local')
    await page.getByLabel('Password').fill(process.env.SEED_PASSWORD ?? 'Walkthrough-Pass-2026')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
    await page.getByRole('link', { name: 'Runs', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
    await expect(page.getByText('Decision Run 1 (walkthrough)').first()).toBeVisible()
  })

  test('@smoke the admin sees the assistant mode the deployment runs with', async ({
    page,
    request,
  }) => {
    await page.goto('/sign-in')
    await page.getByLabel('Email address').fill('admin@tassl.local')
    await page.getByLabel('Password').fill(process.env.SEED_PASSWORD ?? 'Walkthrough-Pass-2026')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
    await page.goto('/admin/flags')
    await expect(page.getByRole('heading', { level: 1, name: 'Flags' })).toBeVisible()
    const ready = (await (await request.get('/api/ready')).json()) as { assistantMode: string }
    const label = ready.assistantMode === 'live' ? 'Live model' : 'Scripted assistant'
    // The screen and the probe agree on the mode the next assistant request will get.
    await expect(page.getByText(label).first()).toBeVisible()
  })
})
