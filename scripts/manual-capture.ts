/**
 * Screenshot and on-screen-text capture for docs/manual (one-off tooling, not part of a test lane).
 *
 *   pnpm exec tsx scripts/manual-capture.ts <lane> [...]
 *
 * Drives a running local production build at MANUAL_BASE_URL (default http://localhost:3000) with a
 * real sign-in per seat, walks every screen that seat can reach, and for each stop writes
 *
 *   docs/manual/screenshots/<role>/<name>.png  — 1440x900, the image the manual embeds
 *   <MANUAL_TEXT_DIR>/<role>/<name>.txt        — the page's visible text and its accessible tree,
 *                                                so the manual is written from what is on screen
 *
 * Lanes: public instructor instructor-extra admin editor learner ta lead
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Locator, type Page } from '@playwright/test'

const BASE = process.env.MANUAL_BASE_URL ?? 'http://localhost:3000'
const PASSWORD = process.env.SEED_PASSWORD ?? 'Walkthrough-Pass-2026'
const SHOT_ROOT = join(process.cwd(), 'docs', 'manual', 'screenshots')
const TEXT_ROOT = process.env.MANUAL_TEXT_DIR ?? join(process.cwd(), '.manual-text')

let role = 'shared'
let page: Page
let context: BrowserContext
const captured: string[] = []
const problems: string[] = []

function setRole(next: string): void {
  role = next
}

function dirs(): { shots: string; texts: string } {
  const shots = join(SHOT_ROOT, role)
  const texts = join(TEXT_ROOT, role)
  mkdirSync(shots, { recursive: true })
  mkdirSync(texts, { recursive: true })
  return { shots, texts }
}

async function shot(name: string, show?: Locator): Promise<void> {
  const { shots, texts } = dirs()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(700)
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

async function visit(name: string, path: string, show?: Locator): Promise<void> {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(1200)
  await shot(name, show)
}

async function signIn(seat: string): Promise<void> {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email address').fill(seat.includes('@') ? seat : `${seat}@tassl.local`)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 60_000 })
  await page.waitForTimeout(900)
  console.log(`  signed in as ${seat} -> ${page.url()}`)
}

async function signOutIfSignedIn(): Promise<void> {
  await context.clearCookies()
}

async function hrefMatching(pattern: RegExp): Promise<string | null> {
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href') ?? ''),
    )
  return hrefs.find((href) => pattern.test(href)) ?? null
}

async function dismissOverlays(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const open =
      (await page.getByRole('menu').count()) +
      (await page.getByRole('listbox').count()) +
      (await page.getByRole('dialog').count()) +
      (await page.getByRole('alertdialog').count()) +
      (await page.locator('[data-base-ui-inert]').count())
    if (open === 0) return
  }
  await page.mouse.click(5, 5).catch(() => undefined)
  await page.waitForTimeout(400)
}

/** Click a control by accessible name and capture what it opened. */
async function open(
  name: RegExp | string,
  shotName: string,
  kind: 'button' | 'link' = 'button',
): Promise<boolean> {
  const control = page.getByRole(kind, { name }).first()
  if (!(await control.isVisible().catch(() => false))) {
    problems.push(`${role}: no ${kind} "${String(name)}" for ${shotName}`)
    return false
  }
  await control.click()
  await page.waitForTimeout(1200)
  await shot(shotName)
  return true
}

// ---------------------------------------------------------------------------------------------

const SEEDED = {
  course: '/courses/0afcf506-675b-4153-9f73-5b1c2f20ec01',
  walkthroughAssignment: '/assignments/3c51a5b1-dcd2-455e-b30b-3108762a4d70',
  autoLockAssignment: '/assignments/6d9eca91-0088-45b5-8bec-b16a934897f7',
  packageVersion:
    '/packages/55793a92-4cb5-4640-af77-ed161a4a08a1/versions/aa2b4644-5be2-43d5-a7b4-d3f55673cfc6',
}

