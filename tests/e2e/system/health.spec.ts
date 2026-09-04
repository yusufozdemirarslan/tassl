import { axe, expect, test } from '../fixtures'

test.describe('system', () => {
  // Step 3.4 turned `/` into a signpost (09 §1): Tassl has no marketing surface, so the root
  // address is `/home` with a session and `/sign-in` without one, and nothing renders there.
  test('the root address sends a signed-out visitor to sign in', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/sign-in$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Tassl' })).toBeVisible()
    await axe(page)
  })

  test('health answers 200 with a request id', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok' })
    expect(res.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})
