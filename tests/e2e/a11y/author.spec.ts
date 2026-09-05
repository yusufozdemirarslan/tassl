import type { Locator } from '@playwright/test'
// NFR-012: the authoring screens of Phase 5 — the package shelf, the form that starts a package
// from a seed case, a package version with its claims and one claim object, and the workspace where
// its elements are confirmed — carry no WCAG 2.1 A/AA violation.
//
// Every screen is scanned with something in it rather than empty: an empty table has no header
// cells to associate and no rows to read, an untouched form has no chips, no counters and no
// refusals, and an element tree with nothing in it is not a tree, so a scan of any of them proves
// very little about the screen an author actually meets.
//
// Unlike the Phase 4 scan, this spec creates nothing. Everything it needs is already in the seeded
// database — the confirmed Meridian Roast version with its element-by-element record, its eight
// claims and both variants — and nothing in the product deletes a package, so a spec that made one
// per browser project would leave three behind on every run. That is also why UI-043 is scanned
// here in the state a confirmed version leaves it in: the tree, the progress, and one element's
// whole form, read-only. The draft state of the same screen — the decision bar, the teaching-note
// check, and a refusal on the page — is scanned inside the package it creates, in
// ../author/confirm-workspace.spec.ts.
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

  // UI-043, the confirmation workspace over a version that holds ninety-three elements: the tree
  // walked down to one of them, and that element's whole form open beside it. A variant claim state
  // is the densest of the fifteen — two enums, a stance, a planted tick, and the three verification
  // paths as nested fieldsets — so it is the one the scan is pointed at.
  await page.goto(`${versionPath}/confirm`)
  await expect(page.getByRole('heading', { level: 2, name: 'Confirming version 1' })).toBeVisible()
  const tree = page.getByRole('tree', { name: 'Elements of this version' })
  // A row's name carries the state standing on it — a group its progress, a leaf its decision — so
  // these match the label each name starts with rather than the whole of it. The workspace opens
  // the path to the first element still waiting, so a group can already be open and clicking it
  // then would close it: expand only what is closed.
  const expand = async (row: Locator): Promise<void> => {
    if ((await row.getAttribute('aria-expanded')) === 'false') await row.click()
  }
  const claims = tree.getByRole('treeitem', { name: /^Claims/ })
  await expand(claims)
  const plantedClaim = tree.getByRole('treeitem', { name: 'C3' })
  await expand(plantedClaim)
  await plantedClaim.getByRole('treeitem', { name: /^Defective variant/ }).click()
  await expect(
    page.getByRole('heading', { level: 2, name: 'Variant state · defective:C3' }),
  ).toBeVisible()
  await axe(page)

  await signOut(page)
})
