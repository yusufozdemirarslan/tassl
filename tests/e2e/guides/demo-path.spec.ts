// The demo path, click by click (docs/guides/demo-runbook.md §2), as one test.
//
// The runbook's part 2 is a table of twenty-seven rows across six parts — instructor set-up, the
// student's defective run, the instructor's review, the student's debrief and record, the auto-lock
// run with its correction and void, and the sound variant on the second student seat — and this
// spec is that table read top to bottom: every numbered row is a `test.step` whose title is the
// row's Click cell (`scripts/check-guide-coverage.ts` holds the two to each other), the body
// presses what the cell says and asserts what it says appears, and a screenshot is taken at the
// end of every row.
//
// Two seats are in the room, as the runbook's seat plan has them (§5): the Instructor profile and
// the Student profile, one browser context each. The student is the suite's own `page` — the
// console-error guard and the settled navigation of ./fixtures ride on it — and the instructor is
// a second context opened here with the same options, guarded the same way. Part F signs the
// student seat out and in again as student2, in the same context, because that is what the
// runbook has the presenter do at one keyboard.
//
// The clocks are real in production and shifted locally. `passTime` tries the test-only
// advance-clock route (D-109): under `APP_ENV=test` it shifts the run's timeline and the next poll
// materializes what the clock made true; in production the route answers 404 and the wait is the
// real one — ninety seconds for the Turn, two minutes for the auto-lock — polled on the run's own
// state rather than slept through. What the student sees afterwards is asserted the same way in
// both cases: the page moves itself.
//
// Rows 12 and 22 reach a live run's replay from the assignment page — the Replay column of
// D-695 — rather than from a typed address, as the runbook's warm-up and break-glass do too.
//
// The step titles are the runbook's Click cells, which name every control by the words a sighted
// presenter sees; the locators underneath keep the accessible names (a `Start` button is found as
// "Start Decision Run 1 (walkthrough)", the account icon as "Account: Student One"), so a title
// and the locator it drives can differ in wording and never in target.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import {
  SCREENSHOT_ROOT,
  SEED_PASSWORD,
  WRITE_HEADERS,
  expect,
  guardNetwork,
  runIdFromUrl,
  test,
} from './fixtures'

test.describe.configure({ mode: 'serial' })
test.use({ persona: 'demo' })

// ---------------------------------------------------------------------------------------------
// What the runbook names
// ---------------------------------------------------------------------------------------------

const INSTRUCTOR_EMAIL = 'instructor@tassl.local'
const STUDENT_ONE_EMAIL = 'student1@tassl.local'
const STUDENT_TWO_EMAIL = 'student2@tassl.local'
const STUDENT_ONE = 'Student One'
const STUDENT_TWO = 'Student Two'

const COURSE = 'Marketing Strategy Walkthrough'
const PACKAGE = 'Meridian Roast (fixture)'
const WALKTHROUGH_RUN = 'Decision Run 1 (walkthrough)'
const SOUND_RUN = 'Decision Run 1 (sound)'
const AUTO_LOCK_RUN = 'Auto-lock test run'

/** Row 8's frame, typed as the runbook has it; row 23 types the same five texts. */
const FRAME = {
  decision:
    "Whether to move the quarter's acquisition budget toward the premium tier, and how far.",
  assumptions: [
    'The premium payback figure in the board deck still holds.',
    'The value tier is close to saturation.',
    'Premium cohorts retain at the level the deck reports.',
  ],
  position:
    "I lean toward shifting a larger share of the budget to premium, because the deck's payback looks short and the value tier looks saturated. I have not checked either figure yet.",
  confidence: '55',
} as const

/** Row 21's frame: one sentence in each field and 50. */
const AUTO_LOCK_FRAME = {
  decision: 'Whether to hold the premium share for the quarter.',
  assumptions: [
    'The board deck is current.',
    'The value tier is saturated.',
    'Premium retention holds.',
  ],
  position: 'I lean toward holding the share until the figures are checked.',
  confidence: '50',
} as const

const FIRST_REQUEST = 'What is the premium payback?'
const SECOND_REQUEST =
  'What is the price sensitivity, is the value tier saturated, and what did the survey find?'
const OUTAGE_REQUEST = 'What does the survey say about premium?'
const SOUND_REQUEST = 'What is the value tier payback?'

const ESCALATION = 'I cannot tell whether the survey sample is representative.'
const ESCALATION_REPLY = 'Rowan Adeyemi, research operations. Two things about that number.'
const WHY_ASKED = 'I wanted the payback figure before sizing the premium share.'
const DECLARATION = 'A calculator, to check the division.'

/** Row 13's brief. */
const BRIEF = {
  recommendation:
    "Move the premium share of the quarter's acquisition budget from 15 percent to 40 percent, on the eleven-month payback.",
  why: 'The positioning review puts premium payback at eleven months and the value tier is saturated, so the marginal dollar earns more on premium. The survey supports demand. I did not trace the payback figure to its source.',
  assumptions: [
    'Premium payback is eleven months.',
    'The value tier is saturated.',
    'Premium cohorts retain at 78 percent at month three.',
  ],
  changeMyMind:
    "A payback figure above fifteen months, or premium retention well below the deck's number.",
  confidence: '62',
  share: '40',
  payback: '11',
} as const

const ADDENDUM = 'I did not trace the payback figure; with more time I would check it first.'

const TURN_RESPONSE = {
  why: 'Month-three retention on cohort P2 is 61 percent, not 78, so the premium payback is longer than I bet on. I hold the direction and cut the premium share back.',
  confidence: '48',
} as const

/** Row 24's brief on the sound variant. */
const SOUND_BRIEF = {
  recommendation:
    'Hold the premium share at 15 percent and put the marginal dollar into the value tier.',
  why: 'The value tier payback is short and its retention holds; premium is unproven at scale.',
  assumptions: [
    'Value tier payback holds.',
    'Premium retention is unproven.',
    'The budget is fixed for the quarter.',
  ],
  changeMyMind: 'A premium payback under twelve months on a traced figure.',
  confidence: '60',
  share: '15',
} as const

const SOUND_TURN_RESPONSE = {
  why: 'Retention on P2 is lower than reported, so I keep the direction and move a little more to the value tier.',
  confidence: '50',
} as const

/** Row 15's one answer from memory, on the provenance question: it earns the follow-up (FR-123). */
const FROM_MEMORY = 'I do not know.'
const PROVENANCE_QUESTION = /Where did the payback figure come from/

/**
 * Every other defense answer. Each carries a digit and a reason marker, so none earns a follow-up
 * of its own (FR-123, D-031) and the interview ends where the runbook says it does.
 */
const DEFENSE_ANSWERS = [
  'I priced this on the 11-month payback because it was the one premium figure in front of me, and I said in the brief that I had not traced it.',
  'I did not settle it, because the 1 memo that would have dated the figure was not one I opened, so I filed the decision that survives either answer.',
  'I moved my confidence to 48 because the person quoting the retention number corrected it, and the share I set was priced on the old one.',
] as const

const OVERRIDE_NOTE = 'The payback figure needed a one-minute trace.'
const CORRECTION_NOTE = 'Demonstration of a correction.'

const DEBRIEF_ANSWERS = {
  stanceToChange: 'Challenge on C3: the deck was superseded.',
  doDifferently: 'Trace every figure I type into a named field.',
} as const

const SOUND_DEBRIEF_ANSWERS = {
  stanceToChange: 'Verify on C1 rather than accept it without a trace.',
  doDifferently: 'Trace the one figure the recommendation rests on before writing the brief.',
} as const

const GRAPH_TITLES = ['Confidence line', 'Clock timeline', 'Stance matrix', 'Frame beside decision']

// ---------------------------------------------------------------------------------------------
// Patience
// ---------------------------------------------------------------------------------------------

/** Every save ends in `router.refresh()`, and the recharts graphs arrive in a deferred chunk. */
const ACTION_TIMEOUT_MS = 20_000
const GRAPH_TIMEOUT_MS = 20_000
/**
 * Scoring, on the model this deployment actually runs (QA-071).
 *
 * Thirty seconds was sized for the scripted assistant, which `docs/qa/demo-path.md` measures at
 * under five. Against production on the live model it is the seven scored dimensions' worth of
 * generation: 22.6 s for the walkthrough run and 33.2 s for the sound one, read off
 * `scored_at - defense_completed_at`, so the old bound failed a run that had scored three seconds
 * later. Two minutes is well inside NFR-001's ten for the debrief and still fails fast on a run
 * that is held rather than slow.
 */
const SCORING_TIMEOUT_MS = 120_000
/** The run band polls every five seconds; a page that moves itself does so inside this. */
const PAGE_MOVES_TIMEOUT_MS = 60_000
/** The live model takes 3 to 13 seconds per reply (runbook §facts); the scripted one is instant. */
const REPLY_TIMEOUT_MS = 60_000

// ---------------------------------------------------------------------------------------------
// The two seats
// ---------------------------------------------------------------------------------------------

/**
 * The same browser noise ./fixtures ignores on the suite's own page, for the second context —
 * kept identical to that list: the engine quirks, the one error status a guide describes on
 * purpose (the assistant outage of row 12, a 503 the browser reports as a failed resource), and
 * WebKit's ResizeObserver notice around the graphs.
 */
const IGNORED_CONSOLE_PATTERNS: RegExp[] = [
  /Fetch API cannot load .* due to access control checks/,
  /Load failed/,
  /NS_BINDING_ABORTED/,
  /Failed to load resource: the server responded with a status of 503/,
  /ResizeObserver loop completed with undelivered notifications/,
]

/** The fixtures' console guard, for a page this spec opened itself. */
function guardConsole(target: Page): string[] {
  const errors: string[] = []
  const ignored = (text: string): boolean =>
    IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))
  target.on('pageerror', (error) => {
    if (ignored(error.message)) return
    errors.push(`pageerror: ${error.message}`)
  })
  target.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (ignored(text)) return
    errors.push(`console.error: ${text}`)
  })
  return errors
}

