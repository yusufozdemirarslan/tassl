// Step 5.5, UI-043 (FR-192, FR-027, FR-198; D-752): the room where an author reads a scenario
// package, and the refusal and the freeze that make publishing it mean something.
//
// One journey, because a review is one sitting: a package arrives, elements are read, edited and
// rejected, and one press publishes it. The two states the service answers by name are on the way
// through it rather than staged apart —
//
//   `ELEMENTS_UNCONFIRMED`  pressed while an element the author *rejected* is still waiting,
//   `VERSION_FROZEN`        asked for an edit after the publish.
//
// — and the last is asked of the API rather than the screen, because a frozen screen offers no
// control to press: `PATCH .../elements/brief/…` is the exchange the editor would have made, and a
// 409 is the only honest proof that the freeze is the service's and not the page's.
//
// What this spec no longer does is press Confirm ninety-three times. D-752 made the publish itself
// the confirmation of every element nobody decided on, with the attestation stated in the dialog
// that stands for it — so what is proved here is the *distinction* the press keeps: an element left
// alone is swept up, an element rejected is not, and an element edited carries the decision its
// edit already made.
//
// The package is the Meridian Roast fixture imported under a family key of this run's own. It is
// the quickest complete package there is — importing it is the same exchange the import dialog
// makes, and that dialog is proven in ./packages.spec.ts, so this spec calls the endpoint and
// spends its time on the workspace instead. `confirmOnImport` is deliberately not sent: an import
// that signed its own elements would leave nothing here to read.
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

test('a scenario editor reads a package, rejects one element, and publishes the version', async ({
  page,
}) => {
  // Each decision is a server action that revalidates the page it was made on. The assertions are
  // unchanged; only the patience (D-188).
  test.setTimeout(300_000)

  // The outcomes of "Confirm and publish" get a stated wait of their own (D-730).
  //
  // `confirmVersion` reads the whole version and every confirmation before it can say which of the
  // three answers is the true one, and on the way through it validates the package and builds the
  // export snapshot that has to ride with the transition. Measured on this suite's own server, with
  // its two workers on one Postgres: 207, 452, 712, 1276, 1430, 1827 and 4200 ms across a run. The
  // default five seconds is under the top of that range, so the assertion was failing on a press
  // that had been made and was still being answered — a measurement of the machine, not of the
  // screen. This is what the act costs; the number is written down rather than made to disappear.
  const CONFIRM_ANSWER_MS = 20_000

  const title = suiteName('Confirm workspace package')
  const total = elementCount(
    JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as PackageExportDocument,
  )

  await signInAs(page, 'editor')
  const { packageId, versionId } = await importFixture(page, title)
  const versionPath = `/packages/${packageId}/versions/${versionId}`

  // ------------------------------------------------------------------------------------------
  // The workspace as it opens: nothing decided, every rule already met
  // ------------------------------------------------------------------------------------------

  await page.goto(`${versionPath}/confirm`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(
    page.getByText(
      'Read what was drafted, edit what needs it, and reject anything that has to be written ' +
        'again. Publishing version 1 confirms everything you have not already decided on, makes ' +
        'it assignable, and freezes it for good.',
    ),
  ).toBeVisible()

  const progress = page.locator('[data-slot="progress-value"]')
  await expect(page.getByRole('heading', { level: 2, name: 'Confirming version 1' })).toBeVisible()
  await expect(progress).toHaveText(`0 of ${String(total)} confirmed`)
  await expect(page.getByText(`${String(total)} left to decide`)).toBeVisible()
  // Rules are a server-side guarantee and their codes are not this screen's vocabulary (D-750).
  await expect(page.getByText('Rules this package does not meet yet')).toHaveCount(0)
  expect((await page.locator('body').innerText()).toUpperCase()).not.toContain('PACKAGE_INVALID')

  // The tree is the roster of what has to be decided, group by group, each saying how far it has
  // got. The brief is the first undecided element, so the editor opens on it.
  const tree = page.getByRole('tree', { name: 'Elements of this version' })
  // A group is named with its progress, so these match the label the name starts with.
  const documents = tree.getByRole('treeitem', { name: /^Documents/ })
  await expect(documents).toContainText('0 of 9')
  await expect(tree.getByRole('treeitem', { name: /^Claims/ })).toContainText('0 of 24')
  await expect(page.getByRole('heading', { level: 2, name: 'Brief' })).toBeVisible()

  // ------------------------------------------------------------------------------------------
  // FR-192, D-752: an element the author rejected keeps the version from being published
  // ------------------------------------------------------------------------------------------

  if ((await documents.getAttribute('aria-expanded')) === 'false') await documents.click()
  const openD5 = tree.getByRole('treeitem', { name: /\bD5\b/ }).first()
  await openD5.click()
  await expect(page.getByRole('heading', { level: 2, name: 'Document · D5' })).toBeVisible()
  await page.getByRole('button', { name: 'Reject', exact: true }).click()
  await page
    .getByLabel('Why this element is rejected')
    .fill('The table is a quarterly cohort read; it should say which quarter.')
  await page.getByRole('button', { name: 'Reject element' }).click()
  await expect(page.getByText('D5 rejected.')).toBeVisible()

  const confirmVersion = page.getByRole('button', { name: 'Confirm and publish' })
  await confirmVersion.click()

  // The dialog says what is about to be signed before it is signed: how many elements have a
  // decision, how many were rejected, and what the press itself attests to.
  const confirmDialog = page.getByRole('alertdialog')
  await expect(confirmDialog).toContainText('Publish version 1?')
  // A rejection is not a decision the progress counts: it is work sent back.
  await expect(confirmDialog).toContainText(`0 of ${String(total)} decided`)
  await expect(confirmDialog).toContainText('1 of them')
  await expect(confirmDialog).toContainText(
    'Every element you have not already decided on is confirmed as read by this press',
  )
  await confirmDialog.getByRole('button', { name: 'Confirm and publish' }).click()

  await expect(
    page.getByText('An element you rejected is still waiting to be re-read.'),
  ).toBeVisible({ timeout: CONFIRM_ANSWER_MS })
  await expect(
    page.getByRole('heading', { level: 3, name: 'Rejected and waiting to be re-read' }),
  ).toBeVisible()
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

  // The rejection is answered by re-reading the element and editing it: an edit *is* a decision
  // (10 §4), so saving one lifts the refusal without a separate press.
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
  await expect(
    page.getByRole('heading', { level: 3, name: 'Rejected and waiting to be re-read' }),
  ).toHaveCount(0)

  // ------------------------------------------------------------------------------------------
  // One element read on purpose, and then the one press that publishes the rest (D-752)
  // ------------------------------------------------------------------------------------------

  const nextUndecided = page.getByRole('button', { name: 'Next undecided element' })
  await nextUndecided.click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(progress).toHaveText(`2 of ${String(total)} confirmed`)

  await confirmVersion.click()
  // The last reading before the version is frozen: what has been decided, and what this press
  // stands for. It is the press the screen calls irreversible, and it is asked for twice on
  // purpose.
  await expect(confirmDialog).toContainText(`2 of ${String(total)} decided`)
  await expect(confirmDialog).toContainText(
    'Every element you have not already decided on is confirmed as read by this press',
  )
  await confirmDialog.getByRole('button', { name: 'Confirm and publish' }).click()
  await expect(page.getByText('Version 1 is published.')).toBeVisible({
    timeout: CONFIRM_ANSWER_MS,
  })

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
