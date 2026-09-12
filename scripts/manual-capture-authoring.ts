/**
 * The authoring lane of the manual capture (see scripts/manual-capture.ts).
 *
 *   pnpm exec tsx scripts/manual-capture-authoring.ts
 *
 * Builds a scenario package from a seed case on the scripted assistant and captures every screen on
 * the way: the form, the generation steps, the confirmation workspace while elements are still
 * undecided, one element rejected and rewritten, one edited, the confirmation dialog, and the frozen
 * version. It does it twice — once as the instructor, who may freeze a version, and once as the
 * scenario editor seat, which may do everything except freeze one — so the manual can show both.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Locator, type Page } from '@playwright/test'

const BASE = process.env.MANUAL_BASE_URL ?? 'http://localhost:3000'
const PASSWORD = process.env.SEED_PASSWORD ?? 'Walkthrough-Pass-2026'
const SHOT_ROOT = join(process.cwd(), 'docs', 'manual', 'screenshots')
const TEXT_ROOT = process.env.MANUAL_TEXT_DIR ?? join(process.cwd(), '.manual-text')

let role = 'instructor'
const captured: string[] = []
const problems: string[] = []

async function shot(page: Page, name: string, show?: Locator): Promise<void> {
  const shots = join(SHOT_ROOT, role)
  const texts = join(TEXT_ROOT, role)
  mkdirSync(shots, { recursive: true })
  mkdirSync(texts, { recursive: true })
  await page.waitForTimeout(600)
  if (show) {
    try {
      await show.first().scrollIntoViewIfNeeded({ timeout: 5000 })
      await page.waitForTimeout(300)
    } catch {
      problems.push(`${role}/${name}: could not scroll to the named element`)
    }
  }
  await page.screenshot({
    path: join(shots, `${name}.png`),
    fullPage: false,
    animations: 'disabled',
  })
  const text = await page
    .locator('body')
    .innerText()
    .catch(() => '')
  const aria = await page
    .locator('body')
    .ariaSnapshot()
    .catch(() => '')
  const title = await page.title().catch(() => '')
  writeFileSync(
    join(texts, `${name}.txt`),
    `URL: ${page.url()}\nTITLE: ${title}\n${'='.repeat(70)}\nTEXT\n${'='.repeat(70)}\n${text}\n${'='.repeat(70)}\nARIA\n${'='.repeat(70)}\n${aria}\n`,
    'utf8',
  )
  captured.push(`${role}/${name}`)
  console.log(`  shot ${role}/${name}  <- ${page.url()}`)
}

async function signIn(page: Page, seat: string): Promise<void> {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email address').fill(`${seat}@tassl.local`)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 60_000 })
  await page.waitForTimeout(800)
  console.log(`  signed in as ${seat}@tassl.local`)
}

const SEED_TEXT =
  'Manual seed case text for the user manual capture. The company sells subscription coffee in two tiers and is deciding where next quarter acquisition spend should go. '.repeat(
    6,
  )

/** Fill and submit the New package from a seed case form. Returns the generation screen's URL. */
async function createPackage(page: Page, title: string, prefix: string): Promise<void> {
  await page.goto(`${BASE}/packages/new`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await shot(page, `${prefix}-new-form`)

  await page.getByLabel('Title').first().fill(title)
  await page.waitForTimeout(600)
  await shot(page, `${prefix}-new-family-key`)

  await page.getByLabel('Concepts').fill('payback, retention, acquisition, pricing')
  await page.waitForTimeout(300)
  const add = page.getByRole('button', { name: 'Add', exact: true }).first()
  if (await add.isVisible().catch(() => false)) {
    await add.click()
    await page.waitForTimeout(700)
    await shot(page, `${prefix}-new-concepts-added`)
  } else {
    problems.push(`${role}: no Add button beside Concepts`)
  }

  await page.getByLabel('Case title').fill('Manual seed case')
  await page.getByLabel('Publisher').fill('Manual Press')
  await page.getByLabel('License terms').fill('Manual license terms permit adaptation.')
  const permits = page.getByRole('checkbox', { name: 'The license permits adaptation' })
  if (await permits.isVisible().catch(() => false)) {
    await permits.check()
    await page.waitForTimeout(500)
    await shot(page, `${prefix}-new-license`)
  } else {
    problems.push(`${role}: no "The license permits adaptation" checkbox`)
  }
  await page.getByLabel('Seed case text').fill(SEED_TEXT)
  await page.waitForTimeout(600)
  await shot(page, `${prefix}-new-filled`)

  await page.getByRole('button', { name: 'Create and generate' }).click()
  await page.waitForURL(/\/generation$/, { timeout: 120_000 })
  await page.waitForTimeout(1500)
  await shot(page, `${prefix}-generation-running`)

  // The seven steps finish on the scripted provider in well under two minutes.
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(4000)
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
    const done = page.getByRole('link', { name: 'Open confirmation workspace' })
    if (await done.isVisible().catch(() => false)) break
  }
  await page.waitForTimeout(900)
  await shot(page, `${prefix}-generation-done`)
}