/** The rail item of the shell (`<nav aria-label="Primary">`). */
const rail = (target: Page, name: string) =>
  target.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name, exact: true })

/**
 * Opens one of the replay's five views (`<nav aria-label="Replay views">`) and waits until the
 * address carries it: the views are links, and a press that lands while the replay is still
 * arriving is otherwise followed by an assertion against the view that was there before.
 */
async function openReplayTab(target: Page, name: string): Promise<void> {
  await target
    .getByRole('navigation', { name: 'Replay views' })
    .getByRole('link', { name, exact: true })
    .click()
  await target.waitForURL(new RegExp(`tab=${name.toLowerCase()}`))
}

/** One of the course's four views (`<nav aria-label="Course views">`). */
const courseTab = (target: Page, name: string) =>
  target.getByRole('navigation', { name: 'Course views' }).getByRole('link', { name, exact: true })

/** The sign-in form, driven as the runbook's rows 1, 5 and 23 drive it. */
async function signInThroughTheForm(target: Page, email: string): Promise<void> {
  await expect(target.getByRole('heading', { level: 1, name: 'Sign in to Tassl' })).toBeVisible()
  await target.getByLabel('Email address').fill(email)
  await target.getByLabel('Password').fill(SEED_PASSWORD)
  await target.getByRole('button', { name: 'Sign in', exact: true }).click()
  await target.waitForURL(/\/home$/)
  await expect(target.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
}

/**
 * The door D-695 opened: Courses → the course → Assignments → the assignment → the run's replay.
 * Returns the run id the replay is of.
 */
async function openTheReplayFromTheAssignment(
  instructor: Page,
  assignment: string,
  student: string,
): Promise<string> {
  await rail(instructor, 'Courses').click()
  await expect(instructor.getByRole('heading', { level: 1, name: 'Courses' })).toBeVisible()
  await instructor.getByRole('link', { name: `Open ${COURSE}` }).click()
  await expect(instructor.getByRole('heading', { level: 1, name: COURSE })).toBeVisible()
  await courseTab(instructor, 'Assignments').click()
  await instructor.getByRole('link', { name: `Configure ${assignment}` }).click()
  await expect(instructor.getByRole('heading', { level: 1, name: assignment })).toBeVisible()
  await instructor.getByRole('link', { name: `Open the replay for ${student}` }).click()
  await instructor.waitForURL(/\/review\/runs\/[0-9a-f-]{36}/)
  await expect(instructor.getByRole('heading', { level: 1, name: student })).toBeVisible()
  return runIdFromUrl(instructor.url())
}

// ---------------------------------------------------------------------------------------------
// The run, as the student takes it
// ---------------------------------------------------------------------------------------------

type RunView = {
  state: string
  clock: { remainingMs: number; paused: boolean } | null
  turn: { dueAt: string | null } | null
}

/** The run as its own student reads it; the read is what materializes a timer (D-042). */
async function readRun(page: Page, runId: string): Promise<RunView> {
  const response = await page.request.get(`/api/v1/runs/${runId}`)
  expect(response.status(), `GET /runs/${runId}: ${await response.text()}`).toBe(200)
  return (await response.json()) as RunView
}

/**
 * Lets `ms` of a run's clock pass.
 *
 * Under `APP_ENV=test` the advance-clock route shifts the run's whole timeline (D-109) and the
 * next read materializes what that made true. In production the route does not exist — it answers
 * 404 before it looks at a session — so the wait is the real one: the run is polled until
 * `arrived` says the clock has done its work, with the runbook's own ceiling on top of `ms`.
 */
async function passTime(
  page: Page,
  runId: string,
  ms: number,
  arrived: (run: RunView) => boolean,
): Promise<void> {
  const shift = Math.max(1_000, Math.ceil(ms))
  const response = await page.request.post(`/api/v1/test/runs/${runId}/advance-clock`, {
    data: { ms: shift },
    headers: WRITE_HEADERS,
  })
  if (response.status() === 200) return
  expect(
    response.status(),
    `advance-clock ${runId} answered neither 200 nor 404: ${await response.text()}`,
  ).toBe(404)
  await expect
    .poll(async () => arrived(await readRun(page, runId)), {
      timeout: shift + 40_000,
      intervals: [2_000],
      message: `the clock should have moved the run on within ${String(shift)} ms`,
    })
    .toBe(true)
}

/** Sixteen items, the submit, the concept map, and the way into the scenario (rows 6, 21, 23). */
async function takeTheReadinessCheck(page: Page, runId: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Readiness Check' })).toBeVisible()
  // Eight minutes, counted down from a server timestamp: 08:00 or a second or two under it.
  await expect(page.getByRole('timer', { name: 'Readiness Check clock' })).toHaveText(
    /^0[78]:[0-5][0-9]$/,
  )
  const navigator = page.getByRole('toolbar', { name: 'Items' })
  for (let position = 1; position <= 16; position += 1) {
    await expect(page.getByText(`Item ${String(position)} of 16`)).toBeVisible()
    // Which option is chosen is arbitrary and must be: no response says which one is right.
    await page.getByRole('radiogroup').getByRole('radio').first().click()
    await expect(
      navigator.getByRole('button', { name: `Item ${String(position)}, answered` }),
    ).toBeVisible()
    if (position < 16) await page.getByRole('button', { name: 'Next item' }).click()
  }
  await expect(page.getByText('16 of 16 answered')).toBeVisible()
  await page.getByRole('button', { name: 'Submit the check' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Submit the Readiness Check?')
  await confirm.getByRole('button', { name: 'Submit', exact: true }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/readiness/result$`))
  await expect(page.getByRole('heading', { level: 1, name: 'What the check read' })).toBeVisible()
  await page.getByRole('link', { name: 'Open the scenario' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/work$`))
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()
}

type Frame = {
  decision: string
  assumptions: readonly [string, string, string]
  position: string
  confidence: string
}

/** The frame, typed and locked for good (rows 8, 21, 23). */
async function lockTheFrame(page: Page, frame: Frame): Promise<void> {
  await page.getByLabel('The decision').fill(frame.decision)
  for (const [index, assumption] of frame.assumptions.entries()) {
    await page.getByLabel(`Assumption ${String(index + 1)}`).fill(assumption)
  }
  await page.getByLabel('Your position now').fill(frame.position)
  await page.getByRole('spinbutton', { name: 'Confidence as a number' }).fill(frame.confidence)
  await page.getByRole('button', { name: 'Lock the frame' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Lock the frame permanently?')
  await confirm.getByRole('button', { name: 'Lock it' }).click()
  await expect(page.locator('[data-state="working"]')).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
}

/**
 * One request, asked the way a student asks it — and not sent until React owns the box: the live
 * character count is the panel's own state, so waiting for it is the proof that the field this
 * browser submits is the one the component holds (the trap D-182 found in WebKit).
 */
async function ask(page: Page, request: string, announced: string): Promise<void> {
  const assistant = page.locator('#assistant-panel')
  await assistant.getByLabel('Your request').fill(request)
  await expect(assistant.getByText(`${String(request.length)} of 2000 characters`)).toBeVisible()
  await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
  await expect(assistant.locator('#assistant-reply-status')).toHaveText(announced, {
    timeout: REPLY_TIMEOUT_MS,
  })
}

/** The one copy of a claim that carries the controls (D-313), wherever the screen put it. */
const stances = (page: Page, key: string) =>
  page.getByRole('radiogroup', { name: `Your stance on claim ${key}` })

/** A stance, taken and confirmed by the screen's own announcement before the next act. */
async function takeStance(page: Page, key: string, stance: string): Promise<void> {
  await stances(page, key).getByRole('radio', { name: stance }).click()
  await expect(stances(page, key).getByRole('radio', { name: stance })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(page.locator('#run-announcer')).toHaveText(`Stance on claim ${key}: ${stance}.`)
}

/** The interview's progress line, `{answered} of {total} answered`. */
async function defenseProgress(page: Page): Promise<{ answered: number; total: number }> {
  const line = page.locator('#defense-questions').getByText(/^\d+ of \d+ answered$/)
  const match = /^(\d+) of (\d+) answered$/.exec((await line.innerText()).trim())
  if (!match) throw new Error('the defense has no progress line')
  return { answered: Number(match[1]), total: Number(match[2]) }
}

/**
 * Every question of the defense, answered on the screen in the order it asks them. A question
 * matching `fromMemoryOn` gets the runbook's "I do not know." and is asserted to earn its
 * follow-up; the follow-up is then answered like any other question.
 */
async function answerTheDefense(page: Page, fromMemoryOn?: RegExp): Promise<void> {
  const questions = page.locator('#defense-questions')
  await expect(page.getByRole('heading', { level: 1, name: 'The defense' })).toBeVisible()
  for (let turn = 0; turn < 24; turn += 1) {
    const before = await defenseProgress(page)
    if (before.answered >= before.total) return
    // The one item with a box: a follow-up nests under its question, so the innermost wins.
    const item = questions
      .getByRole('listitem')
      .filter({ has: page.getByRole('textbox') })
      .last()
    const asked = (await item.getByRole('heading').first().innerText()).trim()
    const fromMemory = fromMemoryOn?.test(asked) ?? false
    const answer = fromMemory ? FROM_MEMORY : DEFENSE_ANSWERS[turn % DEFENSE_ANSWERS.length]
    await item.getByLabel('Your answer').fill(answer as string)
    await item.getByRole('button', { name: 'Submit answer' }).click()
    await expect
      .poll(async () => (await defenseProgress(page)).answered, { timeout: ACTION_TIMEOUT_MS })
      .toBe(before.answered + 1)
    if (fromMemory) await expect(questions.getByText('Follow-up', { exact: true })).toBeVisible()
  }
  throw new Error('the defense still had unanswered questions after twenty-four answers')
}

/** The finish, the status page, and the sentence that says the debrief is there (rows 15, 25). */
async function finishTheDefense(page: Page, runId: string): Promise<void> {
  await page
    .locator('#defense-questions')
    .getByRole('button', { name: 'Finish the defense' })
    .click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Finish the defense?')
  await confirm.getByRole('button', { name: 'Finish it' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Run status' })).toBeVisible()
  // The server scores the run inside the request that finished the defense, so the page can be
  // past "being scored" by the time it renders; what it says is one of the sentences a run between
  // the defense and the debrief can carry, and then the one the runbook waits for.
  const status = page.locator('#run-status')
  await expect(status.getByRole('heading', { level: 2 })).toHaveText(
    /^(Your run is being scored|Your defense is in|Your debrief is ready)$/,
  )
  await expect(
    status.getByRole('heading', { level: 2, name: 'Your debrief is ready' }),
  ).toBeVisible({ timeout: SCORING_TIMEOUT_MS })
}

/** The one visible dimension name → the draft band its card reads, off the card itself. */
async function draftedBand(card: ReturnType<Page['locator']>): Promise<string> {
  const match = /Draft: (Novice|Developing|Proficient|Professional)/.exec(await card.innerText())
  if (!match?.[1]) throw new Error('the card names no draft band')
  return match[1]
}

// ---------------------------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------------------------

test('@smoke the demo path, click by click', async ({
  page,
  browser,
  browserName,
  contextOptions,
}) => {
  // Two runs typed on screen, two Turns, two defenses and a review: twenty minutes of patience.
  test.setTimeout(20 * 60_000)

  // The Instructor profile: its own context with the suite's options (viewport, locale, the
  // per-test client address), and the same console guard the Student profile carries.
  const instructorContext = await browser.newContext(contextOptions)
  const instructor = await instructorContext.newPage()
  const instructorErrors = guardConsole(instructor)
  const instructorFailures = guardNetwork(instructor)

  // Screenshots, one per row, under the demo persona: `task-01-step-NN.png`, the demo path being
  // the runbook's one task. Written by chromium alone, as ./fixtures' `shot` writes, and with the
  // same third argument: `show` is what the row's Say describes when that sits below the fold, and
  // it is scrolled into view on every engine before chromium captures (D-714).
  const screenshots = join(SCREENSHOT_ROOT, 'demo')
  mkdirSync(screenshots, { recursive: true })
  const capture = async (step: number, target: Page, show?: Locator): Promise<void> => {
    await target.waitForLoadState('domcontentloaded')
    if (show) {
      await expect(show).toBeVisible()
      await show.scrollIntoViewIfNeeded()
    }
    if (browserName !== 'chromium') return
    await target.screenshot({
      path: join(screenshots, `task-01-step-${String(step).padStart(2, '0')}.png`),
      fullPage: false,
      animations: 'disabled',
    })
  }

  let runId = ''
  let autoRunId = ''
  let soundRunId = ''
  let paybackClaimText = ''

  // =========================================================================================
  // A. Instructor set-up
  // =========================================================================================

  await test.step('1 Open https://tassl.vercel.app/sign-in → Email address instructor@tassl.local → Password → Sign in → Home.', async () => {
    await instructor.goto('/sign-in')
    await instructor.waitForLoadState('networkidle')
    await signInThroughTheForm(instructor, INSTRUCTOR_EMAIL)
    await capture(1, instructor)
  })

  await test.step('2 Packages → the row Meridian Roast (fixture) shows Confirmed and Uncalibrated → Meridian Roast (fixture) on that row → read This version (Working clock, Turn delay), Confirmation record, Claims.', async () => {
    await rail(instructor, 'Packages').click()
    await expect(instructor.getByRole('heading', { level: 1, name: 'Packages' })).toBeVisible()
    const row = instructor.getByRole('row').filter({ hasText: PACKAGE })
    await expect(row).toContainText('Confirmed')
    await expect(row).toContainText('Uncalibrated')
    await instructor.getByRole('link', { name: `Open ${PACKAGE}, version 1` }).click()
    await expect(instructor.getByRole('heading', { level: 1, name: PACKAGE })).toBeVisible()
    await expect(instructor.getByRole('heading', { level: 2, name: 'This version' })).toBeVisible()
    const identity = instructor.locator('#version-identity')
    await expect(identity).toContainText('Working clock')
    await expect(identity).toContainText('Turn delay')
    const record = instructor.getByRole('heading', { level: 2, name: 'Confirmation record' })
    await expect(record).toBeVisible()
    await expect(instructor.getByRole('heading', { level: 2, name: 'Claims' })).toBeVisible()
    // The Say's "this table" is the confirmation record, which sits under the version's identity.
    await capture(2, instructor, record)
  })

  await test.step('3 Courses → Marketing Strategy Walkthrough → Assignments → Decision Run 1 (walkthrough) → point at Scenario package version, the Variant radios Defective and Sound, Working clock (seconds), the Walkthrough switch.', async () => {
    await rail(instructor, 'Courses').click()
    await expect(instructor.getByRole('heading', { level: 1, name: 'Courses' })).toBeVisible()
    await instructor.getByRole('link', { name: `Open ${COURSE}` }).click()
    await expect(instructor.getByRole('heading', { level: 1, name: COURSE })).toBeVisible()
    await courseTab(instructor, 'Assignments').click()
    await instructor.getByRole('link', { name: `Configure ${WALKTHROUGH_RUN}` }).click()
    await expect(instructor.getByRole('heading', { level: 1, name: WALKTHROUGH_RUN })).toBeVisible()
    await expect(instructor.getByLabel('Scenario package version')).toBeVisible()
    await expect(instructor.getByText('Variant', { exact: true })).toBeVisible()
    await expect(instructor.getByRole('radio', { name: 'Defective' })).toBeVisible()
    await expect(instructor.getByRole('radio', { name: 'Sound' })).toBeVisible()
    await expect(instructor.getByLabel('Working clock (seconds)')).toBeVisible()
    await expect(instructor.getByRole('switch', { name: 'Walkthrough' })).toBeVisible()
    await capture(3, instructor)
  })

  await test.step('4 Back to the course → Policy: Outside-AI policy is Declared, Default run weight 2.5 → Mapping: Novice 1, Developing 2, Proficient 3, Professional 4.', async () => {
    await instructor.getByRole('link', { name: 'Back to the course' }).click()
    await expect(instructor.getByRole('heading', { level: 1, name: COURSE })).toBeVisible()
    await courseTab(instructor, 'Policy').click()
    await expect(instructor.getByText('Outside-AI policy')).toBeVisible()
    await expect(instructor.getByRole('radio', { name: 'Declared' })).toBeChecked()
    await expect(instructor.getByLabel('Default run weight')).toHaveValue('2.5')
    await courseTab(instructor, 'Mapping').click()
    await expect(instructor.getByLabel('Novice')).toHaveValue('1')
    await expect(instructor.getByLabel('Developing')).toHaveValue('2')
    await expect(instructor.getByLabel('Proficient')).toHaveValue('3')
    await expect(instructor.getByLabel('Professional')).toHaveValue('4')
    await capture(4, instructor)
  })

  // =========================================================================================
  // B. The student runs the defective variant
  // =========================================================================================

  await test.step('5 Sign in as student1@tassl.local → Runs → Start on the Decision Run 1 (walkthrough) row → the page Before you begin: This run counts toward the course grade. Run one counts., Weight 2.5 percent of the course grade, Declare what you use outside Tassl, the table What a confirmed band is worth, The working clock 25 minutes with Uncalibrated, The Readiness Check comes first → Begin the Readiness Check.', async () => {
    await page.goto('/sign-in')
    await signInThroughTheForm(page, STUDENT_ONE_EMAIL)
    await page.bringToFront()
    await rail(page, 'Runs').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
    await page
      .getByRole('row')
      .filter({ hasText: WALKTHROUGH_RUN })
      .getByRole('button', { name: `Start ${WALKTHROUGH_RUN}` })
      .click()
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}\/start$/)
    runId = runIdFromUrl(page.url())
    await expect(page.getByRole('heading', { level: 1, name: 'Before you begin' })).toBeVisible()
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'This run counts toward the course grade. Run one counts.',
      }),
    ).toBeVisible()
    const counts = page.locator('#run-counts')
    await expect(counts).toContainText('Weight')
    await expect(counts).toContainText('2.5 percent of the course grade')
    await expect(page.locator('#run-policy')).toContainText('Declare what you use outside Tassl')
    await expect(
      page.getByRole('heading', { level: 2, name: 'What a confirmed band is worth' }),
    ).toBeVisible()
    const clock = page.locator('#run-clock-length')
    await expect(clock).toContainText('The working clock')
    await expect(clock).toContainText('25 minutes')
    await expect(clock).toContainText('Uncalibrated')
    await expect(
      page.getByRole('heading', { level: 2, name: 'The Readiness Check comes first' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Begin the Readiness Check' }).click()
    await page.waitForURL(new RegExp(`/runs/${runId}/readiness$`))
    await capture(5, page)
  })

  await test.step('6 Readiness Check: the clock starts at 08:00; answer each of the 16 items and press Next item until 16 of 16 answered → Submit the check → Submit the Readiness Check? → Submit → What the check read → Open the scenario.', async () => {
    await takeTheReadinessCheck(page, runId)
    await capture(6, page)
  })

  await test.step('7 The scenario: read Scenario brief aloud in part → in Evidence Room press Open on Board minutes, 28 August 2026, skim, Close on it → Open on Premium Tier Positioning Review (February 2025 board deck), skim, Close on it. Point at the AI assistant panel: "The assistant unlocks the moment you lock your frame."', async () => {
    await expect(
      page.locator('#scenario-brief').getByRole('heading', { level: 2, name: 'Scenario brief' }),
    ).toBeVisible()
    const room = page.locator('#evidence-room')
    await expect(room.getByRole('heading', { level: 2, name: 'Evidence Room' })).toBeVisible()
    for (const title of [
      'Board minutes, 28 August 2026',
      'Premium Tier Positioning Review (February 2025 board deck)',
    ]) {
      await room.getByRole('button', { name: `Open ${title}` }).click()
      const reader = page.getByRole('article', { name: title })
      await expect(reader).toBeVisible()
      await room.getByRole('button', { name: `Close ${title}` }).click()
      await expect(reader).toHaveCount(0)
    }
    const assistant = page.locator('#assistant-panel')
    await expect(assistant.getByRole('heading', { level: 2, name: 'AI assistant' })).toBeVisible()
    await expect(assistant).toContainText('The assistant unlocks the moment you lock your frame.')
    await capture(7, page)
  })

  await test.step('8 Your frame: The decision "Whether to move the quarter\'s acquisition budget toward the premium tier, and how far." → Assumption 1 "The premium payback figure in the board deck still holds." → Assumption 2 "The value tier is close to saturation." → Assumption 3 "Premium cohorts retain at the level the deck reports." → Your position now "I lean toward shifting a larger share of the budget to premium, because the deck\'s payback looks short and the value tier looks saturated. I have not checked either figure yet." → Confidence as a number 55 → Lock the frame → Lock the frame permanently? → Lock it. The chip reads Working, the clock beside it counts down from 25:00, Your request appears.', async () => {
    await expect(page.getByRole('heading', { level: 2, name: 'Your frame' })).toBeVisible()
    await lockTheFrame(page, FRAME)
    await expect(page.locator('[data-state="working"]')).toContainText('Working')
    await expect(page.getByRole('timer', { name: 'Working clock' })).toHaveText(
      /^2[45]:[0-5][0-9]$/,
    )
    await expect(page.locator('#assistant-panel').getByLabel('Your request')).toBeVisible()
    await capture(8, page)
  })

  await test.step('9 Your request "What is the premium payback?" → Ask the assistant → Reply complete. One claim surfaced. → the card Claim C3. Then Your request "What is the price sensitivity, is the value tier saturated, and what did the survey find?" → Ask the assistant → Reply complete. 3 claims surfaced. → Claim C5, Claim C8, Claim C7.', async () => {
    const assistant = page.locator('#assistant-panel')
    await ask(page, FIRST_REQUEST, 'Reply complete. One claim surfaced.')
    await expect(assistant.getByRole('article', { name: 'Claim C3' })).toBeVisible()
    await ask(page, SECOND_REQUEST, 'Reply complete. 3 claims surfaced.')
    for (const key of ['C5', 'C8', 'C7']) {
      await expect(assistant.getByRole('article', { name: `Claim ${key}` })).toBeVisible()
    }
    await capture(9, page)
  })

  await test.step('10 On Claim C5: Check it → Source Trace 1 min → the dialog Source Trace on claim C5 shows Document, Passage, Date, Author and This check cost one minute of your working clock. → close it → under Your stance choose Verify. On Claim C8: Reject. On Claim C7: Escalate → Escalate to a colleague shows You have 2 escalations left in this run. → What you cannot settle "I cannot tell whether the survey sample is representative." → Send it → the card shows You wrote, They answered ("Rowan Adeyemi, research operations. Two things about that number.") and This escalation cost 5 minutes of your working clock. Leave Claim C3 with no stance.', async () => {
    const assistant = page.locator('#assistant-panel')
    const card = (key: string) => assistant.getByRole('article', { name: `Claim ${key}` })

    await card('C5').getByRole('button', { name: 'Check claim C5' }).click()
    const menuItem = page.getByRole('menuitem', { name: /Source Trace/ })
    await expect(menuItem).toContainText('1 min')
    await menuItem.click()
    const result = page.getByRole('dialog')
    await expect(result).toContainText('Source Trace on claim C5')
    for (const label of ['Document', 'Passage', 'Date', 'Author']) {
      await expect(result).toContainText(label)
    }
    await expect(result).toContainText('This check cost one minute of your working clock.')
    await page.keyboard.press('Escape')
    await expect(result).toBeHidden()
    await takeStance(page, 'C5', 'Verify')

    await takeStance(page, 'C8', 'Reject')

    await card('C7').getByRole('button', { name: 'Escalate claim C7' }).click()
    const escalation = page.getByRole('dialog')
    await expect(escalation).toContainText('Escalate to a colleague')
    await expect(escalation).toContainText('You have 2 escalations left in this run.')
    await escalation.getByLabel('What you cannot settle').fill(ESCALATION)
    await escalation.getByRole('button', { name: 'Send it' }).click()
    await expect(escalation).toBeHidden()
    await expect(card('C7')).toContainText('You wrote')
    await expect(card('C7')).toContainText(ESCALATION)
    await expect(card('C7')).toContainText('They answered')
    await expect(card('C7')).toContainText(ESCALATION_REPLY)
    await expect(card('C7')).toContainText('This escalation cost 5 minutes of your working clock.')

    // C3 is left alone on purpose: no radio in its group is checked.
    await expect(stances(page, 'C3').getByRole('radio', { checked: true })).toHaveCount(0)
    await capture(10, page)
  })

  await test.step('11 Delegation Log: Why you asked under the first delegation "I wanted the payback figure before sizing the premium share." → Save → Saved. → Mark as used beside Claim C3 → You marked this claim used in the Delegation Log. Then Declare outside-tool use → What you used, and what for "A calculator, to check the division." → Record it → Recorded. It sits with the run and changes nothing about it.', async () => {
    const log = page.locator('#delegation-log')
    const entry = log.getByRole('article', { name: 'Delegation 1', exact: true })
    await entry.getByLabel('Why you asked, delegation 1').fill(WHY_ASKED)
    await entry.getByRole('button', { name: 'Save' }).click()
    await expect(entry.locator('p[id$="-status"]')).toHaveText('Saved.')
    await log.getByRole('button', { name: 'Mark claim C3 as used' }).click()
    await expect(entry).toContainText('You marked this claim used in the Delegation Log.')

    const declaration = page.locator('#declaration-control')
    await declaration.getByRole('button', { name: 'Declare outside-tool use' }).click()
    await declaration.getByLabel('What you used, and what for').fill(DECLARATION)
    await declaration.getByRole('button', { name: 'Record it' }).click()
    await expect(declaration.getByRole('status')).toHaveText(
      'Recorded. It sits with the run and changes nothing about it.',
    )
    await capture(11, page)
  })

  await test.step('12 Instructor profile: Courses → Marketing Strategy Walkthrough → Assignments → Decision Run 1 (walkthrough) → in Runs, Open the replay on the Student One row → Actions → Test controls → Arm the outage → toast One assistant outage is armed for this run. Student profile: Your request "What does the survey say about premium?" → Ask the assistant → the dialog The run is paused with The assistant did not answer. and the clock reading Paused → Resume the run → the clock runs again; the log row reads No answer came back. The run paused, your clock stopped, and the time was given back when you resumed.', async () => {
    // Each seat is a window, and the presenter Alt-Tabs to the one they act in (runbook §5); the
    // window is brought to the front at every seat change for the same reason. Firefox, which
    // focuses one window at a time, otherwise lets a click land in a background window without
    // the dialog it targets acting on it.
    await instructor.bringToFront()
    const replayOf = await openTheReplayFromTheAssignment(instructor, WALKTHROUGH_RUN, STUDENT_ONE)
    expect(replayOf, 'the assignment page links to the run the student is taking').toBe(runId)
    await openReplayTab(instructor, 'Actions')
    await expect(instructor.getByRole('heading', { level: 2, name: 'Test controls' })).toBeVisible()
    await instructor.getByRole('button', { name: 'Arm the outage' }).click()
    await expect(
      instructor.getByText('One assistant outage is armed for this run.').first(),
    ).toBeVisible()

    await page.bringToFront()
    const assistant = page.locator('#assistant-panel')
    await assistant.getByLabel('Your request').fill(OUTAGE_REQUEST)
    await expect(
      assistant.getByText(`${String(OUTAGE_REQUEST.length)} of 2000 characters`),
    ).toBeVisible()
    await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
    const overlay = page.getByRole('alertdialog')
    await expect(overlay).toContainText('The run is paused', { timeout: REPLY_TIMEOUT_MS })
    await expect(overlay).toContainText('The assistant did not answer.')
    // The overlay is modal, so the band behind it is out of the accessibility tree while it is
    // up; the clock is reached by its markup rather than by its role.
    const clock = page.locator('[role="timer"][aria-label="Working clock"]').locator('..')
    await expect(clock).toContainText('Paused')
    await capture(12, page)
    await overlay.getByRole('button', { name: 'Resume the run' }).click()
    await expect(overlay).toBeHidden()
    await expect(clock).not.toContainText('Paused')
    await expect(page.getByRole('timer', { name: 'Working clock' })).toHaveText(
      /^[0-9]{2}:[0-5][0-9]$/,
    )
    await expect(page.locator('#delegation-log')).toContainText(
      'No answer came back. The run paused, your clock stopped, and the time was given back when you resumed.',
    )
  })

  await test.step('13 Your decision brief: Your recommendation "Move the premium share of the quarter\'s acquisition budget from 15 percent to 40 percent, on the eleven-month payback." → Why "The positioning review puts premium payback at eleven months and the value tier is saturated, so the marginal dollar earns more on premium. The survey supports demand. I did not trace the payback figure to its source." → Assumption 1 "Premium payback is eleven months." → Assumption 2 "The value tier is saturated." → Assumption 3 "Premium cohorts retain at 78 percent at month three." → What would change your mind "A payback figure above fifteen months, or premium retention well below the deck\'s number." → Confidence as a number 62 → Share of the quarter\'s acquisition budget going to premium, in percent 40 → Premium payback you are betting on, in months 11 → Saved. and the line One claim you leaned on has no stance yet. Filing asks for one on it. → Lock the decision → File this decision? → File it → the dialog A claim you leaned on has no stance names the payback claim → Go to the claim → on Claim C3 choose Accept → Lock the decision → File this decision? with What will be filed → File it → the page Decision locked: The Turn with the countdown to it, The decision you filed, The frame you locked → Add an addendum → Your addendum "I did not trace the payback figure; with more time I would check it first." → Add it → One addendum per run, and this run has its one.', async () => {
    const editor = page.locator('#brief-editor-panel')
    await editor.getByLabel('Your recommendation').fill(BRIEF.recommendation)
    await editor.getByLabel('Why', { exact: true }).fill(BRIEF.why)
    for (const [index, assumption] of BRIEF.assumptions.entries()) {
      await editor.getByLabel(`Assumption ${String(index + 1)}`).fill(assumption)
    }
    await editor.getByLabel('What would change your mind').fill(BRIEF.changeMyMind)
    await editor.getByLabel('Confidence as a number').fill(BRIEF.confidence)
    await editor
      .getByLabel("Share of the quarter's acquisition budget going to premium, in percent")
      .fill(BRIEF.share)
    await editor.getByLabel('Premium payback you are betting on, in months').fill(BRIEF.payback)
    await expect(editor.getByText('Saved.', { exact: true })).toBeVisible()
    await expect(editor).toContainText(
      'One claim you leaned on has no stance yet. Filing asks for one on it.',
    )

    // The claim the gate is about to name, in the words the student read on its card.
    const claims = await page.request.get(`/api/v1/runs/${runId}/claims`)
    expect(claims.status(), await claims.text()).toBe(200)
    const payback = ((await claims.json()) as { key: string; text: string }[]).find(
      (claim) => claim.key === 'C3',
    )
    expect(payback, 'C3 should have been surfaced').toBeDefined()
    paybackClaimText = payback?.text ?? ''

    await editor.getByRole('button', { name: 'Lock the decision' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('File this decision?')
    await dialog.getByRole('button', { name: 'File it' }).click()
    await expect(dialog).toContainText('A claim you leaned on has no stance')
    await expect(dialog).toContainText(paybackClaimText)
    await dialog.getByRole('button', { name: 'Go to the claim' }).click()
    await expect(dialog).toBeHidden()
    await takeStance(page, 'C3', 'Accept')

    await editor.getByRole('button', { name: 'Lock the decision' }).click()
    await expect(dialog).toContainText('File this decision?')
    await expect(dialog).toContainText('What will be filed')
    await dialog.getByRole('button', { name: 'File it' }).click()
    await page.waitForURL(new RegExp(`/runs/${runId}/locked$`), {
      timeout: ACTION_TIMEOUT_MS,
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Decision locked' })).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: 'The decision you filed' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: 'The frame you locked' }),
    ).toBeVisible()
    const wait = page.locator('#turn-wait')
    await expect(wait.getByRole('heading', { level: 2, name: 'The Turn' })).toBeVisible()
    await expect(wait.getByRole('timer', { name: 'Time until the Turn' })).toBeVisible()

    const addendum = page.locator('#addendum')
    await addendum.getByRole('button', { name: 'Add an addendum' }).click()
    const addendumDialog = page.getByRole('dialog')
    await addendumDialog.getByLabel('Your addendum').fill(ADDENDUM)
    await addendumDialog.getByRole('button', { name: 'Add it' }).click()
    await expect(addendumDialog).toBeHidden()
    await expect(addendum).toContainText(ADDENDUM)
    await expect(addendum).toContainText('One addendum per run, and this run has its one.')
    await capture(13, page)
  })

  await test.step('14 Wait for the Turn: the countdown under The Turn reaches 00:00 → The Turn is due now. This page opens it as soon as it lands. → the page The Turn: What arrived with Stakeholder message ("Ellery here … 61 percent, not the 78 …"), the Turn window clock at 12:00, What this puts in front of you with Claim C2 and Claim C3 → on Claim C2 choose Verify; leave Claim C3 on Accept → What you are doing about the decision → Revise → Why "Month-three retention on cohort P2 is 61 percent, not 78, so the premium payback is longer than I bet on. I hold the direction and cut the premium share back." → Confidence as a number 48 → File the response → the page The defense.', async () => {
    // The countdown ends at the run's own `turn.dueAt`; the wait is whatever is left of it. The
    // page moves itself when the Turn lands — the band's poll sees `turn_open` and the locked
    // page's guard opens the Turn — so nothing here presses anything.
    const locked = await readRun(page, runId)
    const dueAt = Date.parse(locked.turn?.dueAt ?? '')
    expect(Number.isFinite(dueAt), 'a locked run knows when its Turn is due').toBe(true)
    await passTime(page, runId, dueAt - Date.now() + 2_000, (run) => run.state === 'turn_open')
    await page.waitForURL(new RegExp(`/runs/${runId}/turn$`), {
      timeout: PAGE_MOVES_TIMEOUT_MS,
    })
    await expect(page.getByRole('heading', { level: 1, name: 'The Turn' })).toBeVisible()

    const message = page.locator('#turn-message')
    await expect(message.getByRole('heading', { level: 2, name: 'What arrived' })).toBeVisible()
    await expect(message).toContainText('Stakeholder message')
    await expect(message).toContainText('Ellery here')
    await expect(message).toContainText('61 percent, not the 78')
    await expect(page.getByRole('timer', { name: 'Turn window' })).toHaveText(
      /^(12:00|11:[0-5][0-9])$/,
    )
    const cards = page.locator('#turn-claims')
    await expect(
      cards.getByRole('heading', { level: 2, name: 'What this puts in front of you' }),
    ).toBeVisible()
    await expect(cards.getByRole('article', { name: 'Claim C2' })).toBeVisible()
    // C3 was met in row 9 and stanced in row 13; the Turn puts it in front of the student again
    // (D-705: the window marks the row it already has) with the Accept they took still on it.
    await expect(cards.getByRole('article', { name: 'Claim C3' })).toBeVisible()
    await takeStance(page, 'C2', 'Verify')
    await expect(
      cards
        .getByRole('article', { name: 'Claim C3' })
        .getByRole('radiogroup', { name: 'Your stance on claim C3' })
        .getByRole('radio', { name: 'Accept' }),
    ).toHaveAttribute('aria-checked', 'true')

    const form = page.locator('#turn-response')
    await expect(form.getByText('What you are doing about the decision')).toBeVisible()
    await form.getByRole('radio', { name: 'Revise' }).click()
    await form.getByLabel('Why', { exact: true }).fill(TURN_RESPONSE.why)
    await form.getByLabel('Confidence as a number').fill(TURN_RESPONSE.confidence)
    await capture(14, page)
    // "Your response is filed. The defense opens next." is spoken into the screen's polite
    // region for a screen reader, and the defense opens right behind it; what a presenter sees
    // is the page moving, and that is what is asserted.
    await form.getByRole('button', { name: 'File the response' }).click()
    await page.waitForURL(new RegExp(`/runs/${runId}/defense$`), {
      timeout: ACTION_TIMEOUT_MS,
    })
    await expect(page.getByRole('heading', { level: 1, name: 'The defense' })).toBeVisible()
  })

  await test.step('15 The defense: for each question type in Your answer and press Submit answer; on the question Where did the payback figure come from answer "I do not know." → a Follow-up appears beneath it; answer it → Finish the defense → Finish the defense? → Finish it → Run status: Your run is being scored → Your debrief is ready → Read the debrief → Run Debrief with the chip Draft, seven cards marked Draft band, Provisional points, draft.', async () => {
    await answerTheDefense(page, PROVENANCE_QUESTION)
    // The provenance question was asked, answered from memory, and pressed on (FR-122, FR-123).
    await expect(page.locator('#defense-questions')).toContainText(FROM_MEMORY)
    await expect(
      page.locator('#defense-questions').getByText('Follow-up', { exact: true }),
    ).toBeVisible()
    await finishTheDefense(page, runId)
    await page.getByRole('link', { name: 'Read the debrief' }).click()
    await page.waitForURL(new RegExp(`/runs/${runId}/debrief$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Run Debrief' })).toBeVisible()
    await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible()
    await expect(page.locator('#debrief-bands').getByText('Draft band')).toHaveCount(7)
    await expect(
      page.locator('#debrief-points').getByText('Provisional points, draft'),
    ).toBeVisible()
    await capture(15, page)
  })

  // =========================================================================================
  // C. The instructor reviews
  // =========================================================================================

  await test.step("16 Review → Runs waiting for you → Open the replay for Student One → Overview: The four graphs (Confidence line, Clock timeline, Stance matrix, Frame beside decision) → Show data table on the stance matrix → Show graph → scroll to Defense transcript with Expected-answer notes, Delegation log, Conditions recorded on this run → Trace → The run's trace with the Clock left column.", async () => {
    await instructor.bringToFront()
    await rail(instructor, 'Review').click()
    await expect(
      instructor.getByRole('heading', { level: 2, name: 'Runs waiting for you' }),
    ).toBeVisible()
    await instructor.getByRole('link', { name: `Open the replay for ${STUDENT_ONE}` }).click()
    await instructor.waitForURL(new RegExp(`/review/runs/${runId}`))
    await expect(instructor.getByRole('heading', { level: 1, name: STUDENT_ONE })).toBeVisible()
    await expect(
      instructor.getByRole('heading', { level: 2, name: 'The four graphs' }),
    ).toBeVisible()
    const graphs = instructor.locator('#replay-graphs')
    for (const title of GRAPH_TITLES) {
      await expect(graphs.getByRole('heading', { name: title })).toBeVisible({
        timeout: GRAPH_TIMEOUT_MS,
      })
    }
    const matrix = graphs.getByRole('figure', { name: 'Stance matrix' })
    await matrix.getByRole('button', { name: 'Show data table' }).click()
    await expect(matrix.getByRole('table')).toBeVisible()
    await matrix.getByRole('button', { name: 'Show graph' }).click()
    await expect(matrix.getByRole('button', { name: 'Show data table' })).toBeVisible()

    const transcript = instructor.getByRole('heading', { level: 2, name: 'Defense transcript' })
    await expect(transcript).toBeVisible()
    await expect(
      instructor.locator('#replay-defense').getByText('Expected-answer notes').first(),
    ).toBeVisible()
    await expect(
      instructor.getByRole('heading', { level: 2, name: 'Delegation log' }),
    ).toBeVisible()
    await expect(
      instructor.getByRole('heading', { level: 2, name: 'Conditions recorded on this run' }),
    ).toBeVisible()
    // The Say describes what sits under the graphs, so the transcript is what the image shows.
    await capture(16, instructor, transcript)

    await openReplayTab(instructor, 'Trace')
    await expect(
      instructor.getByRole('heading', { level: 2, name: 'The run’s trace' }),
    ).toBeVisible()
    await expect(
      instructor.locator('#replay-trace').getByRole('columnheader', { name: 'Clock left' }),
    ).toBeVisible()
  })

  await test.step('17 Bands → on Framing press the primary button, which reads Confirm the draft: followed by the drafted band → toast The decision is on the record. → on Verification choose a band other than the drafted one, write in Note for the student (optional) "The payback figure needed a one-minute trace." → press the primary button, which now reads Record, the band you chose, instead → Confirm the remaining drafts → Confirm the remaining drafts? with Confirming these writes course export version 1. → Put the remaining drafts on the record → 7 of 7 decided → Points under this course\'s mapping ends with the arithmetic sentence, seven terms in brackets, / 7 = and the total → Course exports → Download version 1.', async () => {
    await openReplayTab(instructor, 'Bands')
    await expect(instructor.getByText('0 of 7 decided')).toBeVisible()

    const framing = instructor.locator('#band-framing')
    const framingDraft = await draftedBand(framing)
    await framing.getByRole('button', { name: `Confirm the draft: ${framingDraft}` }).click()
    await expect(instructor.getByText('The decision is on the record.').first()).toBeVisible()
    await expect(instructor.getByText('1 of 7 decided')).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })

    const verification = instructor.locator('#band-verification')
    const verificationDraft = await draftedBand(verification)
    const chosen = verificationDraft === 'Professional' ? 'Proficient' : 'Professional'
    await verification.getByRole('radio', { name: chosen }).check()
    await verification.getByLabel('Note for the student (optional)').fill(OVERRIDE_NOTE)
    await verification.getByRole('button', { name: `Record ${chosen} instead` }).click()
    await expect(instructor.getByText('2 of 7 decided')).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })

    await instructor.getByRole('button', { name: 'Confirm the remaining drafts' }).click()
    const shortcut = instructor.getByRole('alertdialog')
    await expect(
      shortcut.getByRole('heading', { name: 'Confirm the remaining drafts?' }),
    ).toBeVisible()
    await expect(
      shortcut.getByText('Confirming these writes course export version 1.'),
    ).toBeVisible()
    await shortcut.getByRole('button', { name: 'Put the remaining drafts on the record' }).click()
    await expect(instructor.getByText('7 of 7 decided')).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })

    const points = instructor.locator('#replay-points')
    await expect(
      points.getByRole('heading', { level: 2, name: 'Points under this course’s mapping' }),
    ).toBeVisible()
    // Seven terms in brackets, divided by seven, and the total to three places.
    await expect(points).toContainText(/\((\d+(\.\d+)? \+ ){6}\d+(\.\d+)?\) \/ 7 = \d+\.\d{3}/, {
      timeout: ACTION_TIMEOUT_MS,
    })
    const exports = instructor.locator('#replay-exports')
    await expect(exports.getByRole('heading', { level: 2, name: 'Course exports' })).toBeVisible()
    await capture(17, instructor)
    const download = instructor.waitForEvent('download')
    await exports.getByRole('link', { name: 'Download version 1' }).click()
    expect((await download).suggestedFilename()).toMatch(/^tassl-course-export-.+-v1\.json$/)
  })

  await test.step('18 Package → in Claims press Open C3 → Claim C3: Defective variant and Sound variant, Evidence status Defective, Failure family Stale evidence, the passage "310 divided by 28.20 is 11.0.", the chip Planted, How this claim was confirmed.', async () => {
    await openReplayTab(instructor, 'Package')
    const claims = instructor.locator('#replay-claims')
    await expect(claims.getByRole('heading', { level: 2, name: 'Claims' })).toBeVisible()
    await claims.getByRole('link', { name: 'Open C3' }).click()
    await expect(claims.getByRole('heading', { level: 2, name: 'Claim C3' })).toBeVisible()
    await expect(claims.getByRole('heading', { name: 'Defective variant' })).toBeVisible()
    await expect(claims.getByRole('heading', { name: 'Sound variant' })).toBeVisible()
    await expect(claims.getByText('Evidence status').first()).toBeVisible()
    await expect(claims.getByText('Defective', { exact: true }).first()).toBeVisible()
    await expect(claims.getByText('Failure family').first()).toBeVisible()
    await expect(claims.getByText('Stale evidence').first()).toBeVisible()
    await expect(
      claims.getByText('310 divided by 28.20 is 11.0.', { exact: false }).first(),
    ).toBeVisible()
    await expect(claims.getByText('Planted').first()).toBeVisible()
    await expect(
      claims.getByRole('heading', { name: 'How this claim was confirmed' }),
    ).toBeVisible()
    await capture(18, instructor)
  })

  // =========================================================================================
  // D. The student closes the run
  // =========================================================================================

  await test.step('19 Runs → Read the debrief on the Decision Run 1 (walkthrough) row → Run Debrief with the chip Confirmed; every card reads Confirmed band; the Verification card reads Your instructor decided this dimension differently. and Your instructor wrote with the note → Defects the decision rested on: Claim C3, What was wrong with it, Where it came from, The check that would have shown it → Confidence line, The Turn beside your frozen frame, Clock timeline, How this run could have gone ("Written by the scenario\'s author, not about this run."), One thing this run did, Confirmed points → Two questions: Which single stance would you change, and to what? "Challenge on C3: the deck was superseded." → What will you do differently in the next run like this? "Trace every figure I type into a named field." → File both answers → Both answers are filed and this run is closed.', async () => {
    await page.bringToFront()
    await rail(page, 'Runs').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
    await page.getByRole('link', { name: `Read the debrief · ${WALKTHROUGH_RUN}` }).click()
    await page.waitForURL(new RegExp(`/runs/${runId}/debrief$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Run Debrief' })).toBeVisible()
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible()
    await expect(page.locator('#debrief-bands').getByText('Confirmed band')).toHaveCount(7)
    const verification = page.locator('#band-verification')
    await expect(verification).toContainText('Your instructor decided this dimension differently.')
    await expect(verification).toContainText('Your instructor wrote')
    await expect(verification).toContainText(OVERRIDE_NOTE)

    const defects = page.locator('#debrief-missed-defects')
    await expect(
      defects.getByRole('heading', { level: 2, name: 'Defects the decision rested on' }),
    ).toBeVisible()
    await expect(defects.getByRole('heading', { name: 'Claim C3' })).toBeVisible()
    // No "passage" heading: C3 is a claim the assistant states on its own account, and the
    // passage a Source Trace returns for it is named by the check line below, not quoted.
    for (const heading of [
      'What was wrong with it',
      'Where it came from',
      'The check that would have shown it',
    ]) {
      await expect(defects.getByRole('heading', { name: heading })).toBeVisible()
    }

    await expect(
      page.locator('#debrief-confidence-line').getByRole('heading', { name: 'Confidence line' }),
    ).toBeVisible({ timeout: GRAPH_TIMEOUT_MS })
    await expect(
      page.getByRole('heading', { level: 2, name: 'The Turn beside your frozen frame' }),
    ).toBeVisible()
    await expect(
      page.locator('#debrief-clock-timeline').getByRole('heading', { name: 'Clock timeline' }),
    ).toBeVisible({ timeout: GRAPH_TIMEOUT_MS })
    await expect(
      page.getByRole('heading', { level: 2, name: 'How this run could have gone' }),
    ).toBeVisible()
    await expect(page.locator('#debrief-counterfactual')).toContainText(
      'Written by the scenario’s author, not about this run.',
    )
    await expect(
      page.getByRole('heading', { level: 2, name: 'One thing this run did' }),
    ).toBeVisible()
    await expect(page.locator('#debrief-points').getByText('Confirmed points')).toBeVisible()

    const questions = page.locator('#debrief-questions')
    await expect(questions.getByRole('heading', { level: 2, name: 'Two questions' })).toBeVisible()
    await questions
      .getByLabel('Which single stance would you change, and to what?')
      .fill(DEBRIEF_ANSWERS.stanceToChange)
    await questions
      .getByLabel('What will you do differently in the next run like this?')
      .fill(DEBRIEF_ANSWERS.doDifferently)
    await questions.getByRole('button', { name: 'File both answers' }).click()
    await expect(questions).toContainText('Both answers are filed and this run is closed.', {
      timeout: ACTION_TIMEOUT_MS,
    })
    await capture(19, page)
  })

  await test.step('20 Runs → Open the Judgment Record on the Decision Run 1 (walkthrough) row → Judgment Record: The four graphs, The seven dimensions (seven Confirmed band cards), How this run was set up with Mode Standard and Variant Defective → Download record.', async () => {
    await page.bringToFront()
    await rail(page, 'Runs').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
    await page.getByRole('link', { name: `Open the Judgment Record · ${WALKTHROUGH_RUN}` }).click()
    await page.waitForURL(new RegExp(`/records/${runId}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Judgment Record' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'The four graphs' })).toBeVisible()
    for (const title of GRAPH_TITLES) {
      await expect(
        page.locator('#record-graphs').getByRole('heading', { name: title }),
      ).toBeVisible({
        timeout: GRAPH_TIMEOUT_MS,
      })
    }
    await expect(
      page.getByRole('heading', { level: 2, name: 'The seven dimensions' }),
    ).toBeVisible()
    await expect(page.locator('#record-bands').getByText('Confirmed band')).toHaveCount(7)
    await expect(
      page.getByRole('heading', { level: 2, name: 'How this run was set up' }),
    ).toBeVisible()
    const context = page.locator('#record-context')
    await expect(context.getByText('Mode', { exact: true })).toBeVisible()
    await expect(context.getByText('Standard', { exact: true })).toBeVisible()
    await expect(context.getByText('Variant', { exact: true })).toBeVisible()
    await expect(context.getByText('Defective', { exact: true })).toBeVisible()
    await capture(20, page)
    const download = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Download record' }).click()
    expect((await download).suggestedFilename()).toBe(`tassl-record-${runId}.json`)
  })

  // =========================================================================================
  // E. The auto-lock branch, the correction and the void
  // =========================================================================================

  await test.step('21 Student profile, at the start of part C: Runs → Start on the Auto-lock test run row → Begin the Readiness Check → answer the 16 items → Submit the check → Submit → Open the scenario → fill Your frame with one sentence in each field and 50 in Confidence as a number → Lock the frame → Lock it → the clock beside the Working chip reads 02:00 → touch nothing. After two minutes the page moves on its own to Decision locked with Left empty. on every text field and No figure. on both figures.', async () => {
    await page.bringToFront()
    await rail(page, 'Runs').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
    await page
      .getByRole('row')
      .filter({ hasText: AUTO_LOCK_RUN })
      .getByRole('button', { name: `Start ${AUTO_LOCK_RUN}` })
      .click()
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}\/start$/)
    autoRunId = runIdFromUrl(page.url())
    await page.getByRole('button', { name: 'Begin the Readiness Check' }).click()
    await page.waitForURL(new RegExp(`/runs/${autoRunId}/readiness$`))
    await takeTheReadinessCheck(page, autoRunId)
    await lockTheFrame(page, AUTO_LOCK_FRAME)
    await expect(page.getByRole('timer', { name: 'Working clock' })).toHaveText(
      /^0[12]:[0-5][0-9]$/,
    )

    // Two minutes, and the page moves on its own: the band's poll sees `decision_locked` and
    // the workspace's guard opens the locked page.
    const working = await readRun(page, autoRunId)
    await passTime(
      page,
      autoRunId,
      (working.clock?.remainingMs ?? 120_000) + 5_000,
      (run) => run.state === 'decision_locked',
    )
    await page.waitForURL(new RegExp(`/runs/${autoRunId}/locked$`), {
      timeout: PAGE_MOVES_TIMEOUT_MS,
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Decision locked' })).toBeVisible()
    const filed = page.locator('#locked-brief')
    // Six text fields — the recommendation, why, three assumptions, what would change your mind.
    await expect(filed.getByText('Left empty.', { exact: true })).toHaveCount(6)
    // And the two figures the package names, each without a value.
    await expect(filed.getByRole('listitem').filter({ hasText: 'No figure.' })).toHaveCount(2)
    // The row's Say is about the filed-as-it-stands brief, so the image is the locked page with
    // the empty fields in view rather than the workspace the clock ran out on.
    await capture(
      21,
      page,
      filed.getByRole('heading', { level: 2, name: 'The decision you filed' }),
    )
  })

  await test.step('22 Instructor profile, after part D. First the correction, on Student One\'s replay: Courses → Marketing Strategy Walkthrough → Assignments → Decision Run 1 (walkthrough) → in Runs, Open the replay on the Student One row → Actions → Corrections → Enter a correction on C3… → Enter a correction on claim C3? → What went wrong? → Something else → Note (optional) "Demonstration of a correction." → Enter the correction → What the correction moved with Export version 2 was written. → Close. Then the void, on the auto-lock run\'s replay: Courses → Marketing Strategy Walkthrough → Assignments → Auto-lock test run → in Runs, Open the replay on the Student One row → Actions → Void this run… → Void this run? → Why is the run being voided? → It was a walkthrough run → tick Offer the student another run → Void the run → toast The run is voided and another has been offered. and the banner This run is voided. It carries no partial result, and no export written afterwards names it. Student profile: Runs → the auto-lock row reads This attempt was voided. and offers Continue on attempt 2.', async () => {
    await instructor.bringToFront()
    const corrected = await openTheReplayFromTheAssignment(instructor, WALKTHROUGH_RUN, STUDENT_ONE)
    expect(corrected).toBe(runId)
    await openReplayTab(instructor, 'Actions')
    await expect(instructor.getByRole('heading', { level: 2, name: 'Corrections' })).toBeVisible()
    await instructor.getByRole('button', { name: 'Enter a correction on C3…' }).click()
    const correction = instructor.getByRole('dialog')
    await expect(
      correction.getByRole('heading', { name: 'Enter a correction on claim C3?' }),
    ).toBeVisible()
    await expect(correction.getByText('What went wrong?')).toBeVisible()
    await correction.getByRole('radio', { name: 'Something else' }).check()
    await correction.getByLabel('Note (optional)').fill(CORRECTION_NOTE)
    await correction.getByRole('button', { name: 'Enter the correction' }).click()
    await expect(
      correction.getByRole('heading', { name: 'What the correction moved' }),
    ).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    await expect(correction.getByText(/Export version 2 was written\./)).toBeVisible()
    // The row's screenshot is the correction's answer: the five facts only the instructor who
    // pressed the control ever sees together.
    await capture(22, instructor)
    // `.first()`: the dialog primitive draws its own icon-only close beside the footer's.
    await correction.getByRole('button', { name: 'Close' }).first().click()
    await expect(correction).toBeHidden()

    const voided = await openTheReplayFromTheAssignment(instructor, AUTO_LOCK_RUN, STUDENT_ONE)
    expect(voided).toBe(autoRunId)
    await openReplayTab(instructor, 'Actions')
    await instructor.getByRole('button', { name: 'Void this run…' }).click()
    const voidDialog = instructor.getByRole('dialog')
    await expect(voidDialog.getByRole('heading', { name: 'Void this run?' })).toBeVisible()
    await expect(voidDialog.getByText('Why is the run being voided?')).toBeVisible()
    await voidDialog.getByRole('radio', { name: 'It was a walkthrough run' }).check()
    await voidDialog.getByRole('checkbox', { name: 'Offer the student another run' }).check()
    await voidDialog.getByRole('button', { name: 'Void the run' }).click()
    await expect(
      instructor.getByText('The run is voided and another has been offered.').first(),
    ).toBeVisible()
    await expect(
      instructor.getByText(
        'This run is voided. It carries no partial result, and no export written afterwards names it.',
      ),
    ).toBeVisible({ timeout: ACTION_TIMEOUT_MS })

    await page.bringToFront()
    await rail(page, 'Runs').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
    const row = page
      .getByRole('row')
      .filter({ hasText: AUTO_LOCK_RUN })
      .filter({ hasText: 'This attempt was voided.' })
    await expect(row).toBeVisible()
    await expect(row.getByRole('link', { name: 'Continue on attempt 2' })).toBeVisible()
  })

  // =========================================================================================
  // F. The sound variant, seats swapped
  // =========================================================================================

  await test.step('23 Student profile: the icon button at the top right named Account: Student One → Sign out → Sign in as student2@tassl.local → Runs → Start on the Decision Run 1 (sound) row → Begin the Readiness Check → answer the 16 items → Submit the check → Submit → Open the scenario → Your frame with the same five texts as step 8 and 55 → Lock the frame → Lock it.', async () => {
    await page.bringToFront()
    await page.getByRole('button', { name: `Account: ${STUDENT_ONE}` }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await page.waitForURL(/\/sign-in/)
    await signInThroughTheForm(page, STUDENT_TWO_EMAIL)
    await page.bringToFront()
    await rail(page, 'Runs').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
    await page
      .getByRole('row')
      .filter({ hasText: SOUND_RUN })
      .getByRole('button', { name: `Start ${SOUND_RUN}` })
      .click()
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}\/start$/)
    soundRunId = runIdFromUrl(page.url())
    await page.getByRole('button', { name: 'Begin the Readiness Check' }).click()
    await page.waitForURL(new RegExp(`/runs/${soundRunId}/readiness$`))
    await takeTheReadinessCheck(page, soundRunId)
    await lockTheFrame(page, FRAME)
    await capture(23, page)
  })

  await test.step('24 Your request "What is the value tier payback?" → Ask the assistant → Reply complete. One claim surfaced. → on Claim C1 choose Accept → in Delegation Log press Mark as used beside Claim C1 → Your decision brief: Your recommendation "Hold the premium share at 15 percent and put the marginal dollar into the value tier." → Why "The value tier payback is short and its retention holds; premium is unproven at scale." → the three assumptions "Value tier payback holds." / "Premium retention is unproven." / "The budget is fixed for the quarter." → What would change your mind "A premium payback under twelve months on a traced figure." → Confidence as a number 60 → Share of the quarter\'s acquisition budget going to premium, in percent 15 → Lock the decision → File this decision? → File it → Decision locked.', async () => {
    const assistant = page.locator('#assistant-panel')
    await ask(page, SOUND_REQUEST, 'Reply complete. One claim surfaced.')
    await expect(assistant.getByRole('article', { name: 'Claim C1' })).toBeVisible()
    await takeStance(page, 'C1', 'Accept')
    const log = page.locator('#delegation-log')
    await log.getByRole('button', { name: 'Mark claim C1 as used' }).click()
    await expect(log).toContainText('You marked this claim used in the Delegation Log.')

    const editor = page.locator('#brief-editor-panel')
    await editor.getByLabel('Your recommendation').fill(SOUND_BRIEF.recommendation)
    await editor.getByLabel('Why', { exact: true }).fill(SOUND_BRIEF.why)
    for (const [index, assumption] of SOUND_BRIEF.assumptions.entries()) {
      await editor.getByLabel(`Assumption ${String(index + 1)}`).fill(assumption)
    }
    await editor.getByLabel('What would change your mind').fill(SOUND_BRIEF.changeMyMind)
    await editor.getByLabel('Confidence as a number').fill(SOUND_BRIEF.confidence)
    await editor
      .getByLabel("Share of the quarter's acquisition budget going to premium, in percent")
      .fill(SOUND_BRIEF.share)
    await expect(editor.getByText('Saved.', { exact: true })).toBeVisible()
    await editor.getByRole('button', { name: 'Lock the decision' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('File this decision?')
    await dialog.getByRole('button', { name: 'File it' }).click()
    await page.waitForURL(new RegExp(`/runs/${soundRunId}/locked$`), {
      timeout: ACTION_TIMEOUT_MS,
    })
    await expect(page.getByRole('heading', { level: 1, name: 'Decision locked' })).toBeVisible()
    await capture(24, page)
  })

  await test.step('25 Wait for the Turn → The Turn → on Claim C2 choose Verify → on Claim C3 choose Verify → Revise → Why "Retention on P2 is lower than reported, so I keep the direction and move a little more to the value tier." → Confidence as a number 50 → File the response → The defense: one sentence in Your answer and Submit answer for each question → Finish the defense → Finish it → Your debrief is ready.', async () => {
    const locked = await readRun(page, soundRunId)
    const dueAt = Date.parse(locked.turn?.dueAt ?? '')
    expect(Number.isFinite(dueAt), 'a locked run knows when its Turn is due').toBe(true)
    await passTime(page, soundRunId, dueAt - Date.now() + 2_000, (run) => run.state === 'turn_open')
    await page.waitForURL(new RegExp(`/runs/${soundRunId}/turn$`), {
      timeout: PAGE_MOVES_TIMEOUT_MS,
    })
    await expect(page.getByRole('heading', { level: 1, name: 'The Turn' })).toBeVisible()
    await takeStance(page, 'C2', 'Verify')
    await takeStance(page, 'C3', 'Verify')
    const form = page.locator('#turn-response')
    await form.getByRole('radio', { name: 'Revise' }).click()
    await form.getByLabel('Why', { exact: true }).fill(SOUND_TURN_RESPONSE.why)
    await form.getByLabel('Confidence as a number').fill(SOUND_TURN_RESPONSE.confidence)
    await form.getByRole('button', { name: 'File the response' }).click()
    await page.waitForURL(new RegExp(`/runs/${soundRunId}/defense$`), {
      timeout: ACTION_TIMEOUT_MS,
    })
    await answerTheDefense(page)
    await finishTheDefense(page, soundRunId)
    await capture(25, page)
  })

  await test.step("26 Instructor profile: Review → Open the replay for Student Two → Bands → on Ownership choose Unassessed → Record this dimension as Unassessed → 1 of 7 decided → Confirm the remaining drafts → Put the remaining drafts on the record → 7 of 7 decided → in Points under this course's mapping the Ownership row reads Unassessed and Not counted, the total row reads Total over the assessed dimensions (6), and the sentence divides by 6.", async () => {
    await instructor.bringToFront()
    await rail(instructor, 'Review').click()
    await expect(
      instructor.getByRole('heading', { level: 2, name: 'Runs waiting for you' }),
    ).toBeVisible()
    await instructor.getByRole('link', { name: `Open the replay for ${STUDENT_TWO}` }).click()
    await instructor.waitForURL(new RegExp(`/review/runs/${soundRunId}`))
    await expect(instructor.getByRole('heading', { level: 1, name: STUDENT_TWO })).toBeVisible()
    await openReplayTab(instructor, 'Bands')
    await expect(instructor.getByText('0 of 7 decided')).toBeVisible()
    const ownership = instructor.locator('#band-ownership')
    await ownership.getByRole('radio', { name: 'Unassessed' }).check()
    await ownership.getByRole('button', { name: 'Record this dimension as Unassessed' }).click()
    await expect(instructor.getByText('1 of 7 decided')).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })
    await instructor.getByRole('button', { name: 'Confirm the remaining drafts' }).click()
    const shortcut = instructor.getByRole('alertdialog')
    await shortcut.getByRole('button', { name: 'Put the remaining drafts on the record' }).click()
    await expect(instructor.getByText('7 of 7 decided')).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })
    const points = instructor.locator('#replay-points')
    await expect(
      points.getByRole('heading', { level: 2, name: 'Points under this course’s mapping' }),
    ).toBeVisible()
    const ownershipRow = points.getByRole('row').filter({ hasText: 'Ownership' })
    await expect(ownershipRow).toContainText('Unassessed')
    await expect(ownershipRow).toContainText('Not counted')
    await expect(points).toContainText('Total over the assessed dimensions (6)')
    await expect(points).toContainText(/\) \/ 6 = \d+\.\d{3}/)
    // The Say is about the division, which is the points table under the seven cards.
    await capture(
      26,
      instructor,
      points.getByRole('heading', { level: 2, name: 'Points under this course’s mapping' }),
    )
  })

  await test.step('27 Student profile: Runs → Read the debrief on the Decision Run 1 (sound) row → chip Confirmed → Claim by claim: the Claim C1 row reads Your stance Accept, Warranted Accept, Same, and "This variant authored the claim as sound." → Defects the decision rested on reads Not drawn for this run with "Your filed decision rested on no claim this variant authored as defective." → the Ownership card reads Your instructor recorded this dimension as unassessed, so it is left out of the arithmetic. → answer Two questions → File both answers → Runs → Open the Judgment Record on the Decision Run 1 (sound) row → Variant Sound. On any run screen, reload it and press Tab once: the first link is Skip to main content; on any graph press Show data table, then Show graph.', async () => {
    await page.bringToFront()
    await rail(page, 'Runs').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
    await page.getByRole('link', { name: `Read the debrief · ${SOUND_RUN}` }).click()
    await page.waitForURL(new RegExp(`/runs/${soundRunId}/debrief$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Run Debrief' })).toBeVisible()
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible()

    const matrix = page.locator('#debrief-stance-matrix')
    await expect(matrix.getByRole('heading', { level: 2, name: 'Claim by claim' })).toBeVisible()
    const soundRow = matrix.getByRole('article', { name: 'Claim C1' })
    await expect(soundRow).toContainText('Your stance Accept')
    await expect(soundRow).toContainText('Warranted Accept')
    await expect(soundRow.getByText('Same', { exact: true })).toBeVisible()
    await expect(soundRow).toContainText('This variant authored the claim as sound.')

    const defects = page.locator('#debrief-missed-defects')
    await expect(defects).toContainText('Not drawn for this run')
    await expect(defects).toContainText(
      'Your filed decision rested on no claim this variant authored as defective.',
    )
    await expect(page.locator('#band-ownership')).toContainText(
      'Your instructor recorded this dimension as unassessed, so it is left out of the arithmetic.',
    )

    const questions = page.locator('#debrief-questions')
    await questions
      .getByLabel('Which single stance would you change, and to what?')
      .fill(SOUND_DEBRIEF_ANSWERS.stanceToChange)
    await questions
      .getByLabel('What will you do differently in the next run like this?')
      .fill(SOUND_DEBRIEF_ANSWERS.doDifferently)
    await questions.getByRole('button', { name: 'File both answers' }).click()
    await expect(questions).toContainText('Both answers are filed and this run is closed.', {
      timeout: ACTION_TIMEOUT_MS,
    })

    await page.bringToFront()
    await rail(page, 'Runs').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
    await page.getByRole('link', { name: `Open the Judgment Record · ${SOUND_RUN}` }).click()
    await page.waitForURL(new RegExp(`/records/${soundRunId}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Judgment Record' })).toBeVisible()
    const context = page.locator('#record-context')
    await expect(context.getByText('Variant', { exact: true })).toBeVisible()
    await expect(context.getByText('Sound', { exact: true })).toBeVisible()

    // A fresh load, so the focus starts where the browser puts it and the skip link is the
    // first stop. The WebKit build Playwright drives keeps Safari's default keyboard-access
    // mode, in which Tab reaches form controls and never links (17-standing-rules-a11y says
    // the same), so on that engine the link is given focus the way its port allows; the two
    // facts the row states are asserted on every engine — the skip link is the document's
    // first link, and it shows itself the moment it has focus.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Judgment Record' })).toBeVisible()
    const skip = page.getByRole('link', { name: 'Skip to main content' })
    await expect(page.getByRole('link').first()).toHaveAccessibleName('Skip to main content')
    if (browserName === 'webkit') await skip.focus()
    else await page.keyboard.press('Tab')
    await expect(skip).toBeFocused()
    await expect(skip).toBeVisible()

    const graph = page.locator('#record-graphs').getByRole('figure', { name: 'Stance matrix' })
    await graph.getByRole('button', { name: 'Show data table' }).click()
    await expect(graph.getByRole('table')).toBeVisible()
    await graph.getByRole('button', { name: 'Show graph' }).click()
    await expect(graph.getByRole('button', { name: 'Show data table' })).toBeVisible()
    await capture(27, page)
  })

  expect(
    instructorErrors,
    'no uncaught page error or console.error on the Instructor profile during the demo',
  ).toEqual([])
  expect(
    instructorFailures,
    'no refused or undelivered request on the Instructor profile during the demo',
  ).toEqual([])
  // Closed here, on the way out of a passed test, and left to Playwright on a failed one: its
  // artifact recorder traces every context the test opened and expects to stop the trace itself.
  await instructorContext.close()
})
