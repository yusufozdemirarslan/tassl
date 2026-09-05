// Step 5.4, UI-040, UI-041 and UI-044 (FR-190, FR-195, FR-180, FR-028, SYS-026): the two ways a
// scenario package comes into being, and the screen that says what a version of one holds.
//
// One journey, because that is how an author meets these three screens: the shelf, the seed form
// that puts a package on it, the import that brings one in whole, and the version view that reads
// back what arrived — down to a single claim, its planted defect and the two paths a student could
// have checked it by.
//
// Generation (AI-001) is Phase 12, so "Create the package" is the control this spec presses, and
// the generate control is asserted to be exactly what UI-041 promises until then: present, named,
// and unable to act, with the reason beside it.
//
// The two packages this spec creates are named through `suiteName`, so they carry SUITE_PREFIX and
// a purge can find them by name. Neither the product nor `tests/e2e/global-setup.ts` deletes a
// package today, so the run does not depend on being cleaned up after: both family keys are derived
// from those unique names, and a second run against the same database writes its own two families
// rather than colliding with the ones the last run left behind.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { suiteName } from '../fixture-package'
import { expect, signInAs, signOut, test } from '../fixtures'

/** The fixture the seed imports (06 §5 item 4); this spec brings the same document in by hand. */
const FIXTURE_PATH = join(
  process.cwd(),
  'src',
  'server',
  'db',
  'fixtures',
  'meridian-roast.package.json',
)

/** Only the two fields this spec rewrites are named; the rest of the export travels untouched. */
type PackageExportDocument = Record<string, unknown> & {
  package: { title: string; familyKey: string }
}

/**
 * The family key `SeedForm` derives from a title.
 *
 * It is not the component's own `toFamilyKey` — that lives in a client module, and a spec that
 * imported it would be checking the derivation against itself. The titles here are ASCII words and
 * digits separated by spaces, which is the one case where the rule is unambiguous, so this is the
 * expected string written out rather than the implementation borrowed.
 */
const familyKeyOf = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, '-')

const CONCEPTS = [
  'private label margin',
  'shelf space allocation',
  'brand cannibalization',
  'supplier switching cost',
]

const CASE_TITLE = 'Harbourline Grocers and the private-label decision'
const PUBLISHER = 'Tassl'
const LICENSE_TERMS =
  'Written for the Tassl end-to-end suite and licensed for unrestricted use inside the product. ' +
  'No third-party case material is incorporated and no attribution to an outside publisher is owed.'
const SEED_TEXT =
  'Harbourline Grocers runs 34 stores on the east coast and 240 million dollars of annual revenue. ' +
  'Margin has been flat for two years while the national brands it stocks have raised list prices twice. ' +
  'The merchandising director wants a private-label line across four categories by spring; the supply ' +
  'chain lead says two categories is all the co-packers can hold; the finance director will not sign ' +
  'anything until the shelf space the line displaces is priced. Decide how many categories launch, and ' +
  'state the contribution margin you are betting the line clears in its first full year.'

/**
 * Opens a dialog whose trigger is a client component.
 *
 * A production build paints the seed form before React has attached, and the import dialog is a
 * deferred chunk fetched on the press, so a click that lands in either gap does nothing. The click
 * is retried until the dialog is actually open, which is what a person does too.
 */
async function openDialog(page: Page, triggerName: string, title: string): Promise<Locator> {
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: title }) })
  await expect(async () => {
    await page.getByRole('button', { name: triggerName }).click()
    await expect(dialog).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 30_000 })
  return dialog
}

/** The value beside a label in a definition list: `<dt>Working clock</dt><dd>25 min</dd>`. */
function fact(scope: Locator, label: string): Locator {
  return scope.locator(
    `xpath=.//dt[normalize-space(.)=${JSON.stringify(label)}]/following-sibling::dd[1]`,
  )
}

/** The block a per-variant heading owns inside the claim object view. */
function variantBlock(scope: Locator, heading: string): Locator {
  return scope.locator(`xpath=.//h4[normalize-space(.)=${JSON.stringify(heading)}]/..`)
}

