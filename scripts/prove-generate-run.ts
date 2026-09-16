/**
 * The whole road, against a deployment that already exists (D-750, D-751, D-752).
 *
 *   PLAYWRIGHT_BASE_URL=https://tassl.vercel.app SEED_PASSWORD=… \
 *     pnpm exec tsx scripts/prove-generate-run.ts "Kavena Loop revenue model"
 *
 * One package authored end to end and one Decision Run taken on it, by the demo seats, through the
 * real screens:
 *
 *   1. The Scenario Editor opens /packages/new, types a title and (unless `--title-only`) pastes
 *      `docs/qa/test-scenario.md`, and presses Generate.
 *   2. The generation screen is watched until all seven steps read Done and the package's own rules
 *      pass — which since D-750 is a guarantee the pipeline keeps rather than an outcome to hope for.
 *   3. The review workspace opens and one press publishes the version; the status reads Published.
 *   4. The Instructor assigns the published version to the demo course's section.
 *   5. The Student takes the assignment from end to end: the Readiness Check, the frame, the
 *      assistant, a stance on every claim it surfaced, the delegation log, the decision brief, the
 *      lock, the Turn, the defense, the scoring and the debrief.
 *
 * It is a QA tool, not a test lane: it writes a real package and a real run on a real deployment,
 * costs real model calls, and is run by hand. `tests/e2e/author/generate-and-confirm.spec.ts` is
 * the lane, on the mock provider, in CI.
 *
 * Every step prints one line as it passes. Any console error, any page error and any refused screen
 * fails the whole thing, loudly, with the step it failed on. Exit code 0 means every one of them
 * passed on the deployment named by `PLAYWRIGHT_BASE_URL`.
 *
 * Nothing here knows the package it is driving. The Meridian Roast fixture has claim keys the demo
 * path names one by one; a package that was generated five minutes ago has its own, so this script
 * reads the claims, the named fields and the defense questions off the screen and answers what it
 * finds. That is what makes it a proof about the *flow* rather than about one package.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
const PASSWORD = process.env.SEED_PASSWORD ?? 'Walkthrough-Pass-2026'

const EDITOR = 'editor@tassl.local'
const INSTRUCTOR = 'instructor@tassl.local'
const STUDENT = 'student1@tassl.local'
const COURSE = 'Marketing Strategy Walkthrough'

const SCENARIO_PATH = join(process.cwd(), 'docs', 'qa', 'test-scenario.md')

/** Generation is seven model calls on a real provider, pumped by the progress screen's poll. */
const GENERATION_TIMEOUT_MS = 900_000
/** A cold Neon branch and a real model; every other act is fast by comparison. */
const ACTION_MS = 120_000
const REPLY_MS = 180_000
const SCORING_MS = 300_000

const titleOnly = process.argv.includes('--title-only')
const named = process.argv.find((argument, index) => index >= 2 && !argument.startsWith('--'))
if (named === undefined || named.trim() === '') {
  console.error('usage: tsx scripts/prove-generate-run.ts "<package title>" [--title-only]')
  process.exit(2)
}
const title = named

const familyKey = title
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60)

const started = Date.now()
const marks: { label: string; at: number }[] = []

function step(label: string): void {
  const at = Date.now()
  marks.push({ label, at })
  const seconds = ((at - started) / 1000).toFixed(1)
  console.log(`  [${seconds.padStart(7)}s] ${label}`)
}