async function publicLane(): Promise<void> {
  setRole('shared')
  await visit('sign-in', '/sign-in')
  await visit('sign-up', '/sign-up')
  await visit('forgot-password', '/forgot-password')
  await visit('reset-password-invalid', '/reset-password?token=not-a-real-token')
  await visit('verify-email-invalid', '/verify-email?token=not-a-real-token')
  await visit('privacy', '/privacy')
  await visit('terms', '/terms')

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email address').fill('not-an-email')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForTimeout(1600)
  await shot('sign-in-validation')

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email address').fill('instructor@tassl.local')
  await page.getByLabel('Password', { exact: true }).fill('Definitely-Not-The-Password-1')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForTimeout(3500)
  await shot('sign-in-wrong-password')

  await page.goto(`${BASE}/sign-up`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email address').fill('nope')
  await page.getByLabel('Password', { exact: true }).fill('short')
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.waitForTimeout(1600)
  await shot('sign-up-validation')

  await visit('not-found', '/this-page-does-not-exist')
  await visit('signed-out-redirect', '/admin/users')
}

async function shellFor(label: string): Promise<void> {
  setRole(label)
  await visit('home', '/home')
  await open(/^Account:/, 'account-menu')
  await dismissOverlays()
  await visit('notifications', '/notifications')
  await visit('settings', '/settings')
  await visit('settings-security', '/settings/security')
  await visit('settings-data', '/settings/data')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await shot('home-mobile')
  await page.setViewportSize({ width: 1440, height: 900 })
}

async function instructorLane(): Promise<void> {
  await signIn('instructor')
  await shellFor('instructor')
  setRole('instructor')

  await visit('courses', '/courses')
  await open('New course', 'course-new-dialog')
  await dismissOverlays()

  await visit('course-sections', `${SEEDED.course}?tab=sections`)
  await open('New section', 'section-new-dialog')
  await dismissOverlays()
  await visit('course-assignments', `${SEEDED.course}?tab=assignments`)
  await open('New assignment', 'assignment-new-dialog')
  await dismissOverlays()
  await visit('course-policy', `${SEEDED.course}?tab=policy`)
  await visit('course-mapping', `${SEEDED.course}?tab=mapping`)

  const roster = await (async () => {
    await page.goto(`${BASE}${SEEDED.course}?tab=sections`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(900)
    return hrefMatching(/\/sections\/[0-9a-f-]+\/roster$/)
  })()
  if (roster !== null) {
    await visit('roster', roster)
    await open(/Invite/, 'roster-invite-dialog')
    await dismissOverlays()
    await open(/^Remove /, 'roster-remove-dialog')
    await dismissOverlays()
  }

  await visit('assignment', SEEDED.walkthroughAssignment)
  await visit('assignment-exports', `${SEEDED.walkthroughAssignment}/exports`)
  await visit('assignment-autolock', SEEDED.autoLockAssignment)

  await visit('review-queue', '/review')
  await visit('packages', '/packages')
  await visit('package-version', SEEDED.packageVersion)
  await visit('package-claim', `${SEEDED.packageVersion}?claim=C3#claims`)
  await visit('package-confirm', `${SEEDED.packageVersion}/confirm`)
  await visit('package-generation', `${SEEDED.packageVersion}/generation`)
  await visit('packages-new', '/packages/new')
}

/** The replay actions that change a run, captured on the seat that already has a scored run. */
async function instructorExtraLane(): Promise<void> {
  await signIn('instructor')
  setRole('instructor')
  await visit('review-queue-two-runs', '/review')

  // The scored run that demo:reset leaves waiting (Auto-lock test run, Student Two).
  const rows = await page
    .locator('a[href^="/review/runs/"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href') ?? ''),
    )
  const replay = rows[0]
  if (replay === undefined) {
    problems.push('instructor: no run in the review queue for the band-override capture')
    return
  }
  await visit('replay-bands-to-decide', `${replay}?tab=bands`)

  // Override one band: a different level, a note, then the confirm button that names it.
  const framing = page.getByRole('region', { name: 'Framing' }).first()
  const professional = framing.getByRole('radio', { name: 'Professional', exact: true })
  if (await professional.isVisible().catch(() => false)) {
    await professional.check()
    await page.waitForTimeout(800)
    await framing
      .getByLabel('Note for the student (optional)')
      .fill('Manual note: the frame named the load-bearing assumption before the brief did.')
    await page.waitForTimeout(500)
    await shot('replay-band-overridden', framing)
    const confirm = framing.getByRole('button', { name: /^Confirm the draft/ })
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click()
      await page.waitForTimeout(2500)
      await shot('replay-band-confirmed-one', framing)
    }
  } else {
    problems.push('instructor: the Framing band had no level radios')
  }

  await visit('replay-actions-tab', `${replay}?tab=actions`)
  await visit('replay-trace-tab', `${replay}?tab=trace`)
  await visit('replay-package-tab', `${replay}?tab=package`)

  // The run that is already recorded: what a finished review looks like.
  await page.goto(`${BASE}/review`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await shot('review-queue-after-deciding')
}

