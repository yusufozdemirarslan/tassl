// NFR-012: UI-050's three platform screens, and the one overlay any of them opens, carry no WCAG
// 2.1 A/AA violation.
//
// The dialog is opened on a seeded row and then cancelled: a role change revokes that person's
// sessions, and an accessibility scan has no business writing to the database it is scanning.
import { axe, expect, signInAs, test } from '../fixtures'

const ADMIN_SCREENS = [
  { path: '/admin/users', heading: 'Users' },
  { path: '/admin/flags', heading: 'Flags' },
  { path: '/admin/audit', heading: 'Audit log' },
] as const

for (const { path, heading } of ADMIN_SCREENS) {
  test(`${path} has no axe violations`, async ({ page }) => {
    await signInAs(page, 'admin')
    await page.goto(path, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await axe(page)
  })
}

test('the role-change dialog has no axe violations', async ({ page }) => {
  await signInAs(page, 'admin')
  await page.goto('/admin/users?q=student2%40tassl.local', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible()

  const role = page.getByRole('combobox', { name: /^Platform role for / })
  await role.click()
  await page.getByRole('option', { name: 'Scenario editor' }).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await axe(page)

  // Nothing is written: the scan leaves the seat exactly as it found it (14 §2).
  await dialog.getByRole('button', { name: 'Leave it as it is' }).click()
  await expect(dialog).toBeHidden()
})
