// Smoke, the screens half: the home page loads, both demo seats sign in, and one screen per persona
// renders with its own heading. Read-only against the deployment PLAYWRIGHT_BASE_URL names.
import { expect, test, walkPagesTo } from '../fixtures'

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
    await walkPagesTo(
      page,
      page.getByText('Marketing Strategy Walkthrough').first(),
      'Show more courses',
      'Courses',
    )
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
    // The seeded assignments are the oldest of the seat, so they are the last rows of the last
    // page: on the suite's own database the three of them fall off page 1 once other specs have
    // enrolled this seat in a hundred assignments of their own.
    await walkPagesTo(
      page,
      page.getByRole('row').filter({ hasText: 'Decision Run 1 (walkthrough)' }).first(),
      'Show more assignments',
      'Runs',
    )
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