function fail(what: string, detail: string): never {
  console.error(`\nFAILED: ${what}\n${detail}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------------------------
// The guards: nothing on any screen may be an error, in the page or in the console
// ---------------------------------------------------------------------------------------------

type Guard = { errors: string[] }

/**
 * Console errors and uncaught page errors, collected for the whole session.
 *
 * Two are ignored and both are the network rather than the product: a request the browser cancels
 * on a navigation, and the favicon a deployment serves as a 404 to a preflight. Everything else is
 * a defect, including a React warning raised as an error.
 */
function guard(page: Page): Guard {
  const errors: string[] = []
  const ignorable =
    /favicon|net::ERR_ABORTED|Failed to load resource: the server responded with a status of 404 \(\)/i
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (ignorable.test(text)) return
    errors.push(`console: ${text}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  return { errors }
}

function assertClean(guards: readonly { name: string; guard: Guard }[], where: string): void {
  const found = guards.flatMap(({ name, guard: g }) => g.errors.map((error) => `${name} ${error}`))
  if (found.length > 0) fail(`console errors at ${where}`, found.join('\n'))
}

/** The screen must not be showing a refusal; every one of these is a visible error on screen. */
async function assertNoErrorOnScreen(page: Page, where: string): Promise<void> {
  const body = await page.locator('body').innerText()
  const shouting = [
    'Something went wrong',
    'Application error',
    'This page could not be loaded',
    'An unexpected error',
    'INTERNAL_ERROR',
    'PACKAGE_INVALID',
    'QUESTION_BANK_INCOMPLETE',
    'READINESS_SPLIT',
    'DEFECTIVE_VARIANT_PLANT',
  ]
  const hit = shouting.find((phrase) => body.includes(phrase))
  if (hit !== undefined) fail(`an error on screen at ${where}`, `the page says "${hit}"`)
}

// ---------------------------------------------------------------------------------------------
// Small drivers
// ---------------------------------------------------------------------------------------------

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  const account = page.getByRole('button', { name: /^Account:/ })
  if (await account.isVisible().catch(() => false)) {
    await account.click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await page.waitForURL(/\/sign-in/, { timeout: ACTION_MS })
  }
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(/\/home$/, { timeout: ACTION_MS })
}

async function signOut(page: Page): Promise<void> {
  const account = page.getByRole('button', { name: /^Account:/ })
  if (!(await account.isVisible().catch(() => false))) return
  await account.click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.waitForURL(/\/(sign-in)?$/, { timeout: ACTION_MS }).catch(() => undefined)
}

const rail = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name, exact: true })

/** A title typed by a person, used as a pattern: nothing in it may mean anything to a regex. */
const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------------------------------------------------------------------------------------------
// 1–3. The Scenario Editor: three fields, Generate, one press to publish
// ---------------------------------------------------------------------------------------------

async function authorThePackage(page: Page): Promise<string> {
  await signIn(page, EDITOR)
  step(`signed in as ${EDITOR}`)

  await page.goto(`${BASE}/packages/new`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { level: 1, name: 'New package' }).waitFor({ timeout: ACTION_MS })
  await assertNoErrorOnScreen(page, '/packages/new')

  await page.getByLabel('Title', { exact: true }).fill(title)
  const key = page.getByLabel('Family key')
  if ((await key.inputValue()) !== familyKey) await key.fill(familyKey)

  if (!titleOnly) {
    const scenario = readFileSync(SCENARIO_PATH, 'utf8')
    await page.getByLabel('Scenario text').fill(scenario)
    step(`pasted ${String(scenario.length)} characters of docs/qa/test-scenario.md`)
  } else {
    step('left the scenario text empty: the title and the family key are the whole form')
  }

  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await page.waitForURL(/\/packages\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}\/generation$/, {
    timeout: ACTION_MS,
  })
  const versionPath = new URL(page.url()).pathname.replace(/\/generation$/, '')
  step(`generation started: ${versionPath}`)

  // The screen polls; what is waited for is the outcome only a finished pipeline has.
  await page
    .getByRole('heading', { level: 2, name: 'Every package rule is met' })
    .waitFor({ timeout: GENERATION_TIMEOUT_MS })
  const done = page.locator('[data-kind="confirmed"]')
  const count = await done.count()
  if (count < 7) fail('generation', `only ${String(count)} of the seven steps read Done`)
  await assertNoErrorOnScreen(page, 'the generation screen')
  step('all seven steps are Done and every package rule is met')

  await page.getByRole('link', { name: 'Open confirmation workspace' }).click()
  await page.waitForURL(new RegExp(`${versionPath}/confirm$`), { timeout: ACTION_MS })
  await assertNoErrorOnScreen(page, 'the review workspace')

  await page.getByRole('button', { name: 'Confirm and publish' }).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Confirm and publish' }).click()
  await page
    .getByText('Version 1 is published.')
    .waitFor({ timeout: ACTION_MS })
    .catch(async () => {
      await assertNoErrorOnScreen(page, 'the publish')
      fail('publish', 'the version did not report itself published')
    })
  step('published in one press')

  await page.goto(`${BASE}${versionPath}`, { waitUntil: 'domcontentloaded' })
  const status = await page.locator('#version-identity').innerText()
  if (!status.includes('Published')) fail('publish', `the version reads "${status}"`)
  await assertNoErrorOnScreen(page, 'the version view')
  step('the version view reads Published')

  return versionPath
}

