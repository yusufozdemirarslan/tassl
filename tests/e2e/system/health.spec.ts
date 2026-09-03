import { axe, expect, test } from '../fixtures'

test.describe('system', () => {
  test('landing renders and has no axe violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tassl')
    await expect(page.getByText('Make the call.')).toBeVisible()
    await axe(page)
  })

  test('health answers 200 with a request id', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok' })
    expect(res.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})
