// UI-041, UI-042 and UI-043 end to end (FR-190, FR-191, FR-192, FR-194, FR-198, AI-001; D-750,
// D-751, D-752): a case goes in at one end and a published package comes out of the other, with
// nothing done to the database that an author could not have done with a mouse.
//
// Three journeys, because the promise D-750 and D-751 make has three edges to it:
//
//   1. *The whole road.* Title, family key and a pasted case → Generate → the progress screen →
//      the review workspace → one document rejected and sent back to the pipeline → the new draft
//      picked up without a reload and confirmed → one press publishes the version.
//   2. *The short road.* A title and a family key and nothing else. No concepts, no case text, no
//      licence record — and the package still publishes, because the concept set has a default and
//      the completion writes every element the rule table requires (D-750, D-751).
//   3. *No rule code, anywhere.* The screens an author passes through are checked for the strings
//      the rule table is spelled with. A rule is a server-side guarantee; its code is this
//      repository's vocabulary and never the author's.
//
// Four things these specs are careful about, because each was a way to write a green test that
// proved nothing:
//
//   *The pipeline is watched, not waited on blindly.* The generation screen polls; the assertion is
//   that all seven rows read "Done" and that the package's own rules pass, which is
//   `validatePackage` over the whole table (10 §4) rather than a spinner going away.
//
//   *The publish is one press from the review screen.* Not sixty. What the dialog says is what is
//   being signed, and the elements nobody decided on are confirmed by that press (D-752) — so the
//   spec asserts the confirmation record afterwards rather than trusting the button.
//
//   *A rejection still blocks.* An author who sent an element back meant it: the spec rejects D1,
//   asks for a rewrite, and has to confirm the new draft before the version will publish.
//
//   *The regeneration is proved by the record, not by the pixels.* On the mock the regenerated
//   documents are byte-identical to the ones they replace — it is a pure function of the brief — so
//   the evidence that the step ran is the eighth generation pass on the version view (FR-198) and
//   the rejection still standing on the confirmation record, which is what `rejectedShare` counts.
//
// Each package is created through the UI under a `suiteName` title, so its family key is unique to
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

/**
 * The rule table's own vocabulary. Not one of these may reach a screen (D-750): a code is how this
 * repository names a rule, and an author reading "QUESTION_BANK_INCOMPLETE" is being handed a
 * grep term instead of a sentence. The validator's *sentences* still appear where a package
 * genuinely breaks a rule; the codes never do.
 */
const RULE_CODES = [
  'QUESTION_BANK_INCOMPLETE',
  'READINESS_SPLIT',
  'DEFECTIVE_VARIANT_PLANT',
  'COUNTERFACTUAL_SENTENCES',
  'DOCUMENT_ROLES_MISSING',
  'PACKAGE_INVALID',
] as const

/** Nothing on this page is spelled the way a rule code is. */
async function expectsNoRuleCodes(page: Parameters<typeof axe>[0]): Promise<void> {
  const body = (await page.locator('body').innerText()).toUpperCase()
  for (const code of RULE_CODES) expect(body).not.toContain(code)
}

