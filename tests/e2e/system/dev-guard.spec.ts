import { expect, test } from '../fixtures'

// playwright.config.ts starts the server with APP_ENV=test, so the dev routes must answer here;
// the preview/production 404 is covered by tests/unit/app/dev-layout.test.tsx.
test('the component gallery renders under APP_ENV=test', async ({ page }) => {
  const response = await page.goto('/dev/components')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible()
  await expect(page.getByText('Illustrative sample data')).toBeVisible()
})
