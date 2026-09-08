// Step 12.3 — UI-041, UI-042 and UI-043 end to end (FR-190, FR-191, FR-192, FR-194, FR-198,
// AI-001): a licensed case goes in at one end and a confirmed, frozen package version comes out of
// the other, with nothing done to the database that an author could not have done with a mouse.
//
// One journey, because that is the journey the phase exists to make possible:
//
//   "Create and generate" on the seed form → the progress screen, seven steps, every one of them
//   done → the confirmation workspace → one document rejected and sent back to the pipeline → the
//   new draft picked up on the screen without a reload → every element decided → the teaching-note
//   check → the version frozen → the version view, where the measures and the authoring record say
//   what it cost and how it was made.
//
// Three things this spec is careful about, because each was a way to write a green test that proved
// nothing:
//
//   *The pipeline is watched, not waited on blindly.* The generation screen polls; the assertion is
//   that all seven rows read "Done" and that the package's own rules pass, which is
//   `validatePackage` over the whole table (10 §4) rather than a spinner going away.
//
//   *The element count comes from the screen.* The mock writes a complete package (11 §1.4) and its
//   element count is a property of that mock, not of this spec. The progress line says "0 of N
//   confirmed"; N is read from it and the loop runs to it, so a mock that grows a document does not
//   silently stop being confirmed here.
//
//   *The regeneration is proved by the record, not by the pixels.* On the mock the regenerated
//   documents are byte-identical to the ones they replace — it is a pure function of the brief — so
//   the evidence that the step ran is the eighth generation pass on the version view (FR-198) and
//   the rejection still standing on the confirmation record, which is what `rejectedShare` counts.
//
// The package is created through the UI under a `suiteName` title, so its family key is unique to
// this run: nothing in the product deletes a package, and a second run writes its own family rather
// than colliding with the last one's.
import { suiteName } from '../fixture-package'
import { axe, expect, signInAs, signOut, test } from '../fixtures'

const CONCEPTS = ['payback period', 'contribution margin', 'cohort retention', 'evidence recency']

const CASE_TITLE = 'Northbank Dairy Cooperative and the chilled delivery tier'
const PUBLISHER = 'Tassl'
const LICENSE_TERMS =
  'Written for the Tassl end-to-end suite and licensed for unrestricted use inside the product. ' +
  'No third-party case material is incorporated and no attribution to an outside publisher is owed.'
const SEED_TEXT =
  'Northbank Dairy Cooperative piloted a chilled home-delivery tier at a premium price in three ' +
  'regions. The pilot deck put the payback at nine months on a contribution margin that excluded ' +
  'cold-chain freight. A later finance note put the freight at 1.10 dollars a delivery and the ' +
  'payback at fourteen months, and nobody has restated the first number on the second basis. The ' +
  'board must decide what share of next year’s marketing budget goes to the chilled tier, and ' +
  'state the payback it is betting on.'

/** The family key `SeedForm` derives from a title of ASCII words and digits. */
const familyKeyOf = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, '-')

const STEP_NAMES = [
  'Re-skin, brief and stakeholders',
  'Evidence Room documents',
  'Answer space and named fields',
  'Claims and their variant states',
  'The Turn and the probe',
  'Question bank and counterfactual',
  'Readiness Check items',
] as const