async function adminLane(): Promise<void> {
  await signIn('admin')
  await shellFor('admin')
  setRole('admin')
  await visit('admin-users', '/admin/users')
  await open(/^(Change|Set|Edit).*role|^Platform role/, 'admin-user-role-control')
  await dismissOverlays()
  await visit('admin-flags', '/admin/flags')
  await visit('admin-audit', '/admin/audit')
  await visit('forbidden-courses', '/courses')
  await visit('forbidden-review', '/review')
  await visit('forbidden-packages', '/packages')
  await visit('forbidden-runs', '/runs')
}

async function editorLane(): Promise<void> {
  await signIn('editor')
  await shellFor('editor')
  setRole('editor')
  await visit('packages', '/packages')
  await visit('packages-new', '/packages/new')
  await visit('package-version', SEEDED.packageVersion)
  await visit('package-claim', `${SEEDED.packageVersion}?claim=C3#claims`)
  await visit('package-confirm', `${SEEDED.packageVersion}/confirm`)
  await visit('package-generation', `${SEEDED.packageVersion}/generation`)
  await visit('forbidden-courses', '/courses')
  await visit('forbidden-review', '/review')
  await visit('forbidden-admin', '/admin/users')
  await visit('forbidden-runs', '/runs')
}

async function learnerLane(): Promise<void> {
  await signIn('student1')
  await shellFor('learner')
  setRole('learner')
  await visit('runs-list', '/runs')
  await visit('forbidden-courses', '/courses')
  await visit('forbidden-review', '/review')
  await visit('forbidden-packages', '/packages')
  await visit('forbidden-admin', '/admin/users')
}

async function taLane(): Promise<void> {
  await signIn('ta')
  await shellFor('teaching-assistant')
  setRole('teaching-assistant')
  await visit('review-queue', '/review')
  const replay = await hrefMatching(/^\/review\/runs\/[0-9a-f-]+$/)
  if (replay !== null) {
    await visit('replay-overview', `${replay}?tab=overview`)
    await visit('replay-bands', `${replay}?tab=bands`)
    await visit('replay-trace', `${replay}?tab=trace`)
    await visit('replay-package', `${replay}?tab=package`)
    await visit('replay-actions', `${replay}?tab=actions`)
  } else {
    problems.push('ta: no replay link in the review queue')
  }
  await visit('forbidden-courses', '/courses')
  await visit('forbidden-packages', '/packages')
  await visit('forbidden-admin', '/admin/users')
  await visit('forbidden-runs', '/runs')
}

async function leadLane(): Promise<void> {
  await signIn('lead')
  await shellFor('program-lead')
  setRole('program-lead')
  await visit('courses', '/courses')
  await visit('course-sections', `${SEEDED.course}?tab=sections`)
  await visit('course-assignments', `${SEEDED.course}?tab=assignments`)
  await visit('course-policy', `${SEEDED.course}?tab=policy`)
  await visit('course-mapping', `${SEEDED.course}?tab=mapping`)
  await visit('assignment', SEEDED.walkthroughAssignment)
  await visit('assignment-exports', `${SEEDED.walkthroughAssignment}/exports`)
  await visit('forbidden-review', '/review')
  await visit('forbidden-packages', '/packages')
  await visit('forbidden-admin', '/admin/users')
  await visit('forbidden-runs', '/runs')
}

