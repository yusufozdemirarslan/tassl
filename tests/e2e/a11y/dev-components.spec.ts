import { axe, expect, test } from '../fixtures'

// UI-060: the gallery is the accessibility review surface for every component (NFR-006).
test('the component gallery has no axe violations', async ({ page }) => {
  await page.goto('/dev/components')
  await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'UI primitives' })).toBeVisible()
  await axe(page)
})