// ---------------------------------------------------------------------------------------------
// 4. The Instructor: the published version on the demo course's section
// ---------------------------------------------------------------------------------------------

async function assignIt(page: Page, label: string): Promise<void> {
  await signIn(page, INSTRUCTOR)
  step(`signed in as ${INSTRUCTOR}`)

  await rail(page, 'Courses').click()
  await page.getByRole('link', { name: `Open ${COURSE}` }).click()
  await page.getByRole('heading', { level: 1, name: COURSE }).waitFor({ timeout: ACTION_MS })
  await page
    .getByRole('navigation', { name: 'Course views' })
    .getByRole('link', { name: 'Assignments', exact: true })
    .click()

  await page.getByRole('button', { name: 'New assignment' }).first().click()
  const form = page.getByRole('dialog')
  await form.waitFor({ timeout: ACTION_MS })
  await form.getByLabel('Assignment name').fill(label)

  // The version picker is a listbox, not a native select: the trigger opens it and the option is
  // named by the package's own title.
  await form.getByLabel('Scenario package version').click()
  await page
    .getByRole('option', { name: new RegExp(escapeForRegExp(title)) })
    .first()
    .click()
  await form.getByRole('radio', { name: 'Defective' }).click()
  await form.getByRole('button', { name: 'Create assignment' }).click()
  await form.waitFor({ state: 'hidden', timeout: ACTION_MS })
  await assertNoErrorOnScreen(page, 'the assignment form')
  step(`assigned as "${label}" on ${COURSE}`)
}

// ---------------------------------------------------------------------------------------------
// 5. The Student: the whole run
// ---------------------------------------------------------------------------------------------

const FRAME = {
  decision: 'Which revenue direction to commit to first, and on what evidence.',
  assumptions: [
    'The headline figure in the brief is stated on the basis it is being quoted on.',
    'The population the rate is quoted over is one the plan can actually reach.',
    'The costs of winning and keeping a customer are inside the figure being used.',
  ],
  position:
    'I lean toward the narrowest commitment the evidence already supports, because the figures in the room are stated on more than one basis and none of them has been traced yet.',
  confidence: '55',
}

const BRIEF = {
  recommendation:
    'Commit to the narrowest direction the evidence supports, and run one bounded test with a decision rule written down before the result is seen.',
  why: 'The documents in the room disagree about the basis of the headline figure, and the later one restates it. Committing at the scale the earliest figure implies would be betting on a number nobody has restated.',
  assumptions: [
    'The headline figure is stated on the basis the later document sets out.',
    'The reachable population is smaller than the registered one.',
    'The costs of winning and keeping a customer are inside the contribution figure.',
  ],
  changeMyMind:
    'A traced figure on the fuller basis that still supported the larger commitment would change my mind.',
  confidence: '60',
}

const TURN_WHY =
  'The message restates a figure the decision rested on, so I hold the direction and cut the size of the commitment back to what the restated figure supports.'

const DEFENSE_ANSWERS = [
  'I relied on the later document, because it states the basis the figure is on and the earlier one does not.',
  'I checked it against the document the trace named, and the passage said what the claim said.',
  'That assumption is the one I would test first, because the decision turns on it and nothing in the room settles it.',
  'I would have decided differently if the figure had been half what I was told: the commitment would have been smaller.',
  'I am moderately confident, and the confidence rests on the one figure I traced rather than on the pack as a whole.',
]

