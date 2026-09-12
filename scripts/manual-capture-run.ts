/**
 * The learner run lane of the manual capture (see scripts/manual-capture.ts).
 *
 *   pnpm exec tsx scripts/manual-capture-run.ts [walkthrough|outage|instructor-decide]
 *
 * Takes the seeded student seat through a whole Decision Run the way a person takes it, capturing
 * every screen and every dialog on the way, and — between the student's scoring and the student's
 * debrief — signs the instructor in to decide the seven bands on the same run, so the review
 * screens are captured against a run that has just arrived rather than a fixture.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type Locator, type Page } from '@playwright/test'

const BASE = process.env.MANUAL_BASE_URL ?? 'http://localhost:3000'
const PASSWORD = process.env.SEED_PASSWORD ?? 'Walkthrough-Pass-2026'
const SHOT_ROOT = join(process.cwd(), 'docs', 'manual', 'screenshots')
const TEXT_ROOT = process.env.MANUAL_TEXT_DIR ?? join(process.cwd(), '.manual-text')

const WALKTHROUGH = 'Decision Run 1 (walkthrough)'
const SOUND = 'Decision Run 1 (sound)'
const LONG = 240_000

let role = 'learner'
const captured: string[] = []
const problems: string[] = []

function setRole(next: string): void {
  role = next
}

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

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(45_000)
  return page
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

const runRow = (page: Page, title: string): Locator =>
  page.getByRole('row').filter({ hasText: title })
const assistant = (page: Page): Locator =>
  page.getByRole('region', { name: 'AI assistant' }).or(page.locator('#assistant')).first()
const delegationLog = (page: Page): Locator =>
  page.getByRole('region', { name: 'Delegation Log' }).or(page.locator('#delegation-log')).first()
const claimCard = (page: Page, key: string): Locator =>
  page.getByRole('article', { name: `Claim ${key}` }).first()

const runIdFromUrl = (url: string): string => /\/runs\/([0-9a-f-]{36})/.exec(url)?.[1] ?? ''

/** A stance is a radio in the card's `Your stance on claim CN` group. */
async function stance(page: Page, key: string, label: string): Promise<void> {
  const radio = claimCard(page, key).getByRole('radio', { name: label, exact: true }).first()
  if (!(await radio.isVisible().catch(() => false))) {
    problems.push(`learner: stance ${label} not available on claim ${key}`)
    return
  }
  await radio.check({ timeout: 15_000 }).catch((error: unknown) => {
    problems.push(`learner: could not take ${label} on ${key}: ${String(error)}`)
  })
  await page.waitForTimeout(800)
}

/** Every claim card on the page that has no stance yet gets Accept, so the lock is not refused. */
async function stanceOnEveryUntouchedClaim(page: Page): Promise<void> {
  const cards = page.getByRole('article', { name: /^Claim C\d+$/ })
  const count = await cards.count()
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i)
    const chosen = await card.getByRole('radio', { checked: true }).count()
    if (chosen > 0) continue
    const accept = card.getByRole('radio', { name: 'Accept', exact: true })
    if (await accept.isVisible().catch(() => false)) {
      await accept.check({ timeout: 15_000 }).catch(() => undefined)
      await page.waitForTimeout(700)
    }
  }
}

/** Close whatever dialog, menu or popup is open, so the next click is not intercepted. */
async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    const open =
      (await page.getByRole('menu').count()) +
      (await page.getByRole('dialog').count()) +
      (await page.getByRole('alertdialog').count())
    if (open === 0) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }
}

