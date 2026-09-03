import { axe, expect, test } from '../fixtures'

test.describe('error pages (UI-007)', () => {
  test('an unknown address renders the not-found page with a link home', async ({ page }) => {
    const response = await page.goto('/does-not-exist')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/')
    await axe(page)
  })

  test('the app shell renders the home empty state with a working skip link', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
    await expect(page.getByText('Nothing to do yet')).toBeVisible()

    // WebKit does not put links in the Tab order by default, so focus the link directly: it must
    // be the first anchor in the document, become visible when focused, and jump to main.
    const skip = page.getByRole('link', { name: 'Skip to main content' })
    expect(await page.locator('a').first().getAttribute('href')).toBe('#main')
    await skip.focus()
    await expect(skip).toBeFocused()
    await expect(skip).toBeVisible()
    await skip.press('Enter')
    await expect(page).toHaveURL(/#main$/)
    await axe(page)
  })
})