test('an author generates a package from a case, regenerates one element, and publishes the version in one press', async ({
  page,
}) => {
  // Seven generation steps, one regeneration, and a publish — each a server action that
  // revalidates the page it was made on. The assertions are unchanged; only the patience (D-188).
  test.setTimeout(600_000)

  const title = suiteName('Generated package')
  const familyKey = familyKeyOf(title)

  await signInAs(page, 'editor')

  // ------------------------------------------------------------------------------------------
  // UI-041: two fields, a pasted case, and Generate
  // ------------------------------------------------------------------------------------------

  await page.goto('/packages/new')
  await expect(page.getByRole('heading', { level: 1, name: 'New package' })).toBeVisible()

  await page.getByLabel('Title', { exact: true }).fill(title)
  await expect(page.getByLabel('Family key')).toHaveValue(familyKey)
  await page.getByLabel('Scenario text').fill(SEED_TEXT)

  // The concepts and the licence record are behind one disclosure, because a package needs neither
  // (D-751). This one adapts a named case, so both are filled.
  await page.getByText('Concepts and licensing', { exact: true }).click()
  await page.getByLabel('Concepts').fill(CONCEPTS.join(', '))
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('4 added. Add four or more, or leave this empty.')).toBeVisible()
  await page.getByLabel('Case title').fill(CASE_TITLE)
  await page.getByLabel('Publisher').fill(PUBLISHER)
  await page.getByLabel('License terms').fill(LICENSE_TERMS)
  await page.getByRole('checkbox', { name: 'The license permits adaptation' }).check()

  // The control says what it is about to do before it is pressed.
  await expect(
    page.getByText('Generate writes the package and drafts every element it needs'),
  ).toBeVisible()
  await expectsNoRuleCodes(page)

  await page.getByRole('button', { name: 'Generate', exact: true }).click()

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
  // Since D-750 that is a guarantee rather than a hope: the last step completes the package against
  // the rule table before it reports done, so this heading is the only outcome a finished pipeline
  // has.
  await expect(
    page.getByRole('heading', { level: 2, name: 'Every package rule is met' }),
  ).toBeVisible({ timeout: 180_000 })
  const done = steps.locator('[data-kind="confirmed"]')
  await expect(done).toHaveCount(7)
  // Each step reports what it cost, so an author can see where the tokens went.
  await expect(steps).toContainText('Tokens')
  await expectsNoRuleCodes(page)

  // UI-042 in the state only a generated package reaches: seven done rows with their numbers, the
  // rule report, and the way into the workspace (NFR-012). The empty twin of this screen is scanned
  // in ../a11y/author.spec.ts.
  await axe(page)

  // ------------------------------------------------------------------------------------------
  // UI-043: the review workspace over what the pipeline wrote
  // ------------------------------------------------------------------------------------------

  await page.getByRole('link', { name: 'Open confirmation workspace' }).click()
  await page.waitForURL(`**${versionPath}/confirm`)

  const progress = page.locator('[data-slot="progress-value"]')
  await expect(progress).toContainText('0 of ')
  const opening = (await progress.textContent()) ?? ''
  const total = Number(/0 of (\d+) confirmed/.exec(opening)?.[1])
  expect(Number.isInteger(total) && total > 40).toBe(true)
  await expectsNoRuleCodes(page)

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
    timeout: 120_000,
  })
  await expect(page.getByText('Writing a new draft')).toHaveCount(0)

  // ------------------------------------------------------------------------------------------
  // FR-192, D-752: a rejection still blocks, and one press publishes everything else
  // ------------------------------------------------------------------------------------------

  // D1 still stands rejected, and publishing may not sweep that up: the author meant it.
  await page.getByRole('button', { name: 'Confirm and publish' }).click()
  const blocked = page.getByRole('alertdialog')
  await blocked.getByRole('button', { name: 'Confirm and publish' }).click()
  await expect(page.getByText('Rejected and waiting to be re-read')).toBeVisible()
  await expectsNoRuleCodes(page)

  // Read the new draft and confirm it; everything else is confirmed by the publish itself.
  await firstDocument.click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(progress).toContainText('1 of ')

  await page.getByRole('button', { name: 'Confirm and publish' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Every element you have not already decided on is confirmed')
  await dialog.getByRole('button', { name: 'Confirm and publish' }).click()
  await expect(page.getByText('Version 1 is published.')).toBeVisible({ timeout: 60_000 })

  // ------------------------------------------------------------------------------------------
  // UI-044: what it cost, and how it was made (FR-198)
  // ------------------------------------------------------------------------------------------

  await page.goto(versionPath)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible()

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
  await expectsNoRuleCodes(page)

  await signOut(page)
})

test('an author generates and publishes a package from a title and a family key alone', async ({
  page,
}) => {
  // The short road (D-751). Nothing is pasted and nothing is declared: the concept set falls back
  // to four concepts any decision run exercises, the seed record says the material is the author's
  // own, and the completion writes every element the rule table requires (D-750). What this proves
  // is that the floor holds — a package with no case text still reaches `Published`.
  test.setTimeout(600_000)

  const title = suiteName('Title only package')
  const familyKey = familyKeyOf(title)

  await signInAs(page, 'editor')

  await page.goto('/packages/new')
  await page.getByLabel('Title', { exact: true }).fill(title)
  await expect(page.getByLabel('Family key')).toHaveValue(familyKey)
  // Deliberately nothing else: no concepts, no case, no licence, no scenario text.
  await page.getByRole('button', { name: 'Generate', exact: true }).click()

  await page.waitForURL(/\/packages\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}\/generation$/, {
    timeout: 60_000,
  })
  const versionPath = new URL(page.url()).pathname.replace(/\/generation$/, '')

  await expect(
    page.getByRole('heading', { level: 2, name: 'Every package rule is met' }),
  ).toBeVisible({ timeout: 180_000 })
  await expectsNoRuleCodes(page)

  await page.getByRole('link', { name: 'Open confirmation workspace' }).click()
  await page.waitForURL(`**${versionPath}/confirm`)

  // One press. Nothing has been decided on, and the publish confirms every one of them (D-752).
  const progress = page.locator('[data-slot="progress-value"]')
  await expect(progress).toContainText('0 of ')
  await page.getByRole('button', { name: 'Confirm and publish' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Confirm and publish' }).click()
  await expect(page.getByText('Version 1 is published.')).toBeVisible({ timeout: 60_000 })

  // The shelf is where an instructor reads the status, so it is where the word has to be right.
  await page.goto('/packages')
  const row = page.getByRole('row', { name: new RegExp(title) })
  await expect(row).toContainText('Published')

  // And the seed record says what the package is: the author's own material, with no outside
  // licence relied on (FR-028, D-751).
  await page.goto(versionPath)
  await expect(page.locator('#authoring-record')).toContainText('Original material authored in')

  await signOut(page)
})
