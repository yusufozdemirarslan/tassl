import { expect, test } from '../fixtures'

// Base UI menus on the gallery (UI-060): the popup opens on click with its items reachable, the
// page underneath is untouched (a GroupLabel outside a Group used to throw into the error
// boundary), and Escape closes the menu and hands focus back to the trigger.
test.describe('dropdown menus', () => {
  test('the Actions menu opens with its items and the page keeps its heading', async ({ page }) => {
    await page.goto('/dev/components')
    await page.getByRole('button', { name: 'Actions', exact: true }).click()

    await expect(page.getByRole('menu')).toBeVisible()
    for (const name of ['Verify against the ledger', 'Ask a stakeholder', 'Escalate']) {
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  })

  test('the account menu lists Settings and Sign out and returns focus on Escape', async ({
    page,
  }) => {
    await page.goto('/dev/components')
    const trigger = page.getByRole('button', { name: 'Account: Marco Villanueva' })
    await trigger.click()

    await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})
