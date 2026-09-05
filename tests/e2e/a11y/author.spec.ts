// NFR-012: the authoring screens of Phase 5 — the package shelf, the form that starts a package
// from a seed case, and a package version with its claims and one claim object — carry no WCAG 2.1
// A/AA violation.
//
// Every screen is scanned with something in it rather than empty: an empty table has no header
// cells to associate and no rows to read, and an untouched form has no chips, no counters and no
// refusals, so a scan of either proves very little about the screen an author actually meets.
//
// Unlike the Phase 4 scan, this spec creates nothing. Everything it needs is already in the seeded
// database — the confirmed Meridian Roast version with its element-by-element record, its eight
// claims and both variants — and nothing in the product deletes a package, so a spec that made one
// per browser project would leave three behind on every run.
import { seededPackage } from '../fixture-package'
import { axe, expect, signInAs, signOut, test } from '../fixtures'

const CONCEPTS =
  'private label margin, shelf space allocation, brand cannibalization, cost to serve'

test('the Phase 5 authoring screens have no axe violations', async ({ page }) => {
  await signInAs(page, 'instructor')
  const seeded = seededPackage()

  // UI-040, the shelf, with the seeded family on it.
  await page.goto('/packages')
  await expect(page.getByRole('heading', { level: 1, name: 'Packages' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'meridian-roast' })).toBeVisible()
  await axe(page)

  // UI-041, the seed form in the state an author is in halfway through it: a title, the key derived
  // from it, four concept chips, and the fields that are still empty saying so. Nothing is
  // submitted, so the refusals are the browser's own and no package is written.
  await page.goto('/packages/new')
  await expect(
    page.getByRole('heading', { level: 1, name: 'New package from a seed case' }),
  ).toBeVisible()
  await page.getByLabel('Title', { exact: true }).fill('Harbourline Grocers')
  await expect(page.getByLabel('Family key')).toHaveValue('harbourline-grocers')
  await page.getByLabel('Concepts').fill(CONCEPTS)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('4 added. Four is the minimum.')).toBeVisible()
  await page.getByRole('button', { name: 'Create the package' }).click()
  // A refusal is said twice on purpose: once in the summary at the top of the form, where it is a
  // link to the field, and once under the field itself. The scan below covers both.
  const summary = page.getByRole('alert')
  await expect(
    summary.getByRole('link', { name: 'Name the case this package is adapted from.' }),
  ).toBeVisible()
  await expect(page.getByText('Name the case this package is adapted from.').first()).toBeVisible()
  await expect(page.getByText('Paste at least 200 characters of the case.').first()).toBeVisible()
  await axe(page)

  // UI-044, a confirmed version: the element-by-element record, the authoring record and the case
  // behind it, the five measures, and every claim with what each variant makes of it.
  const versionPath = `/packages/${seeded.packageId}/versions/${seeded.versionId}`
  await page.goto(versionPath)
  await expect(page.getByRole('heading', { level: 1, name: seeded.title })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Confirmation record' })).toBeVisible()
  await expect(
    page.locator('#confirmation-record').getByRole('row').filter({ hasText: 'Confirmed' }).first(),
  ).toBeVisible()
  await expect(page.locator('#claims').getByRole('row').filter({ hasText: 'C3' })).toBeVisible()
  await axe(page)

  // UI-044 → the claim object, a sub-view of the same address (FR-180).
  await page.goto(`${versionPath}?claim=C3`)
  await expect(page.getByRole('heading', { level: 2, name: 'Claim C3' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 4, name: 'Defective variant' })).toBeVisible()
  await axe(page)

  await signOut(page)
})