test('an instructor starts a package from a seed case, imports one whole, and reads a claim back', async ({
  page,
}) => {
  const seedTitle = suiteName('Package')
  const seedFamilyKey = familyKeyOf(seedTitle)
  const importedTitle = suiteName('Imported package')
  const importedFamilyKey = familyKeyOf(importedTitle)

  await signInAs(page, 'instructor')

  // ------------------------------------------------------------------------------------------
  // UI-040: the shelf, with the package the seed put on it
  // ------------------------------------------------------------------------------------------

  await page.goto('/packages')
  await expect(page.getByRole('heading', { level: 1, name: 'Packages' })).toBeVisible()
  await expect(
    page.getByText(
      'The scenario packages this institution has authored. A confirmed version is what an assignment runs on.',
    ),
  ).toBeVisible()

  // The seeded Meridian Roast family: a confirmed version, and uncalibrated because no cohort has
  // run it. It is the oldest package in the institution and the list is newest first, so it is on
  // the first page of any seeded database.
  const seededRow = page.getByRole('row').filter({ hasText: 'meridian-roast' })
  await expect(seededRow).toBeVisible()
  await expect(
    seededRow.getByRole('link', { name: 'Open Meridian Roast (fixture), version 1' }),
  ).toBeVisible()
  await expect(seededRow.getByRole('cell').nth(3)).toHaveText('Confirmed')
  await expect(seededRow.getByRole('cell').nth(4)).toHaveText('Uncalibrated')

  // ------------------------------------------------------------------------------------------
  // UI-041: a package from a seed case, without generation
  // ------------------------------------------------------------------------------------------

  await page.getByRole('link', { name: 'New package from a seed case' }).click()
  await page.waitForURL('**/packages/new')
  await expect(
    page.getByRole('heading', { level: 1, name: 'New package from a seed case' }),
  ).toBeVisible()

  const familyKey = page.getByLabel('Family key')
  await expect(page.getByText('None yet. Four is the minimum.')).toBeVisible()

  // The key follows the title until it is touched, so an author who never opens that field still
  // gets one that travels with every export.
  await page.getByLabel('Title', { exact: true }).fill(seedTitle)
  await expect(familyKey).toHaveValue(seedFamilyKey)

  // One field, four concepts: a pasted list separated by commas becomes one chip each.
  await page.getByLabel('Concepts').fill(CONCEPTS.join(', '))
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('4 added. Four is the minimum.')).toBeVisible()
  for (const concept of CONCEPTS) {
    await expect(page.getByRole('button', { name: `Remove ${concept}` })).toBeVisible()
  }

  await page.getByLabel('Case title').fill(CASE_TITLE)
  await page.getByLabel('Publisher').fill(PUBLISHER)
  await page.getByLabel('License terms').fill(LICENSE_TERMS)
  await page.getByLabel('Seed case text').fill(SEED_TEXT)
  await expect(page.getByText(`${SEED_TEXT.length} of 200,000 characters`)).toBeVisible()

  const license = page.getByRole('checkbox', { name: 'The license permits adaptation' })
  await license.check()
  await expect(license).toBeChecked()

  // Generation arrives in Phase 12. Until then the control is on the screen, reachable, and says
  // why it cannot act — an absent control would tell an author nothing (UI-041).
  const generate = page.getByRole('button', { name: 'Create and generate' })
  await expect(generate).toHaveAttribute('aria-disabled', 'true')
  await expect(
    page.getByText(
      'Tassl cannot draft a package’s elements for you yet. Create the package, then write its elements in the confirmation workspace or bring in a package export.',
    ),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Create the package' }).click()
  await expect(page.getByText(`Created ${seedTitle}.`)).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 2, name: `${seedTitle} is on the shelf` }),
  ).toBeVisible()
  await expect(
    page.getByText(
      'Version 1 is a draft and holds nothing. Tassl cannot draft its elements for you yet, so write them in the confirmation workspace or bring in a package export. An assignment can only run on a version once every element is confirmed.',
    ),
  ).toBeVisible()

  // ------------------------------------------------------------------------------------------
  // UI-044 on the version that was just created: a draft holding nothing
  // ------------------------------------------------------------------------------------------

  await page.getByRole('link', { name: 'Open version 1' }).click()
  await page.waitForURL(/\/packages\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1, name: seedTitle })).toBeVisible()
  await expect(
    page.getByText(
      'Version 1 is a draft. Its elements can still be edited, and no assignment can run on it until every one of them is confirmed.',
    ),
  ).toBeVisible()

  const identity = page.locator('#version-identity')
  await expect(fact(identity, 'Family key')).toHaveText(seedFamilyKey)
  await expect(fact(identity, 'Status')).toHaveText('Draft')
  await expect(fact(identity, 'Calibration')).toContainText(
    "uncalibrated: no field calibration; difficulty profile is the authority's estimate",
  )
  for (const label of ['Documents', 'Claims', 'Defense questions', 'Readiness items']) {
    await expect(fact(identity, label)).toHaveText('0')
  }
  // The variant pair is the one thing a new version is not empty of: every version carries both
  // readings of the same scenario from the moment it exists (DATA-020).
  await expect(fact(identity, 'Variants')).toHaveText('2')
  // Nothing has been written, so the rules a version must pass before it can be confirmed fail,
  // and the way on is the workspace rather than a confirmation.
  await expect(identity.getByText(/package rules still fail/)).toBeVisible()
  await expect(
    identity.getByRole('link', { name: 'Open the confirmation workspace' }),
  ).toBeVisible()

  // The seed record is the case behind the package, kept with it and shown to its authors (FR-028).
  const authoring = page.locator('#authoring-record')
  await expect(fact(authoring, 'Case title')).toHaveText(CASE_TITLE)
  await expect(fact(authoring, 'Publisher')).toHaveText(PUBLISHER)
  await expect(fact(authoring, 'Generating model')).toHaveText('None; written by hand or imported')
  await expect(fact(authoring, 'Confirmed')).toHaveText('Not yet')
  await expect(
    authoring.getByText(
      'The author confirmed that these terms permit adaptation before the package was built.',
    ),
  ).toBeVisible()
  await expect(
    authoring.getByText(
      'This seed record names nothing that was changed from the case. A version cannot be confirmed until it does.',
    ),
  ).toBeVisible()

  await expect(
    page.getByRole('heading', { level: 3, name: 'Nothing has been decided yet' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'No claims yet' })).toBeVisible()

  // Back to the shelf, where the new family now sits above the seeded one.
  await page.getByRole('link', { name: 'All packages' }).click()
  await page.waitForURL('**/packages')
  const seedRow = page.getByRole('row').filter({ hasText: seedFamilyKey })
  await expect(seedRow.getByRole('link', { name: `Open ${seedTitle}, version 1` })).toBeVisible()
  await expect(seedRow.getByRole('cell').nth(2)).toContainText('Version 1')
  await expect(seedRow.getByRole('cell').nth(3)).toHaveText('Draft')

  // ------------------------------------------------------------------------------------------
  // UI-041's second route: a package export somebody already wrote
  // ------------------------------------------------------------------------------------------

  const exported = readFileSync(FIXTURE_PATH, 'utf8')
  const document = JSON.parse(exported) as PackageExportDocument

  await page.getByRole('link', { name: 'New package from a seed case' }).click()
  await page.waitForURL('**/packages/new')
  const dialog = await openDialog(page, 'Import a package export', 'Import a package export')
  const pasted = dialog.getByLabel('Package JSON')

  // The fixture as the seed imported it: the same family key, which this institution already has.
  // A family key is unique per institution, so the copy has to be given one of its own — and the
  // dialog says so rather than answering with a code.
  await pasted.fill(exported)
  await dialog.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(
    dialog.getByText(
      'This institution already has a package with the family key in that export. Change the family key in the file, or open the package you already have.',
    ),
  ).toBeVisible()

  // With its own family key and title, the same document is a second family: everything else in it
  // — the brief, the nine documents, the eight claims and both variants — travels unchanged.
  document.package = { ...document.package, familyKey: importedFamilyKey, title: importedTitle }
  await pasted.fill(JSON.stringify(document))
  await dialog.getByRole('button', { name: 'Import', exact: true }).click()

  await expect(page.getByText('Package imported. Version 1 is a draft.')).toBeVisible()
  await expect(
    dialog.getByText(
      'Every rule passes. Confirm each element to freeze version 1, and an assignment can run on it.',
    ),
  ).toBeVisible()

  await dialog.getByRole('link', { name: 'Open the version' }).click()
  await page.waitForURL(/\/packages\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}$/)

  // ------------------------------------------------------------------------------------------
  // UI-044 on the imported version: what a whole package holds
  // ------------------------------------------------------------------------------------------

  await expect(page.getByRole('heading', { level: 1, name: importedTitle })).toBeVisible()
  const imported = page.locator('#version-identity')
  await expect(fact(imported, 'Family key')).toHaveText(importedFamilyKey)
  await expect(fact(imported, 'Status')).toHaveText('Draft')
  await expect(fact(imported, 'Working clock')).toHaveText('25 min')
  await expect(fact(imported, 'Turn delay')).toHaveText('1 min 30 s')
  await expect(fact(imported, 'Difficulty estimate')).toContainText('moderate')

  const counts: [string, string][] = [
    ['Documents', '9'],
    ['Stakeholders', '3'],
    ['Answer-space positions', '3'],
    ['Named fields', '2'],
    ['Claims', '8'],
    ['Variants', '2'],
    ['Defense questions', '29'],
    ['Readiness items', '16'],
  ]
  for (const [label, value] of counts) {
    await expect(fact(imported, label)).toHaveText(value)
  }
  // The import is not confirmation: the elements are drafts, and every package rule passing is what
  // says the version is ready to be confirmed rather than that it has been.
  await expect(
    imported.getByText('Every package rule passes. Confirm each element to freeze the version.'),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 3, name: 'Nothing has been decided yet' }),
  ).toBeVisible()

  // The re-skin log came with the document: what was changed from the case it was adapted from.
  await expect(
    page.locator('#authoring-record').getByRole('row').filter({ hasText: 'Renamed entity' }),
  ).toBeVisible()

  // ------------------------------------------------------------------------------------------
  // UI-044 → the claims table and one claim object (FR-180)
  // ------------------------------------------------------------------------------------------

  const claims = page.locator('#claims')
  await expect(claims.getByRole('columnheader', { name: 'Defective variant' })).toBeVisible()
  await expect(claims.getByRole('columnheader', { name: 'Sound variant' })).toBeVisible()
  // Eight claims, one header row.
  await expect(claims.getByRole('row')).toHaveCount(9)

  // C3 is the planted claim: eleven months of premium payback, stale in the defective variant and
  // sound in the other. The row says so before it is opened.
  const plantedRow = claims.getByRole('row').filter({ hasText: 'C3' })
  await expect(plantedRow.getByRole('cell').nth(4)).toContainText('Defective')
  await expect(plantedRow.getByRole('cell').nth(4)).toContainText('Stale evidence')
  // The warranted stance is a chip: the colour and the icon carry it, the word is always there,
  // and the phrase naming what the stance is stays in the cell for a screen reader.
  await expect(plantedRow.getByRole('cell').nth(4).locator('[data-stance="challenge"]')).toHaveText(
    'Warranted stance Challenge',
  )
  await expect(plantedRow.getByRole('cell').nth(4)).toContainText('Planted')
  await expect(plantedRow.getByRole('cell').nth(5)).toContainText('Sound')

  await plantedRow.getByRole('link', { name: /^Open claim C3/ }).click()
  // The address carries the claims panel's own fragment, so the claim opens where it was clicked.
  await page.waitForURL(/\?claim=C3#claims$/)

  const claim = page.locator('#claims')
  await expect(page.getByRole('heading', { level: 2, name: 'Claim C3' })).toBeVisible()
  await expect(
    claim.getByText(
      'Premium payback is about 11 months, so the premium tier returns its acquisition cost inside the fiscal year.',
    ),
  ).toBeVisible()
  await expect(fact(claim, 'Stated by')).toHaveText('The assistant, on its own account')
  // The assistant states this one on its own account and quotes nothing, so the document beside it
  // is not a quotation: 06 §3.3 has a claim with a Source Trace name the document that trace leads
  // to, and the import fills the column from the trace when the claim carries no source of its own.
  await expect(fact(claim, 'Document a Source Trace reaches')).toContainText(
    'Premium Tier Positioning Review',
  )
  await expect(
    claim.getByText(
      'The assistant stated this in its own words, so nothing is quoted; the document above is what a Source Trace on it reaches.',
    ),
  ).toBeVisible()
  await expect(fact(claim, 'Importance')).toHaveText('Load-bearing')
  await expect(fact(claim, 'Consequence if wrong')).toHaveText('High')
  await expect(fact(claim, 'Verification cost')).toHaveText('Moderate')
  await expect(fact(claim, 'Concept')).toHaveText('payback_period')
  await expect(claim.getByText('premium_payback_months: 11 months')).toBeVisible()

  // The answer key for this claim, variant by variant: what it deserved, and the two interrogation
  // actions that would have returned enough to refuse it.
  const defective = variantBlock(claim, 'Defective variant')
  await expect(fact(defective, 'Evidence status')).toHaveText('Defective')
  await expect(fact(defective, 'Failure family')).toHaveText('Stale evidence')
  await expect(fact(defective, 'Warranted stance')).toHaveText('Challenge')
  await expect(fact(defective, 'Planted defect')).toHaveText('Planted')
  await expect(defective.getByText('Source Trace')).toBeVisible()
  await expect(fact(defective, 'Dated')).toHaveText('2025-02-10')
  await expect(fact(defective, 'Document')).toContainText('Positioning Review')
  await expect(defective.getByText('Decomposition Check')).toBeVisible()
  // The step that shows what the number should have been; the one that reproduces the stated
  // eleven months is quoted in the trace passage above it as well, so this is the unique one.
  await expect(
    defective.getByText('310 divided by 19.40, contribution after fulfillment'),
  ).toBeVisible()

  const sound = variantBlock(claim, 'Sound variant')
  await expect(fact(sound, 'Evidence status')).toHaveText('Sound')
  await expect(fact(sound, 'Failure family')).toHaveText('None; sound in this variant')
  await expect(fact(sound, 'Planted defect')).toHaveText('No')

  // The claim is a sub-view of the same address, so the way back is a link and the table returns.
  await claim.getByRole('link', { name: 'All claims' }).click()
  await page.waitForURL(/\/versions\/[0-9a-f-]{36}#claims$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Claims' })).toBeVisible()
  await expect(page.locator('#claims').getByRole('row')).toHaveCount(9)

  await signOut(page)
})