/** The student's whole run, captured screen by screen. Returns the run id. */
async function walkthroughRun(page: Page): Promise<string> {
  setRole('learner')

  await page.goto(`${BASE}/runs`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  await shot(page, 'runs')

  await runRow(page, WALKTHROUGH)
    .getByRole('button', { name: `Start ${WALKTHROUGH}` })
    .click()
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}\/start$/, { timeout: LONG })
  const runId = runIdFromUrl(page.url())
  await page.waitForTimeout(900)
  await shot(page, 'run-start')
  await shot(page, 'run-start-outside-ai', page.getByText('Outside AI tools').first())
  await shot(
    page,
    'run-start-bands-worth',
    page.getByText('What a confirmed band is worth').first(),
  )
  await shot(page, 'run-start-clock', page.getByText('The working clock').first())
  await shot(page, 'run-start-readiness', page.getByText('The Readiness Check comes first').first())

  await page.getByRole('button', { name: 'Begin the Readiness Check' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/readiness$`), { timeout: LONG })
  await page.waitForTimeout(900)
  await shot(page, 'readiness')

  // Answer all sixteen items with the first option, moving on with Next item.
  for (let item = 1; item <= 16; item += 1) {
    const radios = page.getByRole('radio')
    if ((await radios.count()) > 0)
      await radios
        .first()
        .check({ timeout: 10_000 })
        .catch(() => undefined)
    if (item === 1) await shot(page, 'readiness-item-answered')
    const next = page.getByRole('button', { name: 'Next item' })
    if (await next.isEnabled().catch(() => false)) await next.click()
    await page.waitForTimeout(250)
  }
  await shot(page, 'readiness-answered')

  await page.getByRole('button', { name: 'Submit the check' }).click()
  await page.waitForTimeout(700)
  await shot(page, 'readiness-submit-dialog')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Submit', exact: true }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/readiness/result$`), { timeout: LONG })
  await page.waitForTimeout(900)
  await shot(page, 'readiness-result')
  await shot(
    page,
    'readiness-result-ideas',
    page.getByText('The ideas this scenario turns on').first(),
  )

  await page.getByRole('link', { name: 'Open the scenario' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/work$`), { timeout: LONG })
  await page.waitForTimeout(1200)
  await shot(page, 'work-scenario')
  await shot(page, 'work-evidence-room', page.getByRole('heading', { name: 'Evidence Room' }))

  // Open and close a document, so the manual can describe the open/close pair.
  const open = page.getByRole('button', { name: /^Open Board minutes/ }).first()
  if (await open.isVisible().catch(() => false)) {
    await open.click()
    await page.waitForTimeout(900)
    await shot(page, 'work-document-open')
    const close = page.getByRole('button', { name: /^Close Board minutes/ }).first()
    if (await close.isVisible().catch(() => false)) await close.click()
    await page.waitForTimeout(600)
  } else {
    problems.push('learner: no "Open Board minutes…" button on the work screen')
  }

  await shot(page, 'work-assistant-panel', page.getByRole('heading', { name: 'AI assistant' }))
  await shot(page, 'work-frame', page.getByLabel('The decision'))

  await page
    .getByLabel('The decision')
    .fill('Manual decision, back the premium tier with most of the quarterly budget')
  await page
    .getByLabel('Assumption 1')
    .fill('Manual assumption one, premium payback is under a year')
  await page.getByLabel('Assumption 2').fill('Manual assumption two, value tier demand is flat')
  await page.getByLabel('Assumption 3').fill('Manual assumption three, the board wants growth')
  await page
    .getByLabel('Your position now')
    .fill('Manual position, lean premium because the payback looks short')
  await page.getByLabel('Confidence as a number').fill('60')
  await page.waitForTimeout(500)
  await shot(page, 'work-frame-filled', page.getByLabel('The decision'))

  await page.getByRole('button', { name: 'Lock the frame' }).click()
  await page.waitForTimeout(800)
  await shot(page, 'work-lock-frame-dialog')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Lock it' }).click()
  await page.waitForTimeout(2500)
  await shot(page, 'work-working', page.locator('[data-state="working"]').first())

  // First delegation.
  await assistant(page).getByLabel('Your request').fill('What is the premium payback?')
  await page.waitForTimeout(400)
  await shot(page, 'work-assistant-request')
  await assistant(page).getByRole('button', { name: 'Ask the assistant' }).click()
  await page.waitForTimeout(4000)
  await shot(
    page,
    'work-assistant-reply',
    page.getByRole('heading', { name: 'Claims in this reply' }).first(),
  )
  await shot(page, 'work-delegation-log', delegationLog(page))

  const why = delegationLog(page).getByLabel('Why you asked, delegation 1')
  if (await why.isVisible().catch(() => false)) {
    await why.fill('Manual, checking the payback figure')
    await page.waitForTimeout(300)
    await delegationLog(page).getByRole('button', { name: 'Save' }).first().click()
    await page.waitForTimeout(1500)
    await shot(page, 'work-delegation-why-saved', delegationLog(page))
  } else {
    problems.push('learner: "Why you asked, delegation 1" not visible')
  }

  const markUsed = page.getByRole('button', { name: 'Mark claim C3 as used' }).first()
  if (await markUsed.isVisible().catch(() => false)) {
    await markUsed.click()
    await page.waitForTimeout(1500)
    await shot(page, 'work-reliance-marked', claimCard(page, 'C3'))
  } else {
    problems.push('learner: "Mark claim C3 as used" not visible')
  }

  await shot(page, 'work-claim-card', claimCard(page, 'C3'))
  await stance(page, 'C3', 'Verify')
  await shot(page, 'work-stance-taken', claimCard(page, 'C3'))

  await assistant(page)
    .getByLabel('Your request')
    .fill(
      'What is the price sensitivity, is the value tier saturated, and what did the survey find?',
    )
  await assistant(page).getByRole('button', { name: 'Ask the assistant' }).click()
  await page.waitForTimeout(4500)
  await shot(page, 'work-assistant-reply-multi')

  await stance(page, 'C5', 'Verify')
  await stance(page, 'C8', 'Accept')
  await stance(page, 'C7', 'Verify')

  // Check a claim: the button opens a menu of checks, each priced in clock time.
  const check = page.getByRole('button', { name: 'Check claim C5' }).first()
  if (await check.isVisible().catch(() => false)) {
    await check.click()
    await page.waitForTimeout(1200)
    await shot(page, 'work-check-menu')
    const trace = page.getByRole('menuitem', { name: /Source Trace/ }).first()
    if (await trace.isVisible().catch(() => false)) {
      await trace.click()
      await page.waitForTimeout(3000)
      await shot(page, 'work-check-result')
    } else {
      problems.push('learner: no "Source Trace" item in the check menu')
    }
    await dismissOverlays(page)
  } else {
    problems.push('learner: "Check claim C5" not visible')
  }

  // Escalation.
  await dismissOverlays(page)
  const escalate = page.getByRole('button', { name: 'Escalate claim C7' }).first()
  if (await escalate.isVisible().catch(() => false)) {
    await escalate.click()
    await page.waitForTimeout(900)
    await shot(page, 'work-escalate-dialog')
    await page
      .getByLabel('What you cannot settle')
      .fill('Manual, I cannot tell whether the survey sample was large enough')
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Send it' }).click()
    await page.waitForTimeout(2500)
    await shot(page, 'work-escalated', claimCard(page, 'C7'))
  } else {
    problems.push('learner: "Escalate claim C7" not visible')
  }

  // Outside-tool declaration.
  const declare = page.getByRole('button', { name: 'Declare outside-tool use' }).first()
  if (await declare.isVisible().catch(() => false)) {
    await declare.click()
    await page.waitForTimeout(900)
    await shot(page, 'work-outside-tool-dialog')
    await page
      .getByLabel('What you used, and what for')
      .fill('Manual, a calculator for the payback arithmetic')
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Record it' }).click()
    await page.waitForTimeout(2000)
    await shot(page, 'work-outside-tool-recorded')
  } else {
    problems.push('learner: "Declare outside-tool use" not visible')
  }

  // The decision brief.
  const brief = page.getByRole('region', { name: 'Your decision brief' })
  await shot(page, 'work-brief', brief)
  await brief
    .getByLabel('Your recommendation')
    .fill('Manual recommendation, move most of the budget to premium this quarter')
  await brief
    .getByLabel('Why', { exact: true })
    .fill('Manual reasoning, the premium payback is short and retention is strong')
  await brief
    .getByLabel('Assumption 1')
    .fill('Manual brief assumption one, payback stays near eleven months')
  await brief
    .getByLabel('Assumption 2')
    .fill('Manual brief assumption two, premium retention holds')
  await brief
    .getByLabel('Assumption 3')
    .fill('Manual brief assumption three, the value tier is saturated')
  await brief
    .getByLabel('What would change your mind')
    .fill('Manual, a payback figure above sixteen months')
  await brief
    .getByLabel("Share of the quarter's acquisition budget going to premium, in percent")
    .fill('60')
  await brief.getByLabel('Premium payback you are betting on, in months').fill('11')
  await brief.getByLabel('Confidence as a number').fill('62')
  await page.waitForTimeout(700)
  await shot(page, 'work-brief-filled', brief)

  // Filing asks for a stance on every claim the run has recorded you leaning on.
  await page.getByRole('button', { name: 'Lock the decision' }).click()
  await page.waitForTimeout(1200)
  await shot(page, 'work-lock-decision-dialog')
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialog = page.getByRole('alertdialog')
    const goToClaim = dialog.getByRole('button', { name: 'Go to the claim' })
    if (!(await goToClaim.isVisible().catch(() => false))) break
    if (attempt === 0) await shot(page, 'work-lock-blocked-dialog')
    await goToClaim.click()
    await page.waitForTimeout(1400)
    if (attempt === 0) await shot(page, 'work-lock-blocked-claim')
    await stanceOnEveryUntouchedClaim(page)
    await dismissOverlays(page)
    await page.getByRole('button', { name: 'Lock the decision' }).click()
    await page.waitForTimeout(1200)
  }
  await page.getByRole('alertdialog').getByRole('button', { name: 'File it' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/locked$`), { timeout: LONG })
  await page.waitForTimeout(1500)
  await shot(page, 'locked')

  // Addendum.
  const addendum = page.getByRole('button', { name: 'Add an addendum' }).first()
  if (await addendum.isVisible().catch(() => false)) {
    await addendum.click()
    await page.waitForTimeout(900)
    await shot(page, 'locked-addendum-dialog')
    await page
      .getByLabel('Your addendum')
      .fill('Manual addendum, I would trace the payback figure before filing')
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Add it' }).click()
    await page.waitForTimeout(2000)
    await shot(page, 'locked-addendum-added')
  } else {
    problems.push('learner: "Add an addendum" not visible on the locked screen')
  }

  // The Turn arrives ninety seconds after the decision is filed.
  console.log('  waiting for the Turn…')
  await page
    .goto(`${BASE}/runs/${runId}/turn`, { waitUntil: 'domcontentloaded' })
    .catch(() => undefined)
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(6000)
    await page
      .goto(`${BASE}/runs/${runId}/turn`, { waitUntil: 'domcontentloaded' })
      .catch(() => undefined)
    const heading = page.getByRole('heading', { level: 1, name: 'The Turn' })
    if (await heading.isVisible().catch(() => false)) break
  }
  await page.waitForTimeout(1200)
  await shot(page, 'turn')
  await shot(page, 'turn-what-arrived', page.getByText('What arrived').first())
  await shot(page, 'turn-puts-in-front', page.getByText('What this puts in front of you').first())

  await stance(page, 'C2', 'Verify')
  await stance(page, 'C3', 'Challenge')
  await shot(page, 'turn-stances', claimCard(page, 'C3'))

  const revise = page
    .getByRole('radio', { name: 'Revise', exact: true })
    .or(page.getByRole('button', { name: 'Revise', exact: true }))
    .first()
  if (await revise.isVisible().catch(() => false)) {
    await revise.click()
    await page.waitForTimeout(900)
  } else {
    problems.push('learner: "Revise" not visible on the Turn')
  }
  await page
    .getByLabel('Why', { exact: true })
    .fill('Manual revision, the retention figure changed so the payback no longer holds')
  await page.getByLabel('Confidence as a number').fill('48')
  await page.waitForTimeout(500)
  await shot(page, 'turn-response-filled', page.getByLabel('Why', { exact: true }))
  await page.getByRole('button', { name: 'File the response' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/defense$`), { timeout: LONG })
  await page.waitForTimeout(1500)
  await shot(page, 'defense')

  // Answer every question.
  for (let i = 0; i < 12; i += 1) {
    const answer = page.getByLabel('Your answer')
    if (!(await answer.isVisible().catch(() => false))) break
    await answer.fill(
      i === 0
        ? 'I went with what I remembered and did not note where it came from.'
        : 'Manual, 16 months because the memo says so',
    )
    await page.waitForTimeout(300)
    if (i === 0) await shot(page, 'defense-answer-typed')
    const submit = page.getByRole('button', { name: 'Submit answer' })
    if (!(await submit.isEnabled().catch(() => false))) break
    await submit.click()
    await page.waitForTimeout(1800)
    if (i === 0) await shot(page, 'defense-answer-filed')
  }
  await shot(page, 'defense-what-you-filed', page.getByText('What you filed').first())
  await page.getByRole('button', { name: 'Finish the defense' }).click()
  await page.waitForTimeout(900)
  await shot(page, 'defense-finish-dialog')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Finish it' }).click()
  await page.waitForTimeout(4000)
  await shot(page, 'run-status-scoring')

  // Scoring drains inline locally; the page polls itself.
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(3000)
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
    if (
      await page
        .getByRole('link', { name: 'Read the debrief' })
        .isVisible()
        .catch(() => false)
    )
      break
  }
  await shot(page, 'run-status-scored')

  const debrief = page.getByRole('link', { name: 'Read the debrief' }).first()
  if (await debrief.isVisible().catch(() => false)) {
    await debrief.click()
    await page.waitForTimeout(2000)
    await shot(page, 'debrief-before-confirmation')
    await shot(page, 'debrief-dimensions', page.getByText('The seven dimensions').first())
    await shot(
      page,
      'debrief-what-your-course-does',
      page.getByText('What your course does with the bands').first(),
    )
  } else {
    problems.push('learner: "Read the debrief" never appeared')
  }

  console.log(`  run ${runId} is scored`)
  return runId
}

/** The instructor deciding the seven bands on the run the student has just finished. */
async function instructorDecide(page: Page, runId: string): Promise<void> {
  setRole('instructor')
  await page.goto(`${BASE}/review`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await shot(page, 'review-queue-with-waiting-run')

  const replay = `/review/runs/${runId}`
  await page.goto(`${BASE}${replay}?tab=overview`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await shot(page, 'replay-overview')
  await shot(page, 'replay-graphs', page.getByRole('heading', { name: 'The four graphs' }))
  const table = page.getByRole('button', { name: 'Show data table' }).first()
  if (await table.isVisible().catch(() => false)) {
    await table.click()
    await page.waitForTimeout(900)
    await shot(page, 'replay-graph-data-table')
  }
  await shot(
    page,
    'replay-defense-transcript',
    page.getByRole('heading', { name: 'Defense transcript' }),
  )
  await shot(page, 'replay-delegation-log', page.getByRole('heading', { name: 'Delegation log' }))

  await page.goto(`${BASE}${replay}?tab=bands`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1800)
  await shot(page, 'replay-bands-undecided')

  await page.goto(`${BASE}${replay}?tab=trace`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await shot(page, 'replay-trace')

  await page.goto(`${BASE}${replay}?tab=package`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await shot(page, 'replay-package')

  await page.goto(`${BASE}${replay}?tab=actions`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await shot(page, 'replay-actions')

  // Decide the bands through the screen itself.
  await page.goto(`${BASE}${replay}?tab=bands`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1800)
  const override = page.getByRole('button', { name: /^Override/ }).first()
  if (await override.isVisible().catch(() => false)) {
    await override.click()
    await page.waitForTimeout(900)
    await shot(page, 'replay-band-override')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }
  const confirmAll = page
    .getByRole('button', { name: /Confirm the remaining|Confirm remaining|Confirm all/ })
    .first()
  if (await confirmAll.isVisible().catch(() => false)) {
    await confirmAll.click()
    await page.waitForTimeout(1000)
    await shot(page, 'replay-confirm-remaining-dialog')
    const go = page.getByRole('alertdialog').getByRole('button').last()
    if (await go.isVisible().catch(() => false)) await go.click()
    await page.waitForTimeout(3000)
  } else {
    problems.push('instructor: no "Confirm the remaining…" button on the Bands tab')
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  await shot(page, 'replay-bands-confirmed')
}

/** What the student sees once the bands are confirmed: the debrief, its questions, the record. */
async function learnerAfterConfirmation(page: Page, runId: string): Promise<void> {
  setRole('learner')
  await page.goto(`${BASE}/runs`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await shot(page, 'runs-after-confirmation')

  await page.goto(`${BASE}/runs/${runId}/debrief`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  await shot(page, 'debrief-confirmed')
  await shot(page, 'debrief-two-questions', page.getByText('Two questions').first())
  const q1 = page.getByLabel('Which single stance would you change, and to what?')
  if (await q1.isVisible().catch(() => false)) {
    await q1.fill('Manual, Verify on C5 to Challenge')
    await page
      .getByLabel('What will you do differently in the next run like this?')
      .fill('Manual, trace every figure first')
    await page.waitForTimeout(400)
    await shot(page, 'debrief-questions-typed')
    await page.getByRole('button', { name: 'File both answers' }).click()
    await page.waitForTimeout(2500)
    await shot(page, 'debrief-questions-filed')
  } else {
    problems.push('learner: the debrief questions were not on the page')
  }

  await page.goto(`${BASE}/records/${runId}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await shot(page, 'record')
  await shot(page, 'record-graphs', page.getByRole('heading', { name: 'Frame beside decision' }))
  const table = page.getByRole('button', { name: 'Show data table' }).nth(2)
  if (await table.isVisible().catch(() => false)) {
    await table.click()
    await page.waitForTimeout(900)
    await shot(page, 'record-data-table')
  }
  await shot(page, 'record-bands', page.getByText('The seven dimensions').first())
  await shot(page, 'record-context', page.getByText('How this run was set up').first())
  await shot(page, 'record-trajectory', page.getByText('Four-run trajectory').first())

  await page.goto(`${BASE}/notifications`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await shot(page, 'notifications-after-confirmation')
  const markAll = page.getByRole('button', { name: 'Mark all read' })
  if (await markAll.isVisible().catch(() => false)) {
    await markAll.click()
    await page.waitForTimeout(1800)
    await shot(page, 'notifications-marked-read')
  }
}

/** The assistant outage, armed by the instructor from the replay's Actions tab. */
async function outageRun(student: Page, instructor: Page): Promise<void> {
  setRole('learner')
  await student.goto(`${BASE}/runs`, { waitUntil: 'domcontentloaded' })
  await student.waitForTimeout(900)
  await runRow(student, SOUND)
    .getByRole('button', { name: `Start ${SOUND}` })
    .click()
  await student.waitForURL(/\/runs\/[0-9a-f-]{36}\/start$/, { timeout: LONG })
  const runId = runIdFromUrl(student.url())
  await student.getByRole('button', { name: 'Begin the Readiness Check' }).click()
  await student.waitForURL(new RegExp(`/runs/${runId}/readiness$`), { timeout: LONG })
  await student.getByRole('button', { name: 'Submit the check' }).click()
  await student.waitForTimeout(900)
  await shot(student, 'readiness-skip-dialog')
  await student
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Submit', exact: true })
    .click()
  await student.waitForURL(new RegExp(`/runs/${runId}/readiness/result$`), { timeout: LONG })
  await student.waitForTimeout(900)
  await shot(student, 'readiness-result-skipped')
  await student.getByRole('link', { name: 'Open the scenario' }).click()
  await student.waitForURL(new RegExp(`/runs/${runId}/work$`), { timeout: LONG })
  await student.waitForTimeout(1200)
  await shot(student, 'work-scenario-sound')

  await student.getByLabel('The decision').fill('Manual outage decision, hold the budget split')
  await student.getByLabel('Assumption 1').fill('Manual outage assumption one')
  await student.getByLabel('Assumption 2').fill('Manual outage assumption two')
  await student.getByLabel('Assumption 3').fill('Manual outage assumption three')
  await student.getByLabel('Your position now').fill('Manual outage position, hold')
  await student.getByLabel('Confidence as a number').fill('50')
  await student.getByRole('button', { name: 'Lock the frame' }).click()
  await student.waitForTimeout(800)
  await student.getByRole('alertdialog').getByRole('button', { name: 'Lock it' }).click()
  await student.waitForTimeout(2500)

  // The instructor arms one assistant failure from the replay's Actions tab.
  setRole('instructor')
  await instructor.goto(`${BASE}/review/runs/${runId}?tab=actions`, {
    waitUntil: 'domcontentloaded',
  })
  await instructor.waitForTimeout(1800)
  await shot(instructor, 'replay-actions-test-controls')
  const arm = instructor.getByRole('button', { name: 'Arm the outage' }).first()
  if (await arm.isVisible().catch(() => false)) {
    await arm.click()
    await instructor.waitForTimeout(2000)
    await shot(instructor, 'replay-actions-failure-armed')
  } else {
    problems.push('instructor: no force-assistant-failure control on the Actions tab')
    const armed = await instructor.request.post(
      `${BASE}/api/v1/review/runs/${runId}/test-controls/force-assistant-failure`,
      { data: {}, headers: { 'content-type': 'application/json', origin: BASE } },
    )
    console.log(`  armed by endpoint: ${String(armed.status())}`)
  }

  setRole('learner')
  await assistant(student).getByLabel('Your request').fill('What is the premium payback?')
  await student.waitForTimeout(400)
  await assistant(student).getByRole('button', { name: 'Ask the assistant' }).click()
  await student.waitForTimeout(4000)
  await shot(student, 'work-assistant-paused')
  const resume = student.getByRole('button', { name: 'Resume the run' })
  if (await resume.isVisible().catch(() => false)) {
    await resume.click()
    await student.waitForTimeout(2500)
    await shot(student, 'work-assistant-resumed')
  } else {
    problems.push('learner: no "Resume the run" button on the paused overlay')
  }
  await assistant(student).getByLabel('Your request').fill('What is the premium payback?')
  await assistant(student).getByRole('button', { name: 'Ask the assistant' }).click()
  await student.waitForTimeout(4500)
  await shot(student, 'work-assistant-reply-sound')
}

async function main(): Promise<void> {
  const lanes = process.argv.slice(2)
  const browser = await chromium.launch()
  const student = await newPage(browser)
  const instructor = await newPage(browser)
  await signIn(student, 'student1')
  await signIn(instructor, 'instructor')

  if (lanes.includes('walkthrough')) {
    const runId = await walkthroughRun(student)
    await instructorDecide(instructor, runId)
    await learnerAfterConfirmation(student, runId)
  }
  if (lanes.includes('outage')) {
    await outageRun(student, instructor)
  }
  if (lanes.includes('replay-dialogs')) {
    setRole('instructor')
    const recorded = '/review/runs/201d7452-35d1-436c-ab22-36a8308ca22a'
    await instructor.goto(`${BASE}${recorded}?tab=actions`, { waitUntil: 'domcontentloaded' })
    await instructor.waitForTimeout(1600)
    const correction = instructor.getByRole('button', { name: /^Enter a correction on C3/ })
    if (await correction.isVisible().catch(() => false)) {
      await correction.click()
      await instructor.waitForTimeout(1400)
      await shot(instructor, 'replay-correction-dialog')
      await instructor.keyboard.press('Escape')
      await instructor.waitForTimeout(700)
    } else {
      problems.push('instructor: no "Enter a correction on C3…" button')
    }
    const voidRun = instructor.getByRole('button', { name: 'Void this run…' })
    if (await voidRun.isVisible().catch(() => false)) {
      await voidRun.click()
      await instructor.waitForTimeout(1400)
      await shot(instructor, 'replay-void-dialog')
      await instructor.keyboard.press('Escape')
      await instructor.waitForTimeout(700)
    } else {
      problems.push('instructor: no "Void this run…" button')
    }
    // The delegation flag lives on the Overview tab's Delegation log.
    await instructor.goto(`${BASE}${recorded}?tab=overview`, { waitUntil: 'domcontentloaded' })
    await instructor.waitForTimeout(2200)
    const flag = instructor.getByRole('button', { name: /^Flag/ }).first()
    if (await flag.isVisible().catch(() => false)) {
      await flag.click()
      await instructor.waitForTimeout(1400)
      await shot(instructor, 'replay-delegation-flag')
      await instructor.keyboard.press('Escape')
    } else {
      problems.push('instructor: no delegation flag control on the Overview tab')
    }
  }

  await browser.close()
  console.log(`\ncaptured ${String(captured.length)} screens`)
  if (problems.length > 0) {
    console.log(`\n${String(problems.length)} problems:`)
    for (const line of problems) console.log(`  - ${line}`)
  }
}

void main()