test('an author generates a package from a seed case, regenerates one element, and freezes the version', async ({
  page,
}) => {
  // Seven generation steps, one regeneration, and a decision per element — each of the last a
  // server action that revalidates the page it was made on. The assertions are unchanged; only the
  // patience (D-188).
  test.setTimeout(600_000)

  const title = suiteName('Generated package')
  const familyKey = familyKeyOf(title)

  await signInAs(page, 'instructor')

  // ------------------------------------------------------------------------------------------
  // UI-041: "Create and generate"
  // ------------------------------------------------------------------------------------------

  await page.goto('/packages/new')
  await expect(
    page.getByRole('heading', { level: 1, name: 'New package from a seed case' }),
  ).toBeVisible()

  await page.getByLabel('Title', { exact: true }).fill(title)
  await expect(page.getByLabel('Family key')).toHaveValue(familyKey)
  await page.getByLabel('Concepts').fill(CONCEPTS.join(', '))
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('4 added. Four is the minimum.')).toBeVisible()
  await page.getByLabel('Case title').fill(CASE_TITLE)
  await page.getByLabel('Publisher').fill(PUBLISHER)
  await page.getByLabel('License terms').fill(LICENSE_TERMS)
  await page.getByLabel('Seed case text').fill(SEED_TEXT)
  await page.getByRole('checkbox', { name: 'The license permits adaptation' }).check()

  // The control says what it is about to do before it is pressed: the package, then seven steps,
  // then a draft nothing is part of a package until an author signs it.
  await expect(
    page.getByText(
      'Create and generate writes the package and then drafts its elements from the seed case in seven steps',
    ),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Create and generate' }).click()

  // ------------------------------------------------------------------------------------------
  // UI-042: the progress screen, and the seven steps on it
  // ------------------------------------------------------------------------------------------

  await page.waitForURL(/\/packages\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}\/generation$/, {
    timeout: 60_000,
  })
  const versionPath = new URL(page.url()).pathname.replace(/\/generation$/, '')

  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  const steps = page.getByRole('list', { name: 'The seven steps' })
  await expect(steps).toBeVisible()
  // Seven rows whatever has happened to them: a step nothing has run for is still a step.
  for (const name of STEP_NAMES) {
    await expect(steps.getByRole('heading', { level: 3, name })).toBeVisible()
  }

  // The screen polls every five seconds while a step is running and stops when it is not; what it
  // is waiting for is the package's own rules, which is `validatePackage` over the whole table.
  await expect(
    page.getByRole('heading', { level: 2, name: 'Every package rule is met' }),
  ).toBeVisible({ timeout: 120_000 })
  const done = steps.locator('[data-kind="confirmed"]')
  await expect(done).toHaveCount(7)
  // Each step reports what it cost, so an author can see where the tokens went.
  await expect(steps).toContainText('Tokens')

  // UI-042 in the state only a generated package reaches: seven done rows with their numbers, the
  // rule report, and the way into the workspace (NFR-012). The empty twin of this screen is scanned
  // in ../a11y/author.spec.ts.
  await axe(page)

  // ------------------------------------------------------------------------------------------
  // UI-043: the confirmation workspace over what the pipeline wrote
  // ------------------------------------------------------------------------------------------

  await page.getByRole('link', { name: 'Open confirmation workspace' }).click()
  await page.waitForURL(`**${versionPath}/confirm`)

  const progress = page.locator('[data-slot="progress-value"]')
  await expect(progress).toContainText('0 of ')
  const opening = (await progress.textContent()) ?? ''
  const total = Number(/0 of (\d+) confirmed/.exec(opening)?.[1])
  expect(Number.isInteger(total) && total > 40).toBe(true)

  const tree = page.getByRole('tree', { name: 'Elements of this version' })
  const documents = tree.getByRole('treeitem', { name: /^Documents/ })
  await expect(documents).toBeVisible()

  // ------------------------------------------------------------------------------------------
  // FR-194: one document rejected, and a new draft asked for
  // ------------------------------------------------------------------------------------------

  if ((await documents.getAttribute('aria-expanded')) === 'false') await documents.click()
  // A row is named by what it says *and* the decision standing on it — "Premium Tier Positioning
  // Review (June 2025 board deck) D1 Undecided" — so the key is matched as a word inside the name.
  const firstDocument = tree.getByRole('treeitem', { name: /\bD1\b/ }).first()
  await firstDocument.click()
  await expect(page.getByRole('heading', { level: 2, name: 'Document · D1' })).toBeVisible()

  await page.getByRole('button', { name: 'Reject', exact: true }).click()
  await page
    .getByLabel('Why this element is rejected')
    .fill('The dateline reads as an internal memo; it should be an external supplier notice.')
  await page.getByRole('button', { name: 'Reject element' }).click()
  await expect(page.getByText('D1 rejected.')).toBeVisible()
  // The rejection is on the record from here: `rejectedShare` counts the elements an author sent
  // back, and the count on the screen is the same arithmetic (FR-198).
  await expect(page.locator('#confirm-progress')).toContainText('1 rejected')

  // Rewrite says what it replaces before it is pressed: a whole set is written, not a line — and
  // the submit is named for the set, so the last thing read before the press is its scope.
  await firstDocument.click()
  await page.getByRole('button', { name: 'Rewrite', exact: true }).click()
  await expect(
    page.getByText('A new draft is written for every document in this version, this one included.'),
  ).toBeVisible()
  await page
    .getByLabel('What the new draft has to get right (optional)')
    .fill('Give the notice an external author and a date after the pilot.')
  await page.getByRole('button', { name: 'Rewrite every document in this version' }).click()

  await expect(page.getByText('A new draft of D1 was asked for.')).toBeVisible()
  // While it is being written nothing may be recorded: a decision filed against values that are
  // about to be replaced is the one thing this screen must not do.
  await expect(page.locator('#confirm-progress')).toContainText('Writing a new draft')
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  // The screen waits for the server and picks the new draft up on its own; the client only polls
  // and displays.
  await expect(page.getByText('The new draft of D1 is on the screen.')).toBeVisible({
    timeout: 90_000,
  })
  await expect(page.getByText('Writing a new draft')).toHaveCount(0)

  // ------------------------------------------------------------------------------------------
  // FR-192: every element decided, the teaching note checked, and the version frozen
  // ------------------------------------------------------------------------------------------

  const confirmElement = page.getByRole('button', { name: 'Confirm', exact: true })
  const nextUndecided = page.getByRole('button', { name: 'Next undecided element' })
  await nextUndecided.click()

  for (let decided = 1; decided <= total; decided += 1) {
    await confirmElement.click()
    await expect(progress).toHaveText(`${String(decided)} of ${String(total)} confirmed`)
  }
  await expect(page.getByText('Every element has a decision.')).toBeVisible()

  await page
    .getByRole('checkbox', {
      name: 'Teaching note checked against the answer space and claims',
    })
    .check()
  await page.getByRole('button', { name: 'Confirm version' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('All met')
  await dialog.getByRole('button', { name: 'Confirm and freeze' }).click()
  await expect(page.getByText('Version 1 is confirmed and frozen.')).toBeVisible()

  // ------------------------------------------------------------------------------------------
  // UI-044: what it cost, and how it was made (FR-198)
  // ------------------------------------------------------------------------------------------

  await page.goto(versionPath)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()

  const record = page.locator('#authoring-record')
  await expect(record).toContainText(CASE_TITLE)
  await expect(record).toContainText(PUBLISHER)
  await expect(record).toContainText(LICENSE_TERMS)
  // The re-skin log is what makes the package an adaptation rather than a copy (FR-028); the
  // pipeline wrote it and `RESKIN_LOG_EMPTY` would have kept the version a draft without it.
  await expect(record.getByRole('table')).toBeVisible()

  const measures = page.locator('#authoring-measures')
  await expect(measures).toContainText('Seed to confirmed')
  await expect(measures).toContainText('Rejected share')
  // Seven steps and the one regeneration: eight generation runs on this version (FR-198).
  const passes = measures.locator('div').filter({ hasText: /^Generation passes/ })
  await expect(passes.locator('dd span').first()).toHaveText('8')
  // Every measure now has something behind it: nothing on this panel reads "No decisions yet".
  await expect(measures).not.toContainText('No decisions yet')
  await expect(measures).not.toContainText('Not confirmed yet')

  await signOut(page)
})
