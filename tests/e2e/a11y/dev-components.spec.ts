import { axe, expect, test } from '../fixtures'

// UI-060: the gallery is the accessibility review surface for every component (NFR-006).
test('the component gallery has no axe violations', async ({ page }) => {
  await page.goto('/dev/components')
  await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'UI primitives' })).toBeVisible()
  await axe(page)
})

// The narrowest supported viewport (16 §3): nothing may widen the document, so the nowrap tables
// scroll inside their own containers, and the page still passes axe at that width.
test('the component gallery fits a 360 px viewport without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto('/dev/components')
  await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'UI primitives' })).toBeVisible()

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360)
  await axe(page)
})