async function takeTheRun(page: Page, label: string): Promise<void> {
  await signIn(page, STUDENT)
  step(`signed in as ${STUDENT}`)

  await rail(page, 'Runs').click()
  await page.getByRole('heading', { level: 1, name: 'Runs' }).waitFor({ timeout: ACTION_MS })
  await page
    .getByRole('row')
    .filter({ hasText: label })
    .getByRole('button', { name: `Start ${label}` })
    .click()
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}\/start$/, { timeout: ACTION_MS })
  const runId = /\/runs\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? ''
  await assertNoErrorOnScreen(page, 'the run start page')
  step(`run started: ${runId}`)

  // --- the Readiness Check -------------------------------------------------------------------
  await page.getByRole('button', { name: 'Begin the Readiness Check' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/readiness$`), { timeout: ACTION_MS })
  for (let position = 1; position <= 16; position += 1) {
    await page.getByText(`Item ${String(position)} of 16`).waitFor({ timeout: ACTION_MS })
    await page.getByRole('radiogroup').getByRole('radio').first().click()
    if (position < 16) await page.getByRole('button', { name: 'Next item' }).click()
  }
  await page.getByText('16 of 16 answered').waitFor({ timeout: ACTION_MS })
  await page.getByRole('button', { name: 'Submit the check' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Submit', exact: true }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/readiness/result$`), { timeout: ACTION_MS })
  await assertNoErrorOnScreen(page, 'the Readiness Check result')
  step('the Readiness Check is answered and read back')

  await page.getByRole('link', { name: 'Open the scenario' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/work$`), { timeout: ACTION_MS })
  await page
    .getByRole('heading', { level: 1, name: 'The scenario' })
    .waitFor({ timeout: ACTION_MS })
  await assertNoErrorOnScreen(page, 'the scenario')
  step('the scenario, the Evidence Room and the assistant panel are on the screen')

  // --- the frame ------------------------------------------------------------------------------
  await page.getByLabel('The decision').fill(FRAME.decision)
  for (const [index, assumption] of FRAME.assumptions.entries()) {
    await page.getByLabel(`Assumption ${String(index + 1)}`).fill(assumption)
  }
  await page.getByLabel('Your position now').fill(FRAME.position)
  await page.getByRole('spinbutton', { name: 'Confidence as a number' }).fill(FRAME.confidence)
  await page.getByRole('button', { name: 'Lock the frame' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Lock it' }).click()
  await page.locator('[data-state="working"]').waitFor({ timeout: ACTION_MS })
  await assertNoErrorOnScreen(page, 'the locked frame')
  step('the frame is locked and the working clock is running')

  // --- the assistant, and a stance on everything it surfaces -----------------------------------
  const assistant = page.locator('#assistant-panel')
  await assistant
    .getByLabel('Your request')
    .fill('What is the headline figure this decision rests on, and what is it stated on?')
  await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
  await assistant
    .locator('#assistant-reply-status')
    .filter({ hasText: /Reply complete/ })
    .waitFor({ timeout: REPLY_MS })
  await assertNoErrorOnScreen(page, 'the assistant reply')
  step('the assistant answered and surfaced its claims')

  const keys = await surfacedClaimKeys(page)
  if (keys.length === 0) fail('the assistant', 'the reply surfaced no claim to take a stance on')
  for (const [index, key] of keys.entries()) {
    const stance = index === 0 ? 'Verify' : 'Accept'
    const group = page.getByRole('radiogroup', { name: `Your stance on claim ${key}` })
    await group.getByRole('radio', { name: stance }).click()
    await group
      .getByRole('radio', { name: stance })
      .and(page.locator('[aria-checked="true"]'))
      .waitFor({ timeout: ACTION_MS })
  }
  step(`a stance on each of ${String(keys.length)} surfaced claims (${keys.join(', ')})`)

  // --- the delegation log ----------------------------------------------------------------------
  const log = page.locator('#delegation-log')
  const entry = log.getByRole('article', { name: 'Delegation 1', exact: true })
  await entry
    .getByLabel('Why you asked, delegation 1')
    .fill('I wanted the basis of the headline figure before sizing any commitment.')
  await entry.getByRole('button', { name: 'Save' }).click()
  await entry
    .locator('p[id$="-status"]')
    .filter({ hasText: 'Saved.' })
    .waitFor({ timeout: ACTION_MS })
  const markUsed = log.getByRole('button', { name: /^Mark claim .* as used$/ }).first()
  if (await markUsed.isVisible().catch(() => false)) await markUsed.click()
  await assertNoErrorOnScreen(page, 'the delegation log')
  step('the delegation log carries why the assistant was asked')

  // --- the decision brief -----------------------------------------------------------------------
  const editor = page.locator('#brief-editor-panel')
  await editor.getByLabel('Your recommendation').fill(BRIEF.recommendation)
  await editor.getByLabel('Why', { exact: true }).fill(BRIEF.why)
  for (const [index, assumption] of BRIEF.assumptions.entries()) {
    await editor.getByLabel(`Assumption ${String(index + 1)}`).fill(assumption)
  }
  await editor.getByLabel('What would change your mind').fill(BRIEF.changeMyMind)
  await editor.getByLabel('Confidence as a number').fill(BRIEF.confidence)
  // The named fields are the package's own, so they are read off the form rather than named here.
  const figures = editor.getByRole('spinbutton')
  const figureCount = await figures.count()
  for (let index = 0; index < figureCount; index += 1) {
    const field = figures.nth(index)
    const name = (await field.getAttribute('aria-label')) ?? ''
    if (/Confidence as a number/.test(name)) continue
    await field.fill('12')
  }
  await editor.getByText('Saved.', { exact: true }).waitFor({ timeout: ACTION_MS })
  step(`the decision brief is filled, including ${String(figureCount - 1)} named figures`)

  await lockTheDecision(page, runId, editor)
  step('the decision is locked')

  // --- the Turn ----------------------------------------------------------------------------------
  await page.waitForURL(new RegExp(`/runs/${runId}/turn$`), { timeout: 300_000 })
  await page.getByRole('heading', { level: 1, name: 'The Turn' }).waitFor({ timeout: ACTION_MS })
  await assertNoErrorOnScreen(page, 'the Turn')
  const turnKeys = await turnClaimKeys(page)
  for (const key of turnKeys) {
    const group = page.getByRole('radiogroup', { name: `Your stance on claim ${key}` })
    const checked = await group
      .getByRole('radio')
      .and(page.locator('[aria-checked="true"]'))
      .count()
    if (checked === 0) await group.getByRole('radio', { name: 'Verify' }).click()
  }
  const form = page.locator('#turn-response')
  await form.getByRole('radio', { name: 'Revise' }).click()
  await form.getByLabel('Why', { exact: true }).fill(TURN_WHY)
  await form.getByLabel('Confidence as a number').fill('48')
  await form.getByRole('button', { name: 'File the response' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/defense$`), { timeout: ACTION_MS })
  step(
    `the Turn arrived, ${String(turnKeys.length)} claims were re-stanced, and the response is filed`,
  )

  // --- the defense ---------------------------------------------------------------------------------
  await answerTheDefense(page)
  await page
    .locator('#defense-questions')
    .getByRole('button', { name: 'Finish the defense' })
    .click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Finish it' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}$`), { timeout: ACTION_MS })
  await assertNoErrorOnScreen(page, 'the run status')
  step('the defense is finished')

  await page
    .locator('#run-status')
    .getByRole('heading', { level: 2, name: 'Your debrief is ready' })
    .waitFor({ timeout: SCORING_MS })
  step('the run is scored')

  await page.getByRole('link', { name: 'Read the debrief' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/debrief$`), { timeout: ACTION_MS })
  await page.getByRole('heading', { level: 1, name: 'Run Debrief' }).waitFor({ timeout: ACTION_MS })
  const bands = await page.locator('#debrief-bands').getByText('Draft band').count()
  if (bands !== 7) fail('the debrief', `it shows ${String(bands)} draft bands, not seven`)
  await assertNoErrorOnScreen(page, 'the debrief')
  step('the debrief reads seven draft bands')

  // --- the trace ------------------------------------------------------------------------------------
  await page.goto(`${BASE}/runs/${runId}/record`, { waitUntil: 'domcontentloaded' })
  await assertNoErrorOnScreen(page, 'the judgment record')
  step('the judgment record opens')
}

/** The claim keys the assistant panel is showing, in the order it surfaced them. */
async function surfacedClaimKeys(page: Page): Promise<string[]> {
  const cards = page.locator('#assistant-panel').getByRole('article')
  const names = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  )
  return names.flatMap((name) => {
    const match = /^Claim (\S+)$/.exec(name.trim())
    return match?.[1] ? [match[1]] : []
  })
}

/** The claim keys the Turn put in front of the student. */
async function turnClaimKeys(page: Page): Promise<string[]> {
  const cards = page.locator('#turn-claims').getByRole('article')
  const names = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  )
  return names.flatMap((name) => {
    const match = /^Claim (\S+)$/.exec(name.trim())
    return match?.[1] ? [match[1]] : []
  })
}

/**
 * Locking the decision, including the gate that asks for a stance on a claim the brief leaned on.
 * Whether the gate fires is a property of the run, so both roads are walked.
 */
async function lockTheDecision(
  page: Page,
  runId: string,
  editor: ReturnType<Page['locator']>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await editor.getByRole('button', { name: 'Lock the decision' }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.waitFor({ timeout: ACTION_MS })
    await dialog.getByRole('button', { name: 'File it' }).click()

    const gate = dialog.filter({ hasText: 'A claim you leaned on has no stance' })
    if (await gate.isVisible().catch(() => false)) {
      await dialog.getByRole('button', { name: 'Go to the claim' }).click()
      const open = page.getByRole('radiogroup', { name: /^Your stance on claim / }).filter({
        hasNot: page.locator('[aria-checked="true"]'),
      })
      await open.first().getByRole('radio', { name: 'Accept' }).click()
      continue
    }

    await page.waitForURL(new RegExp(`/runs/${runId}/locked$`), { timeout: ACTION_MS })
    await page.getByRole('heading', { level: 1, name: 'Decision locked' }).waitFor({
      timeout: ACTION_MS,
    })
    await assertNoErrorOnScreen(page, 'the locked decision')
    return
  }
  fail('the lock', 'the decision would not file after three presses')
}

/** Every question the defense asks, answered in turn, follow-ups included. */
async function answerTheDefense(page: Page): Promise<void> {
  const questions = page.locator('#defense-questions')
  await page.getByRole('heading', { level: 1, name: 'The defense' }).waitFor({ timeout: ACTION_MS })
  for (let turn = 0; turn < 32; turn += 1) {
    const progress = await defenseProgress(page)
    if (progress.answered >= progress.total) {
      step(`the defense is answered: ${String(progress.total)} questions`)
      return
    }
    const item = questions
      .getByRole('listitem')
      .filter({ has: page.getByRole('textbox') })
      .last()
    await item.getByLabel('Your answer').fill(DEFENSE_ANSWERS[turn % DEFENSE_ANSWERS.length] ?? '')
    await item.getByRole('button', { name: 'Submit answer' }).click()
    const deadline = Date.now() + ACTION_MS
    while (Date.now() < deadline) {
      const next = await defenseProgress(page)
      if (next.answered > progress.answered) break
      await page.waitForTimeout(500)
    }
    await assertNoErrorOnScreen(page, 'the defense')
  }
  fail('the defense', 'it still had unanswered questions after thirty-two answers')
}

async function defenseProgress(page: Page): Promise<{ answered: number; total: number }> {
  const text = await page.locator('#defense-questions').innerText()
  const match = /(\d+)\s+of\s+(\d+)\s+answered/.exec(text)
  return { answered: Number(match?.[1] ?? 0), total: Number(match?.[2] ?? 0) }
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\nProving the whole road on ${BASE}`)
  console.log(`  package: ${title}`)
  console.log(`  family key: ${familyKey}`)
  console.log(`  scenario text: ${titleOnly ? 'none (title only)' : 'docs/qa/test-scenario.md'}\n`)

  let browser: Browser | undefined
  try {
    browser = await chromium.launch()
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const pageGuard = guard(page)
    const guards = [{ name: 'page', guard: pageGuard }]

    const versionPath = await authorThePackage(page)
    assertClean(guards, 'the authoring half')

    if (titleOnly) {
      console.log('\nPUBLISHED (title only). No run was taken on it.\n')
      report()
      return
    }

    const label = `${title} — proof run`
    await signOut(page)
    await assignIt(page, label)
    assertClean(guards, 'the assignment')

    await signOut(page)
    await takeTheRun(page, label)
    assertClean(guards, 'the run')

    console.log(
      `\nPASSED. ${title} is published at ${BASE}${versionPath} and a run on it is scored.\n`,
    )
    report()
  } finally {
    await browser?.close()
  }
}

function report(): void {
  const total = ((Date.now() - started) / 1000 / 60).toFixed(1)
  console.log(`  total: ${total} minutes, ${String(marks.length)} steps`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
