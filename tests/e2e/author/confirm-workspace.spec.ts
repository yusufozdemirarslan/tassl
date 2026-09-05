// Step 5.5, UI-043 (FR-192, FR-027, FR-198): the room where an author signs a scenario package
// element by element, and the two refusals and one freeze that make the signature mean something.
//
// One journey, because confirmation is one sitting: a package arrives, every element is read and
// decided, the teaching note is ticked, and the version is frozen for good. The three states the
// service answers by name are all on the way through it rather than staged apart —
//
//   `ELEMENTS_UNCONFIRMED`   pressed with ninety-three elements still undecided,
//   `TEACHING_NOTE_UNCHECKED` pressed with every one of them decided and the check untouched,
//   `VERSION_FROZEN`          asked for an edit after the confirmation.
//
// — and the last is asked of the API rather than the screen, because a frozen screen offers no
// control to press: `PATCH .../elements/brief/…` is the exchange the editor would have made, and a
// 409 is the only honest proof that the freeze is the service's and not the page's.
//
// The package is the Meridian Roast fixture imported under a family key of this run's own. It is
// the quickest complete package there is — importing it is the same exchange the import dialog
// makes, and that dialog is proven in ./packages.spec.ts, so this spec calls the endpoint and
// spends its time on the workspace instead. `confirmOnImport` is deliberately not sent: an import
// that signed its own elements would leave nothing here to confirm.
//
// Ninety-three elements is not a number this spec invents; it is what `elementUnits` makes of the
// document, computed below from the document itself, and it is why the timeout is raised: each
// decision is a server action that revalidates the page it was made on.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { suiteName } from '../fixture-package'
import { axe, expect, signInAs, signOut, test } from '../fixtures'
// The institution the seat belongs to, read the way every spec that needs it reads it.
import { walkthroughOrgId } from '../instructor/api'

/** The fixture the seed imports (06 §5 item 4); this spec imports it a second time as its own. */
const FIXTURE_PATH = join(
  process.cwd(),
  'src',
  'server',
  'db',
  'fixtures',
  'meridian-roast.package.json',
)

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
const WRITE_HEADERS = { 'content-type': 'application/json', 'X-Requested-With': 'tassl' } as const

/** A singleton element has no row id; the routes address it with the all-zero uuid (07 §6). */
const SINGLETON_ELEMENT_ID = '00000000-0000-0000-0000-000000000000'

/** Only the parts this spec counts or rewrites are named; the rest of the export travels whole. */
type PackageExportDocument = Record<string, unknown> & {
  package: { title: string; familyKey: string }
  documents: unknown[]
  stakeholders: unknown[]
  answerSpacePositions: unknown[]
  namedFields: unknown[]
  claims: unknown[]
  variants: { claimStates: unknown[] }[]
  defenseQuestions: unknown[]
  readinessItems: unknown[]
}

/**
 * Every element `elementUnits` makes of this document, which is one decision each (10 §4).
 *
 * The seven are the version's singletons: the brief, the Sycophancy Probe, the Turn, the debrief
 * counterfactual, the general escalation reply, the clock and difficulty, and the seed record. The
 * fixture carries all seven, so they are counted flatly; an arithmetic that disagreed with the
 * screen's own "N of M" would fail the first assertion below rather than pass quietly.
 */
function elementCount(document: PackageExportDocument): number {
  const singletons = 7
  return (
    singletons +
    document.documents.length +
    document.stakeholders.length +
    document.answerSpacePositions.length +
    document.namedFields.length +
    document.claims.length +
    document.variants.reduce((total, variant) => total + variant.claimStates.length, 0) +
    document.defenseQuestions.length +
    document.readinessItems.length
  )
}

/** The family key `SeedForm` derives from a title, for titles of ASCII words and digits. */
const familyKeyOf = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, '-')

type ImportedPackage = { packageId: string; versionId: string }

/**
 * The fixture as a package of this institution's own: a new family key and title, everything else
 * untouched, and no `confirmOnImport` — the elements arrive as drafts waiting for a decision.
 */
async function importFixture(page: Page, title: string): Promise<ImportedPackage> {
  const document = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as PackageExportDocument
  const orgId = await walkthroughOrgId(page)
  const response = await page.request.post(`/api/v1/institutions/${orgId}/packages/import`, {
    data: {
      ...document,
      package: { ...document.package, familyKey: familyKeyOf(title), title },
    },
    headers: WRITE_HEADERS,
  })
  expect(response.status(), await response.text()).toBe(201)
  const imported = (await response.json()) as ImportedPackage & { validation: { ok: boolean } }
  // The document passes every rule of the table, so nothing below is confirming a broken package.
  expect(imported.validation.ok).toBe(true)
  return { packageId: imported.packageId, versionId: imported.versionId }
}