/** The confirmation workspace, from first open to a decision on every element. */
async function confirmWorkspace(page: Page, prefix: string, freeze: boolean): Promise<void> {
  const openWorkspace = page.getByRole('link', { name: 'Open confirmation workspace' })
  if (await openWorkspace.isVisible().catch(() => false)) {
    await openWorkspace.click()
    await page.waitForURL(/\/confirm$/, { timeout: 60_000 })
  } else {
    problems.push(`${role}: no "Open confirmation workspace" link`)
    return
  }
  await page.waitForTimeout(2000)
  await shot(page, `${prefix}-workspace`)

  // The element tree and one document element.
  const elements = page
    .getByRole('region', { name: 'Elements' })
    .or(page.locator('#elements'))
    .first()
  await shot(page, `${prefix}-workspace-elements`, elements)

  const documents = page.getByRole('treeitem', { name: /^Documents/ }).first()
  if (await documents.isVisible().catch(() => false)) {
    await documents.click()
    await page.waitForTimeout(1200)
    await shot(page, `${prefix}-workspace-documents-open`, documents)
  }
  const d1 = page.getByRole('treeitem', { name: /^D1\b/ }).first()
  if (await d1.isVisible().catch(() => false)) {
    await d1.click()
    await page.waitForTimeout(1800)
    await shot(page, `${prefix}-element-document`)
  } else {
    problems.push(`${role}: no D1 element in the tree`)
  }

  // Reject, with its note.
  const reject = page.getByRole('button', { name: 'Reject', exact: true }).first()
  if (await reject.isVisible().catch(() => false)) {
    await reject.click()
    await page.waitForTimeout(1000)
    await shot(page, `${prefix}-element-reject`)
    const why = page.getByLabel('Why this element is rejected')
    if (await why.isVisible().catch(() => false)) {
      await why.fill('Manual rejection. The dateline reads as an internal memo.')
      await page.waitForTimeout(400)
      await page.getByRole('button', { name: 'Reject element' }).click()
      await page.waitForTimeout(2500)
      await shot(page, `${prefix}-element-rejected`)
    }
  } else {
    problems.push(`${role}: no Reject button on the element`)
  }

  // Rewrite the rejected element.
  const rewrite = page.getByRole('button', { name: 'Rewrite', exact: true }).first()
  if (await rewrite.isVisible().catch(() => false)) {
    await rewrite.click()
    await page.waitForTimeout(1000)
    await shot(page, `${prefix}-element-rewrite`)
    const every = page.getByRole('button', { name: /^Rewrite every/ }).first()
    if (await every.isVisible().catch(() => false)) {
      await every.click()
      await page.waitForTimeout(6000)
      await shot(page, `${prefix}-element-rewritten`)
    }
  }

  // Edit and save one element.
  const d2 = page.getByRole('treeitem', { name: /^D2\b/ }).first()
  if (await d2.isVisible().catch(() => false)) {
    await d2.click()
    await page.waitForTimeout(1500)
    const titleField = page.getByLabel('Title').first()
    if (await titleField.isVisible().catch(() => false)) {
      await titleField.fill('Manual document title')
      await page.waitForTimeout(400)
      await page.getByRole('button', { name: 'Save edits' }).click()
      await page.waitForTimeout(2500)
      await shot(page, `${prefix}-element-edited`)
    }
  }

  // Decide everything that is left: confirm the open element, then move to the next undecided one.
  const usable = async (locator: Locator): Promise<boolean> =>
    (await locator.isVisible().catch(() => false)) && (await locator.isEnabled().catch(() => false))
  for (let i = 0; i < 300; i += 1) {
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true }).first()
    const next = page.getByRole('button', { name: 'Next undecided element' }).first()
    if (await usable(confirm)) {
      await confirm.click()
      await page.waitForTimeout(700)
      if (i === 0) await shot(page, `${prefix}-element-confirmed`)
      continue
    }
    if (await usable(next)) {
      await next.click()
      await page.waitForTimeout(700)
      continue
    }
    break
  }
  await page.waitForTimeout(1200)
  await shot(page, `${prefix}-workspace-all-decided`)

  const note = page.getByRole('checkbox', {
    name: 'Teaching note checked against the answer space and claims',
  })
  if (await note.isVisible().catch(() => false)) {
    await note.check().catch(() => undefined)
    await page.waitForTimeout(600)
    await shot(page, `${prefix}-teaching-note-checked`)
  }

  const confirmVersion = page.getByRole('button', { name: 'Confirm version' }).first()
  if (await confirmVersion.isVisible().catch(() => false)) {
    await confirmVersion.click()
    await page.waitForTimeout(1500)
    await shot(page, `${prefix}-confirm-version-dialog`)
    if (freeze) {
      const freezeButton = page.getByRole('button', { name: 'Confirm and freeze' })
      if (await freezeButton.isVisible().catch(() => false)) {
        await freezeButton.click()
        await page.waitForTimeout(4000)
        await shot(page, `${prefix}-version-frozen`)
        const back = page.getByRole('link', { name: 'Back to version 1' }).first()
        if (await back.isVisible().catch(() => false)) {
          await back.click()
          await page.waitForTimeout(2500)
          await shot(page, `${prefix}-version-confirmed`)
        }
      }
    } else {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(700)
      await shot(page, `${prefix}-confirm-version-refused`)
    }
  } else {
    problems.push(`${role}: no "Confirm version" button in the workspace`)
    await shot(page, `${prefix}-confirm-version-absent`)
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(45_000)

  role = 'instructor'
  await signIn(page, 'instructor')
  await createPackage(page, process.env.MANUAL_PKG_TITLE ?? 'Manual authoring package', 'authoring')
  await confirmWorkspace(page, 'authoring', true)

  await context.clearCookies()
  role = 'editor'
  await signIn(page, 'editor')
  await createPackage(
    page,
    process.env.MANUAL_PKG_TITLE_EDITOR ?? 'Manual editor package',
    'authoring',
  )
  await confirmWorkspace(page, 'authoring', false)

  await browser.close()
  console.log(`\ncaptured ${String(captured.length)} screens`)
  if (problems.length > 0) {
    console.log(`\n${String(problems.length)} problems:`)
    for (const line of problems) console.log(`  - ${line}`)
  }
}

void main()
