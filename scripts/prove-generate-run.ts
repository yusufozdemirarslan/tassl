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
/** The Turn arrives 60 to 120 seconds after the lock, on the server's clock, in real time. */
const TURN_WAIT_MS = 300_000

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
 * Everything the browser reports as wrong, for the whole session: console errors, uncaught page
 * errors, and any response the network answered 4xx or 5xx with.
 *
 * The console's own line for a failed request is dropped and the *response* is reported instead,
 * because the console says only "Failed to load resource: 404" while the response says which
 * resource — and a 404 nobody can name is not evidence of anything. What is ignored is the icon a
 * browser asks every site for whether or not it has one; everything else is a defect, including a
 * React warning raised as an error.
 */
function guard(page: Page): Guard {
  const errors: string[] = []
  const benign = /favicon|apple-touch-icon|\/_next\/static\/.*\.map$/i
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (/Failed to load resource|net::ERR_ABORTED/i.test(text)) return
    errors.push(`console: ${text}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('response', (response) => {
    const status = response.status()
    if (status < 400) return
    const url = response.url()
    if (benign.test(url)) return
    errors.push(`network: ${String(status)} ${url}`)
  })
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
  // Not pressed until React owns the box: the live character count on a field is the component's
  // own state, so waiting for the form to be interactive is what makes the press a submit the
  // component handles rather than the browser's native one (the trap D-182 found in WebKit).
  await page.waitForFunction(() => document.readyState === 'complete', undefined, {
    timeout: ACTION_MS,
  })
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

  // The generation screen is waited for by what is on it rather than by its address: it holds a
  // poll open from its first paint, so a `load` event can be minutes behind a page a person is
  // already reading.
  const started = await page
    .getByRole('list', { name: 'The seven steps' })
    .waitFor({ timeout: ACTION_MS })
    .then(() => true)
    .catch(() => false)
  if (!started) {
    const said = await page
      .locator('main')
      .innerText()
      .catch(() => '')
    fail(
      'Generate',
      `at ${page.url()}
${said.slice(0, 1200)}`,
    )
  }
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

  // The version picker is a listbox, not a native select, and it opens on the newest confirmed
  // version — which is the one that was just published. It is only opened when it is not already
  // showing the right package, because a listbox left open swallows the next press.
  const picker = form.getByLabel('Scenario package version')
  if (!(await picker.innerText()).includes(title)) {
    await picker.click()
    await page
      .getByRole('option', { name: new RegExp(escapeForRegExp(title)) })
      .first()
      .click()
    await page.getByRole('listbox').waitFor({ state: 'hidden', timeout: ACTION_MS })
  }
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
  //
  // Nothing here knows the package, so nothing here knows what will trigger a claim: the phrases a
  // claim is surfaced by are the author's, and this run's author was a model five minutes ago. So
  // the student asks the questions a student would — one of them built out of the brief in front of
  // them — until the assistant puts a claim on the table.
  const assistant = page.locator('#assistant-panel')
  const requests = [
    'What is the headline figure this decision rests on, and what is it stated on?',
    ...(await aboutTheDocuments(page)),
    await aboutTheBrief(page),
    'Summarise every figure in the Evidence Room that this decision depends on, and say where each one comes from.',
  ]

  let surfaced = 0
  for (const request of requests) {
    await assistant.getByLabel('Your request').fill(request)
    await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
    await assistant
      .locator('#assistant-reply-status')
      .filter({ hasText: /Reply complete/ })
      .waitFor({ timeout: REPLY_MS })
    await assertNoErrorOnScreen(page, 'the assistant reply')
    surfaced = await stanceGroups(assistant).count()
    if (surfaced > 0) break
  }
  step(`the assistant answered and surfaced ${String(surfaced)} claims`)

  const stanced = await takeAStanceOnEach(page, assistant, 'Verify')
  if (stanced > 0) step(`a stance on each of the ${String(stanced)} claims on the table`)

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
  // The named fields are the package's own — their labels and their units are whatever its author
  // wrote — so they are found by the id the editor gives every one of them rather than by a name
  // this script would have to know.
  const figures = editor.locator('[id^="brief-named-"]')
  const figureCount = await figures.count()
  for (let index = 0; index < figureCount; index += 1) {
    await figures.nth(index).fill('12')
  }
  await editor.getByText('Saved.', { exact: true }).waitFor({ timeout: ACTION_MS })
  step(`the decision brief is filled, including ${String(figureCount)} named figures`)

  await lockTheDecision(page, runId, editor)
  step('the decision is locked')

  // --- the Turn ----------------------------------------------------------------------------------
  //
  // Nothing is pressed: the locked page polls, and it opens the Turn when the clock makes it due.
  // What is waited for is the heading rather than the address, because the run screens hold a poll
  // open and a `load` event can be a long way behind a page that is already on the screen.
  await page.getByRole('heading', { level: 1, name: 'The Turn' }).waitFor({ timeout: TURN_WAIT_MS })
  await assertNoErrorOnScreen(page, 'the Turn')
  const reStanced = await takeAStanceOnEach(page, page.locator('#turn-claims'), 'Verify')
  const form = page.locator('#turn-response')
  await form.getByRole('radio', { name: 'Revise' }).click()
  await form.getByLabel('Why', { exact: true }).fill(TURN_WHY)
  await form.getByLabel('Confidence as a number').fill('48')
  await form.getByRole('button', { name: 'File the response' }).click()
  const opened = await page
    .getByRole('heading', { level: 1, name: 'The defense' })
    .waitFor({ timeout: ACTION_MS })
    .then(() => true)
    .catch(() => false)
  if (!opened) {
    const text = await page
      .locator('main')
      .innerText()
      .catch(() => 'no main')
    fail(
      'the Turn response',
      `at ${page.url()}
${text.slice(0, 1500)}`,
    )
  }
  step(`the Turn arrived, ${String(reStanced)} claims are stanced, and the response is filed`)

  // --- the defense ---------------------------------------------------------------------------------
  await answerTheDefense(page)
  await page
    .locator('#defense-questions')
    .getByRole('button', { name: 'Finish the defense' })
    .click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Finish it' }).click()
  await page.getByRole('heading', { level: 1, name: 'Run status' }).waitFor({ timeout: ACTION_MS })
  await assertNoErrorOnScreen(page, 'the run status')
  step('the defense is finished')

  await page
    .locator('#run-status')
    .getByRole('heading', { level: 2, name: 'Your debrief is ready' })
    .waitFor({ timeout: SCORING_MS })
  step('the run is scored')

  await page.getByRole('link', { name: 'Read the debrief' }).click()
  await page.getByRole('heading', { level: 1, name: 'Run Debrief' }).waitFor({ timeout: ACTION_MS })
  const bands = await page.locator('#debrief-bands').getByText('Draft band').count()
  if (bands !== 7) fail('the debrief', `it shows ${String(bands)} draft bands, not seven`)
  await assertNoErrorOnScreen(page, 'the debrief')
  step('the debrief reads seven draft bands')

  // --- the trace ------------------------------------------------------------------------------------
  //
  // The trace is the record of everything the run did, and it is read on the instructor's replay
  // rather than by the student: it carries the warranted stances and the evidence statuses, which
  // is exactly what a student may not see before their run is scored (12 §8.1).
  await signOut(page)
  await signIn(page, INSTRUCTOR)
  await rail(page, 'Review').click()
  await page.getByRole('heading', { level: 2, name: 'Runs waiting for you' }).waitFor({
    timeout: ACTION_MS,
  })
  await page
    .getByRole('link', { name: /^Open the replay for / })
    .first()
    .click()
  await page.waitForURL(/\/review\/runs\/[0-9a-f-]{36}/, { timeout: ACTION_MS })
  await assertNoErrorOnScreen(page, 'the replay')
  await page
    .getByRole('navigation', { name: 'Replay views' })
    .getByRole('link', { name: 'Trace', exact: true })
    .click()
  await page
    .getByRole('heading', { level: 2, name: 'The run’s trace' })
    .waitFor({ timeout: ACTION_MS })
  await page
    .locator('#replay-trace')
    .getByRole('columnheader', { name: 'Clock left' })
    .waitFor({ timeout: ACTION_MS })
  await assertNoErrorOnScreen(page, 'the trace')
  step('the instructor reads the run’s trace')
}

/**
 * A question for each of the first few documents in the Evidence Room, by name.
 *
 * This is the likeliest thing to reach a claim: a claim's trigger phrases are its author's words
 * about the figures in this case, and the document titles are where those figures live. A student
 * who has just read the room asks about what is in it.
 */
async function aboutTheDocuments(page: Page): Promise<string[]> {
  const titles = await page
    .locator('#evidence-room')
    .getByRole('button', { name: /^Open / })
    .evaluateAll((nodes) =>
      nodes.map((node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim()),
    )
    .catch(() => [] as string[])
  return titles
    .map((label) => label.replace(/^Open\s+/, '').trim())
    .filter((title) => title !== '')
    .slice(0, 3)
    .map((title) => `What does "${title}" say, and what figure does it put on the table?`)
}

/**
 * A question made out of the brief the student is reading.
 *
 * A claim is surfaced by the phrases its author wrote on it, and this package's author is a model
 * that wrote them from this brief — so the brief's own words are the likeliest thing to reach one.
 */
async function aboutTheBrief(page: Page): Promise<string> {
  const brief = await page
    .locator('#scenario-brief')
    .innerText()
    .catch(() => '')
  const words = brief
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter((word) => word !== '')
    .slice(2, 26)
    .join(' ')
  return words === ''
    ? 'What does the Evidence Room say about the decision in the brief?'
    : `What do the documents say about this: ${words}`
}

/**
 * The stance controls on a screen, whichever claims they belong to.
 *
 * Named by the group rather than by the claim on purpose: a card's key is this package's own — it
 * was written five minutes ago — and a card's accessible name is not always an `aria-label` this
 * script could read off the node. The radiogroup is the control, and the control is what a student
 * presses.
 */
const stanceGroups = (scope: ReturnType<Page['locator']>) =>
  scope.getByRole('radiogroup', { name: /^Your stance on claim / })

/** A stance on every claim in `scope` that has none; answers how many were in front of the student. */
async function takeAStanceOnEach(
  page: Page,
  scope: ReturnType<Page['locator']>,
  stance: string,
): Promise<number> {
  const groups = await stanceGroups(scope).all()
  for (const group of groups) {
    if ((await group.locator('[role="radio"][aria-checked="true"]').count()) > 0) continue
    await group.getByRole('radio', { name: stance }).click()
    await page.waitForTimeout(250)
  }
  return groups.length
}

/**
 * Locking the decision, and the gate that asks for a stance on a claim the brief leaned on.
 *
 * Whether the gate fires is a property of the run rather than of the flow: a figure typed into a
 * named field is reliance on whatever claim carries it (D-076), and this script does not know what
 * the package's claims carry. So both roads are walked — the claim is stanced where the screen can
 * reach it, and where it cannot the figures come out of the brief, which is a decision a student
 * may also file.
 */
async function lockTheDecision(
  page: Page,
  runId: string,
  editor: ReturnType<Page['locator']>,
): Promise<void> {
  const locked = new RegExp(`/runs/${runId}/locked$`)

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await editor.getByRole('button', { name: 'Lock the decision' }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.waitFor({ timeout: ACTION_MS })
    const gate = dialog.getByRole('button', { name: 'Go to the claim' })
    await dialog.getByRole('button', { name: 'File it' }).click()

    const outcome = await Promise.race([
      page
        .waitForURL(locked, { timeout: 30_000 })
        .then(() => 'locked' as const)
        .catch(() => 'stuck' as const),
      gate
        .waitFor({ timeout: 30_000 })
        .then(() => 'gate' as const)
        .catch(() => 'stuck' as const),
    ])

    if (outcome === 'locked') {
      await page.getByRole('heading', { level: 1, name: 'Decision locked' }).waitFor({
        timeout: ACTION_MS,
      })
      await assertNoErrorOnScreen(page, 'the locked decision')
      return
    }

    if (outcome === 'gate') {
      await gate.click()
      await dialog.waitFor({ state: 'hidden', timeout: ACTION_MS })
      const open = page
        .getByRole('radiogroup', { name: /^Your stance on claim / })
        .filter({ hasNot: page.locator('[aria-checked="true"]') })
      if ((await open.count()) > 0) {
        await open.first().getByRole('radio', { name: 'Accept' }).click()
        step('a stance was taken on the claim the brief leaned on')
        continue
      }
      // The claim is not on the screen to stance: the figure that leaned on it comes out instead.
      const figures = editor.locator('[id^="brief-named-"]')
      const count = await figures.count()
      for (let index = 0; index < count; index += 1) await figures.nth(index).fill('')
      await editor.getByText('Saved.', { exact: true }).waitFor({ timeout: ACTION_MS })
      step('the figures came out of the brief: the claim they leaned on was never surfaced')
      continue
    }

    const said = await dialog.innerText().catch(() => '')
    const form = await editor.innerText().catch(() => '')
    fail(
      'the lock',
      `the decision would not file.
Dialog:
${said}

Editor:
${form}`,
    )
  }
  fail('the lock', 'the decision would not file after four presses')
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