const NEW_TITLE = 'Quarterly acquisition cohort table (rechecked)'

test('an instructor confirms every element of a package and freezes the version', async ({
  page,
}) => {
  // Ninety-three decisions, each one a server action that revalidates the page it was made on.
  // The assertions are unchanged; only the patience (D-188).
  test.setTimeout(300_000)

  const title = suiteName('Confirm workspace package')
  const total = elementCount(
    JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as PackageExportDocument,
  )

  await signInAs(page, 'instructor')
  const { packageId, versionId } = await importFixture(page, title)
  const versionPath = `/packages/${packageId}/versions/${versionId}`

  // ------------------------------------------------------------------------------------------
  // The workspace as it opens: nothing decided, every rule already met
  // ------------------------------------------------------------------------------------------

  await page.goto(`${versionPath}/confirm`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(
    page.getByText(
      'Read each element, edit what needs it, and record a decision. When every element has a ' +
        'decision, the teaching-note check is ticked and the package rules pass, version 1 can be ' +
        'confirmed — and is then frozen for good.',
    ),
  ).toBeVisible()

  const progress = page.locator('[data-slot="progress-value"]')
  await expect(page.getByRole('heading', { level: 2, name: 'Confirming version 1' })).toBeVisible()
  await expect(progress).toHaveText(`0 of ${String(total)} confirmed`)
  await expect(page.getByText(`${String(total)} left to decide`)).toBeVisible()
  // The import met every rule, so the workspace has nothing to say about the package itself.
  await expect(page.getByText('Rules this package does not meet yet')).toHaveCount(0)

  // The tree is the roster of what has to be decided, group by group, each saying how far it has
  // got. The brief is the first undecided element, so the editor opens on it.
  const tree = page.getByRole('tree', { name: 'Elements of this version' })
  // A group is named with its progress, so these match the label the name starts with.
  const documents = tree.getByRole('treeitem', { name: /^Documents/ })
  await expect(documents).toContainText('0 of 9')
  await expect(tree.getByRole('treeitem', { name: /^Claims/ })).toContainText('0 of 24')
  await expect(page.getByRole('heading', { level: 2, name: 'Brief' })).toBeVisible()

  // ------------------------------------------------------------------------------------------
  // FR-192: the version cannot be confirmed while an element is undecided
  // ------------------------------------------------------------------------------------------

  const confirmVersion = page.getByRole('button', { name: 'Confirm version' })
  await confirmVersion.click()

  // The dialog says what is about to be signed before it is signed, and its counts are the ones the
  // screen is showing: nothing is decided yet, and the rules cannot pass on an untouched draft.
  const confirmDialog = page.getByRole('alertdialog')
  await expect(confirmDialog).toContainText('Confirm version 1?')
  await expect(confirmDialog).toContainText(`0 of ${String(total)} decided`)
  await expect(confirmDialog).toContainText('Not checked yet')
  await confirmDialog.getByRole('button', { name: 'Confirm and freeze' }).click()

  await expect(
    page.getByText('Every element needs a decision before the version can be confirmed.'),
  ).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Waiting on a decision' })).toBeVisible()
  // The refusal names every element it is refusing for, and each name is the way to that element.
  const waitingForD5 = page.getByRole('button', { name: 'D5', exact: true })
  await expect(waitingForD5).toBeVisible()
  await expect(progress).toHaveText(`0 of ${String(total)} confirmed`)

  // The draft workspace with a refusal on it, an element open and the decision bar under it
  // (NFR-012). The confirmed twin of this screen is scanned in ../a11y/author.spec.ts.
  await axe(page)

  // ------------------------------------------------------------------------------------------
  // An edit is a decision (10 §4): saving one records `edited` against the element
  // ------------------------------------------------------------------------------------------

  await waitingForD5.click()
  await expect(page.getByRole('heading', { level: 2, name: 'Document · D5' })).toBeVisible()

  await page.getByLabel('Title', { exact: true }).fill(NEW_TITLE)
  await page.getByRole('button', { name: 'Save edits' }).click()
  await expect(page.getByText('D5 saved. The edit is recorded as its decision.')).toBeVisible()
  await expect(page.locator('#element-editor')).toContainText('Edited')
  await expect(progress).toHaveText(`1 of ${String(total)} confirmed`)
  // The tree reads the title that was just saved — the row names the element by what it now says,
  // under the key it is filed by — and the package has changed, so the refusal the last press
  // earned is no longer what it would be refused for.
  await expect(tree.getByRole('treeitem', { name: `${NEW_TITLE} D5` })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Waiting on a decision' })).toHaveCount(
    0,
  )

  // ------------------------------------------------------------------------------------------
  // Every remaining element, one decision at a time
  // ------------------------------------------------------------------------------------------

  const confirmElement = page.getByRole('button', { name: 'Confirm', exact: true })
  const nextUndecided = page.getByRole('button', { name: 'Next undecided element' })

  // A decision moves to the next element still waiting, so the loop is one press per element: the
  // author signs sixty-odd of these in a sitting, and returning to the tree between each one was
  // the difference between a review and a chore. The header button is the way back into the queue
  // after wandering off it, which is why it is pressed once here and asserted gone at the end.
  await nextUndecided.click()
  for (let decided = 2; decided <= total; decided += 1) {
    await confirmElement.click()
    await expect(progress).toHaveText(`${String(decided)} of ${String(total)} confirmed`)
  }

  await expect(page.getByText('Every element has a decision.')).toBeVisible()
  await expect(nextUndecided).toHaveCount(0)
  await expect(documents).toContainText('9 of 9')

  // ------------------------------------------------------------------------------------------
  // FR-027: and not while the teaching-note check is untouched
  // ------------------------------------------------------------------------------------------

  const teachingNote = page.getByRole('checkbox', {
    name: 'Teaching note checked against the answer space and claims',
  })
  await expect(teachingNote).not.toBeChecked()
  await confirmVersion.click()
  // Every element is decided now, and the dialog says so — and says the one thing still missing.
  await expect(confirmDialog).toContainText(`${String(total)} of ${String(total)} decided`)
  await expect(confirmDialog).toContainText('Not checked yet')
  await confirmDialog.getByRole('button', { name: 'Confirm and freeze' }).click()
  await expect(page.getByText('Confirm you have read the teaching note first.')).toBeVisible()
  // The refusal is about one control, so the refusal puts the author on it.
  await expect(teachingNote).toBeFocused()

  // ------------------------------------------------------------------------------------------
  // The confirmation, and the freeze it is
  // ------------------------------------------------------------------------------------------

  await teachingNote.check()
  await confirmVersion.click()
  // The last reading before the version is frozen: everything decided, the note checked, the rules
  // met. This is the press the screen calls irreversible, and it is asked for twice on purpose.
  await expect(confirmDialog).toContainText('Checked against the answer space and the claims')
  await expect(confirmDialog).toContainText('All met')
  await confirmDialog.getByRole('button', { name: 'Confirm and freeze' }).click()
  await expect(page.getByText('Version 1 is confirmed and frozen.')).toBeVisible()

  // Nothing on the screen invites an edit the service has already stopped taking.
  await expect(confirmVersion).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save edits' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0)
  await expect(page.locator('#element-editor')).toContainText('Frozen')
  await expect(
    page.getByText(
      'This element is part of a confirmed version. It is shown as it was signed and cannot be ' +
        'edited.',
    ),
  ).toBeVisible()
  await expect(
    page.locator('#confirm-progress').getByRole('link', { name: 'Back to version 1' }),
  ).toBeVisible()

  // And it is the record after a reload, not a state the browser was holding.
  await page.reload()
  await expect(page.getByText(/^Version 1 was confirmed on /)).toBeVisible()
  await expect(progress).toHaveText(`${String(total)} of ${String(total)} confirmed`)
  const brief = page.getByLabel('The brief a student reads')
  await expect(brief).toHaveAttribute('readonly', '')
  await expect(page.getByRole('button', { name: 'Save edits' })).toHaveCount(0)

  // ------------------------------------------------------------------------------------------
  // VERSION_FROZEN: the edit the editor would have made is refused by the service
  // ------------------------------------------------------------------------------------------

  const refused = await page.request.patch(
    `/api/v1/package-versions/${versionId}/elements/brief/${SINGLETON_ELEMENT_ID}`,
    {
      data: { brief: 'A brief the confirmation was never signed against.' },
      headers: WRITE_HEADERS,
    },
  )
  expect(refused.status()).toBe(409)
  expect((await refused.json()) as { error: { code: string } }).toMatchObject({
    error: { code: 'VERSION_FROZEN' },
  })

  // The brief on the screen is still the one that was signed.
  await page.reload()
  await expect(page.getByLabel('The brief a student reads')).not.toHaveValue(
    'A brief the confirmation was never signed against.',
  )

  await signOut(page)
})
