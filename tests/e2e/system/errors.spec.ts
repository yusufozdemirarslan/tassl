import { axe, expect, signInAs, signOut, test } from '../fixtures'

test.describe('error pages (UI-007)', () => {
  test('an unknown address renders the not-found page with a link home', async ({ page }) => {
    const response = await page.goto('/does-not-exist')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/')
    await axe(page)
  })

  // Step 3.5 put the (app) group behind a session, so the shell is reached as a seat now; the
  // empty state a member sees is "nothing assigned", not "no institution".
  test('the app shell renders the home empty state with a working skip link', async ({ page }) => {
    await signInAs(page, 'student1')
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
    // Step 6.5 gave the panel something to say: a seated student is shown the assignments they can
    // start, and the seeded section carries three (06 §5 item 5). The empty state this spec used to
    // read belongs to a seat with nothing assigned, which student1 no longer is.
    await expect(page.getByRole('heading', { level: 2, name: 'Your runs' })).toBeVisible()
    await expect(page.getByText('Decision Run 1 (walkthrough)')).toBeVisible()

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

    await signOut(page)
  })
})