/** The Flags screen in full, and the assistant-mode switch as it looks when FEATURE_AI is on. */
async function adminFlagsLane(): Promise<void> {
  await signIn('admin')
  setRole('admin')
  await visit('admin-flags-table', '/admin/flags')
  await visit(
    'admin-flags-provider',
    '/admin/flags',
    page.getByRole('heading', { name: 'Effective model provider' }),
  )
  await visit(
    'admin-flags-assistant-mode-enabled',
    '/admin/flags',
    page.getByRole('heading', { name: 'Assistant mode' }),
  )
  await visit('admin-flags-sentry', '/admin/flags', page.getByRole('heading', { name: 'Sentry' }))
  await visit(
    'admin-flags-model-usage',
    '/admin/flags',
    page.getByRole('heading', { name: 'Model usage' }),
  )
}

/** The states that only appear after an interaction, one seat at a time. */
async function extrasLane(): Promise<void> {
  await signIn('instructor')
  setRole('instructor')
  await page.goto(`${BASE}${SEEDED.course}?tab=sections`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  const roster = await hrefMatching(/\/sections\/[0-9a-f-]+\/roster$/)
  if (roster !== null) {
    await page.goto(`${BASE}${roster}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    const addPanel = page.getByRole('region', { name: 'Add member' })
    await addPanel.getByLabel('Email address').fill('new.teaching.assistant@example.edu')
    await page.waitForTimeout(400)
    await shot('roster-add-member-filled', addPanel)
    await addPanel.getByRole('button', { name: 'Add to section' }).click()
    await page.waitForTimeout(2500)
    await shot('roster-invite-dialog')
    await dismissOverlays()
  }
  // The scenario-package form, with its seed fields in view.
  await visit('packages-new-form', '/packages/new')
  const create = page.getByRole('button', { name: /^(Create|Build|Generate)/ }).first()
  if (await create.isVisible().catch(() => false)) {
    await create.click()
    await page.waitForTimeout(1800)
    await shot('packages-new-validation')
  }

  await signOutIfSignedIn()
  await signIn('admin')
  setRole('admin')
  await visit('admin-index', '/admin')
  await page.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const roleBox = page.getByRole('combobox', { name: /^Platform role for / }).first()
  if (await roleBox.isVisible().catch(() => false)) {
    await roleBox.click()
    await page.waitForTimeout(900)
    await shot('admin-platform-role-options')
    await dismissOverlays()
  } else {
    problems.push('admin: no platform-role combobox on /admin/users')
  }
  const search = page
    .getByRole('searchbox')
    .or(page.getByLabel(/Search/))
    .first()
  if (await search.isVisible().catch(() => false)) {
    await search.fill('tassl.local')
    await page.getByRole('button', { name: 'Search' }).click()
    await page.waitForTimeout(2000)
    await shot('admin-users-searched')
  }
  await page.goto(`${BASE}/admin/audit`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const institution = page.getByRole('combobox', { name: 'Institution' })
  if (await institution.isVisible().catch(() => false)) {
    await institution.click()
    await page.waitForTimeout(900)
    await shot('admin-audit-institution-filter')
    await dismissOverlays()
  }
  await visit(
    'admin-flags-assistant-mode',
    '/admin/flags',
    page.getByRole('heading', { name: 'Assistant mode' }),
  )
}

async function main(): Promise<void> {
  const lanes = process.argv.slice(2)
  if (lanes.length === 0) throw new Error('name at least one lane')
  const browser = await chromium.launch()
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    reducedMotion: 'reduce',
  })
  page = await context.newPage()
  page.setDefaultTimeout(30_000)

  const table: Record<string, () => Promise<void>> = {
    public: publicLane,
    instructor: instructorLane,
    'instructor-extra': instructorExtraLane,
    admin: adminLane,
    editor: editorLane,
    learner: learnerLane,
    ta: taLane,
    lead: leadLane,
    extras: extrasLane,
    'admin-flags': adminFlagsLane,
  }

  for (const lane of lanes) {
    const run = table[lane]
    if (run === undefined) throw new Error(`unknown lane ${lane}`)
    console.log(`\n=== lane ${lane} ===`)
    await signOutIfSignedIn()
    await run()
  }

  await browser.close()
  console.log(`\ncaptured ${String(captured.length)} screens`)
  if (problems.length > 0) {
    console.log(`\n${String(problems.length)} problems:`)
    for (const line of problems) console.log(`  - ${line}`)
  }
}

void main()
