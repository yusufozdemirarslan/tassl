// The Student guide, taken as written (docs/guides/learner-guide.md; docs/prompts/02-qa-and-guides.md
// Part B).
//
// Every `### Task N` of the guide is a `test()` here and every numbered step is a step titled
// `N.M …`, in the guide's order and wording — `scripts/check-guide-coverage.ts` re-derives both
// sides on every run and fails on any difference. A step does what the guide's sentence says and asserts the
// guide's "You see" clause, then takes the screenshot the guide embeds beside that step.
//
// Tasks 2 to 14 are one continuous run on the seeded "Decision Run 1 (walkthrough)" assignment,
// exactly as a student takes it, so the run id is kept across the tests and the tests run in
// series in one worker. Task 15 is a second run, on "Decision Run 1 (sound)". Both are on the
// seeded section, which is what lets `resetGuideData` in ../global-setup.ts take them out again
// before the next engine (one live run per student per assignment, D-041).
//
// Three things happen off the page, each one the guide names:
//
//   * the Turn (Task 11) and the wait for scoring (Task 13) are timed waits; locally the test-only
//     `advance-clock` route shifts the run's timeline (D-109) and the page is then polled the way a
//     person would poll it — the band's five-second poll moves the screen on its own;
//   * the instructor's confirmation of the seven bands (Task 13, "your instructor's act on the
//     replay's Bands tab") goes through the endpoint that tab's shortcut calls, in a second request
//     context signed in as the instructor, so the student's browser session is never disturbed;
//   * the assistant outage of Task 15 is armed by the instructor through the test control the
//     guide's Goal describes, in that same second context.
//
// Nothing here reads anything a student may not see: no warranted stance, no evidence status, no
// planted flag. The one endpoint read of a claim is its text, which the student has already read on
// its card.
import type { Locator, Page } from '@playwright/test'
import { confirmEveryBand, readJson } from '../walkthrough/scored-run'
import { signInAsInstructor } from '../instructor/api'
import {
  PAST_THE_TURN_MS,
  SEED_PASSWORD,
  WRITE_HEADERS,
  advanceRunClock,
  expect,
  runIdFromUrl,
  seatEmail,
  signInAs,
  signOut,
  test,
} from './fixtures'

test.describe.configure({ mode: 'serial' })
test.use({ persona: 'student' })

// Every task signs the seat in afresh, so every task ends its own session: the seat is shared, and
// its Signed-in devices list (Task 16) is read from the sessions it still holds. The page is taken
// off the run first, because the run band polls the run every five seconds and a poll made after
// the session has ended is a 401 the console guard would count. Task 16 has already signed out
// through the menu by then, and a jar with no session is left as it is.
test.afterEach(async ({ page }) => {
  await page.goto('about:blank')
  const session = await page.request.get('/api/auth/get-session')
  if (session.ok() && (await session.text()).trim() !== 'null') await signOut(page)
})

/** The seeded assignments the guide runs on (06 §5 item 5). */
const WALKTHROUGH = 'Decision Run 1 (walkthrough)'
const SOUND = 'Decision Run 1 (sound)'

/** The band polls the run every five seconds; a state change is on screen within two polls. */
const POLL_TIMEOUT_MS = 30_000

/** Far past NFR-001's five seconds: a run that misses this has gone wrong rather than slow. */
const SCORING_TIMEOUT_MS = 20_000

/** The graphs arrive through `next/dynamic`, so their first paint is slower than a page. */
const GRAPH_TIMEOUT_MS = 20_000

/**
 * Every irreversible press ends in a Server Action and a `router.refresh()`, and the screen it
 * leaves is the server's next render: on an engine sharing the machine with two others that is
 * more than Playwright's five seconds. The assertions are unchanged, only the patience (D-188).
 */
const ACTION_TIMEOUT_MS = 20_000

/** Every value the guide asks the student to type, verbatim, in the order it asks for them. */
const FRAME = {
  decision: 'Guide decision, back the premium tier with most of the quarterly budget',
  assumptions: [
    'Guide assumption one, premium payback is under a year',
    'Guide assumption two, value tier demand is flat',
    'Guide assumption three, the board wants growth',
  ],
  position: 'Guide position, lean premium because the payback looks short',
  confidence: '60',
} as const

const FIRST_REQUEST = 'What is the premium payback?'
const WHY = 'Guide, checking the payback figure'
const SECOND_REQUEST =
  'What is the price sensitivity, is the value tier saturated, and what did the survey find?'
const ESCALATION = 'Guide, I cannot tell whether the survey sample was large enough'
const DECLARATION = 'Guide, a calculator for the payback arithmetic'

const BRIEF = {
  recommendation: 'Guide recommendation, move most of the budget to premium this quarter',
  why: 'Guide reasoning, the premium payback is short and retention is strong',
  assumptions: [
    'Guide brief assumption one, payback stays near eleven months',
    'Guide brief assumption two, premium retention holds',
    'Guide brief assumption three, the value tier is saturated',
  ],
  changeMyMind: 'Guide, a payback figure above sixteen months',
  share: '60',
  payback: '11',
  confidence: '62',
} as const

const THIRD_REQUEST = 'What is the value tier payback?'
const ADDENDUM = 'Guide addendum, I would trace the payback figure before filing'

const TURN = {
  why: 'Guide revision, the retention figure changed so the payback no longer holds',
  confidence: '48',
} as const

const FROM_MEMORY = 'I went with what I remembered and did not note where it came from.'
const SOURCED_ANSWER = 'Guide, 16 months because the memo says so'

const DEBRIEF_ANSWERS = {
  stanceToChange: 'Guide, Verify on C5 to Challenge',
  doDifferently: 'Guide, trace every figure first',
} as const

const OUTAGE_FRAME = {
  decision: 'Guide outage decision, hold the budget split',
  assumptions: [
    'Guide outage assumption one',
    'Guide outage assumption two',
    'Guide outage assumption three',
  ],
  position: 'Guide outage position, hold',
} as const

/** The twelve sections of the debrief, in the order the guide walks them (Task 13 step 4). */
const DEBRIEF_SECTIONS = [
  'Your frame beside your decision',
  'Claim by claim',
  'Defects the decision rested on',
  'Where the assistant changed its position',
  'Your confidence through the run',
  'The Turn beside your frozen frame',
  'Where the clock went',
  'How this run could have gone',
  'The seven dimensions',
  'What your course does with the bands',
  'One thing this run did',
  'Two questions',
] as const

const DIMENSIONS = [
  'Framing',
  'Delegation',
  'Verification',
  'Calibration',
  'Decision Quality',
  'Adaptation',
  'Ownership',
] as const

const STANCES = ['Accept', 'Verify', 'Challenge', 'Reject', 'Escalate'] as const

// ---------------------------------------------------------------------------------------------
// The run the tasks share
// ---------------------------------------------------------------------------------------------

/** The run started in Task 2 and carried to the Judgment Record in Task 14. */
let runId = ''

// ---------------------------------------------------------------------------------------------
// Locators the guide's sentences resolve to
// ---------------------------------------------------------------------------------------------

const assistantPanel = (page: Page): Locator => page.locator('#assistant-panel')
const delegationLog = (page: Page): Locator => page.locator('#delegation-log')
const briefEditor = (page: Page): Locator => page.locator('#brief-editor-panel')

/** The claim card that carries the controls: the reply's, while the reply is holding it (D-313). */
const replyCard = (page: Page, key: string): Locator =>
  assistantPanel(page).getByRole('article', { name: `Claim ${key}` })

/** The same claim in the Delegation Log: the copy the mark-as-used control belongs to. */
const logCard = (page: Page, key: string): Locator =>
  delegationLog(page).getByRole('article', { name: `Claim ${key}` })

/**
 * The copy of a claim that carries its controls, wherever it is. A claim is worked where it was
 * most recently surfaced (D-313): in the assistant's reply while the reply is on screen, and in the
 * Delegation Log once the page has been loaded again — the reply is not redrawn on a load, the log
 * is. Each task here opens the run afresh, which is the reload the guide's "Refreshing" section
 * describes, so the card a step acts on is found by the control it carries rather than by where
 * the previous task left it.
 */
const workedCard = (page: Page, key: string): Locator =>
  page
    .getByRole('article', { name: `Claim ${key}` })
    .filter({ has: page.getByRole('radiogroup', { name: `Your stance on claim ${key}` }) })

const stanceGroup = (card: Locator, key: string): Locator =>
  card.getByRole('radiogroup', { name: `Your stance on claim ${key}` })

/** The row of the runs table for one assignment, by its label. */
const runRow = (page: Page, label: string): Locator =>
  page.getByRole('row').filter({ hasText: label })

/**
 * The live counter under a field. Every counted field names its counter, an element whose id ends
 * in `-count`, in its `aria-describedby`, so the counter is found from the field rather than by its
 * text — three assumption fields all read "9 of 25 words" at one point or another, and the guide's
 * "You see" is about the one under the field that was just typed into.
 */
async function counterOf(page: Page, field: Locator): Promise<Locator> {
  const describedBy = (await field.getAttribute('aria-describedby')) ?? ''
  const id = describedBy.split(/\s+/).find((token) => token.endsWith('-count'))
  expect(id, `a counted field names its counter (aria-describedby="${describedBy}")`).toBeTruthy()
  return page.locator(`[id="${id ?? ''}"]`)
}

/** Types the guide's value and reads the counter the guide quotes back. */
async function typeAndCount(page: Page, field: Locator, text: string, counter: string) {
  await field.fill(text)
  await expect(await counterOf(page, field)).toHaveText(counter)
}

/**
 * A stance, taken on a card and read back from it. The chip fills optimistically and the server's
 * answer replaces it, so the one polite region the screen owns is waited on before the next act
 * (`#run-announcer`, D-314).
 */
async function takeStance(page: Page, card: Locator, key: string, stance: string) {
  const group = stanceGroup(card, key)
  await group.getByRole('radio', { name: stance }).click()
  await expect(group.getByRole('radio', { name: stance })).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('#run-announcer')).toHaveText(`Stance on claim ${key}: ${stance}.`)
}

/** The student's own read of a claim's text — what its card already shows them. */
async function claimText(page: Page, key: string): Promise<string> {
  const claims = await readJson<{ key: string; text: string }[]>(
    page.request,
    `/api/v1/runs/${runId}/claims`,
  )
  const claim = claims.find((entry) => entry.key === key)
  expect(claim, `claim ${key} should have been raised`).toBeDefined()
  return claim?.text ?? ''
}

/** The defense's questions as the student's own endpoint lists them (FR-126). */
async function defenseQuestions(page: Page): Promise<{ answered: boolean }[]> {
  const defense = await readJson<{ questions: { answered: boolean }[] }>(
    page.request,
    `/api/v1/runs/${runId}/defense`,
  )
  return defense.questions
}

// =============================================================================================
// Task 1
// =============================================================================================

test('Task 1: Sign in and see your runs', async ({ page, shot }) => {
  test.setTimeout(120_000)

  await test.step('1.1 Open the address /sign-in in your browser.', async () => {
    await page.goto('/sign-in')
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Tassl' })).toBeVisible()
    await expect(
      page.getByText('Use the email address your institution knows you by.'),
    ).toBeVisible()
    await shot(1, 1)
  })

  await test.step('1.2 Type student1@tassl.local in Email address.', async () => {
    const email = page.getByLabel('Email address')
    await email.fill(seatEmail('student1'))
    await expect(email).toHaveValue(seatEmail('student1'))
    await shot(1, 2)
  })

  await test.step('1.3 Type the seed password in Password (Walkthrough-Pass-2026 locally; see Getting started).', async () => {
    await page.getByLabel('Password').fill(SEED_PASSWORD)
    await expect(page.getByRole('checkbox', { name: 'Keep me signed in' })).toBeChecked()
    await shot(1, 3)
  })

  await test.step('1.4 Click Sign in.', async () => {
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/home$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
    await expect(page.getByText('Walkthrough University').first()).toBeVisible()
    const runs = page.getByRole('region', { name: 'Your runs' }).or(
      page.locator('section').filter({
        has: page.getByRole('heading', { level: 2, name: 'Your runs' }),
      }),
    )
    await expect(runs.first().getByRole('heading', { level: 2, name: 'Your runs' })).toBeVisible()
    await expect(runs.first()).toContainText(WALKTHROUGH)
    await shot(1, 4)
  })

  await test.step('1.5 Find the rail beside the page, starting with Home.', async () => {
    const rail = page.getByRole('navigation', { name: 'Primary' })
    const items = rail.getByRole('link')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toHaveText('Home')
    await expect(items.nth(1)).toHaveText('Runs')
    await shot(1, 5)
  })

  await test.step('1.6 Find the header, which starts with the link Tassl.', async () => {
    const header = page.getByRole('banner')
    await expect(header.getByRole('link', { name: 'Tassl' })).toBeVisible()
    await expect(header).toContainText('Walkthrough University')
    await expect(header.getByRole('link', { name: /^Notifications:/ })).toBeVisible()
    await expect(header.getByRole('button', { name: /^Account:/ })).toBeVisible()
    await shot(1, 6)
  })

  await test.step('1.7 Click Runs in the rail.', async () => {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Runs' })
      .click()
    await page.waitForURL(/\/runs$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
    for (const column of ['Assignment', 'Attempt', 'State', 'Next']) {
      await expect(page.getByRole('columnheader', { name: column })).toBeVisible()
    }
    await shot(1, 7)
  })

  await test.step('1.8 Find the row Decision Run 1 (walkthrough).', async () => {
    const row = runRow(page, WALKTHROUGH)
    await expect(row).toBeVisible()
    // "Not started" in Attempt and in State: the same words in two cells of one row.
    await expect(row.getByText('Not started')).toHaveCount(2)
    await expect(row.getByText('Walkthrough', { exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: `Start ${WALKTHROUGH}` })).toBeVisible()
    await shot(1, 8)
  })
})

// =============================================================================================
// Task 2
// =============================================================================================

test('Task 2: Start a run and read what it counts for', async ({ page, shot }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'student1')

  await test.step('2.1 Click Runs in the rail.', async () => {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Runs' })
      .click()
    await page.waitForURL(/\/runs$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
    await shot(2, 1)
  })

  await test.step('2.2 Click Start in the row Decision Run 1 (walkthrough).', async () => {
    await runRow(page, WALKTHROUGH)
      .getByRole('button', { name: `Start ${WALKTHROUGH}` })
      .click()
    // Start is a write, and where it lands is the new run's own address: the run id the rest of
    // the guide is taken on is read from there rather than composed.
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}\/start$/)
    runId = runIdFromUrl(page.url())
    await expect(page.getByRole('heading', { level: 1, name: 'Before you begin' })).toBeVisible()
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: 'This run counts toward the course grade. Run one counts.',
      }),
    ).toBeVisible()
    await shot(2, 2)
  })

  await test.step('2.3 Find Run type in the first panel, under that sentence.', async () => {
    const counts = page.locator('#run-counts')
    await expect(counts.getByText('Run type', { exact: true })).toBeVisible()
    await expect(counts.getByText('Decision Run', { exact: true })).toBeVisible()
    await expect(counts.getByText('Weight', { exact: true })).toBeVisible()
    await expect(counts.getByText('2.5 percent of the course grade')).toBeVisible()
    await shot(2, 3)
  })

  await test.step('2.4 Scroll to Outside AI tools.', async () => {
    const policy = page.locator('#run-policy')
    await policy.scrollIntoViewIfNeeded()
    await expect(policy.getByRole('heading', { name: 'Outside AI tools' })).toBeVisible()
    await expect(policy.getByText('Declare what you use outside Tassl')).toBeVisible()
    await expect(
      policy.getByText(
        'A declaration never lowers a band or a point. Tassl does not detect, infer, or estimate outside use, and nothing it records is treated as misconduct.',
      ),
    ).toBeVisible()
    await shot(2, 4)
  })

  await test.step('2.5 Scroll to What a confirmed band is worth.', async () => {
    const mapping = page.locator('#run-mapping')
    await mapping.scrollIntoViewIfNeeded()
    await expect(
      mapping.getByRole('heading', { name: 'What a confirmed band is worth' }),
    ).toBeVisible()
    await expect(mapping.getByRole('columnheader', { name: 'Band' })).toBeVisible()
    await expect(mapping.getByRole('columnheader', { name: 'Points' })).toBeVisible()
    for (const [band, points] of [
      ['Novice', '1'],
      ['Developing', '2'],
      ['Proficient', '3'],
      ['Professional', '4'],
    ] as const) {
      const row = mapping.getByRole('row').filter({ hasText: band })
      await expect(row.getByRole('cell', { name: points, exact: true })).toBeVisible()
    }
    await expect(
      mapping.getByText('There is no total score, no rank, and no percentile anywhere in Tassl.'),
    ).toBeVisible()
    await shot(2, 5)
  })

  await test.step('2.6 Scroll to The working clock.', async () => {
    const clock = page.locator('#run-clock-length')
    await clock.scrollIntoViewIfNeeded()
    await expect(clock.getByRole('heading', { name: 'The working clock' })).toBeVisible()
    await expect(clock.getByText('25 minutes', { exact: true })).toBeVisible()
    await expect(clock.getByText('Uncalibrated', { exact: true })).toBeVisible()
    await expect(
      clock.getByText(
        'The clock starts when you lock your frame, not now. Reading the brief and the Evidence Room beforehand costs you nothing.',
      ),
    ).toBeVisible()
    await shot(2, 6)
  })

  await test.step('2.7 Scroll to The Readiness Check comes first.', async () => {
    const begin = page.locator('#run-begin')
    await begin.scrollIntoViewIfNeeded()
    await expect(
      begin.getByRole('heading', { name: 'The Readiness Check comes first' }),
    ).toBeVisible()
    await expect(
      begin.getByText(
        'Sixteen short questions with an eight-minute limit. It is not scored, it never blocks the run, and you can skip past it if it will not submit.',
      ),
    ).toBeVisible()
    await shot(2, 7)
  })

  await test.step('2.8 Click Begin the Readiness Check.', async () => {
    await page.getByRole('button', { name: 'Begin the Readiness Check' }).click()
    await page.waitForURL(new RegExp(`/runs/${runId}/readiness$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Readiness Check' })).toBeVisible()
    // The clock counts down to an instant the server set; eight minutes reads as 08:00 or a
    // second or two under it (D-042).
    await expect(page.getByRole('timer', { name: 'Readiness Check clock' })).toHaveText(
      /^0[78]:[0-5][0-9]$/,
    )
    await shot(2, 8)
  })
})

// =============================================================================================
// Task 3
// =============================================================================================

test('Task 3: Take the Readiness Check', async ({ page, shot }) => {
  test.setTimeout(240_000)
  await signInAs(page, 'student1')
  await page.goto(`/runs/${runId}/readiness`)

  const navigator = page.getByRole('toolbar', { name: 'Items' })

  /** The first of the four answers under the item on screen (FR-012: which one is arbitrary). */
  async function chooseFirstAnswer(position: number) {
    await expect(page.getByText(`Item ${String(position)} of 16`)).toBeVisible()
    const options = page.getByRole('radiogroup').getByRole('radio')
    await expect(options).toHaveCount(4)
    await options.first().click()
    await expect(
      navigator.getByRole('button', { name: `Item ${String(position)}, answered` }),
    ).toBeVisible()
  }

  await test.step('3.1 Find the clock beside 0 of 16 answered.', async () => {
    await expect(page.getByText('0 of 16 answered')).toBeVisible()
    await expect(page.getByRole('timer', { name: 'Readiness Check clock' })).toHaveText(
      /^0[78]:[0-5][0-9]$/,
    )
    await shot(3, 1)
  })

  await test.step('3.2 Find the Items toolbar under the clock.', async () => {
    await expect(navigator.getByRole('button')).toHaveCount(16)
    await expect(
      page.getByText('The arrow keys move between items. An item you have answered is filled in.'),
    ).toBeVisible()
    await shot(3, 2)
  })

  await test.step('3.3 Choose the first of the four answers under Item 1 of 16.', async () => {
    await chooseFirstAnswer(1)
    await expect(page.getByText('1 of 16 answered')).toBeVisible()
    await shot(3, 3)
  })

  await test.step('3.4 Click Next item.', async () => {
    await page.getByRole('button', { name: 'Next item' }).click()
    await expect(page.getByText('Item 2 of 16')).toBeVisible()
    await shot(3, 4)
  })

  await test.step('3.5 Answer items 2 to 16 the same way, moving on with Next item after each.', async () => {
    for (let position = 2; position <= 16; position += 1) {
      await chooseFirstAnswer(position)
      if (position < 16) await page.getByRole('button', { name: 'Next item' }).click()
    }
    await expect(page.getByText('16 of 16 answered')).toBeVisible()
    await shot(3, 5)
  })

  await test.step('3.6 Click Submit the check.', async () => {
    await page.getByRole('button', { name: 'Submit the check' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('Submit the Readiness Check?')
    await expect(confirm).toContainText(
      'Every item has an answer. Submitting closes the check and opens the scenario.',
    )
    await shot(3, 6)
  })

  await test.step('3.7 Click Submit.', async () => {
    await page.getByRole('alertdialog').getByRole('button', { name: 'Submit', exact: true }).click()
    await page.waitForURL(new RegExp(`/runs/${runId}/readiness/result$`))
    await expect(page.getByRole('heading', { level: 1, name: 'What the check read' })).toBeVisible()
    await expect(
      page.getByText(
        'There is no score here, no total and no comparison with anyone else, and nothing on this page counts toward your grade.',
      ),
    ).toBeVisible()
    await shot(3, 7)
  })

  await test.step('3.8 Scroll to The ideas this scenario turns on.', async () => {
    const concepts = page.locator('#readiness-concepts')
    await concepts.scrollIntoViewIfNeeded()
    await expect(
      concepts.getByRole('heading', { name: 'The ideas this scenario turns on' }),
    ).toBeVisible()
    const rows = concepts.getByRole('listitem')
    expect(await rows.count()).toBeGreaterThan(0)
    for (const row of await rows.allInnerTexts()) {
      expect(row.trim()).toMatch(
        /^(You showed a working grasp of .+\.|.+ looks thin\.|We could not tell about .+\.)$/,
      )
    }
    // No number anywhere in the panel: no score, no total, no count of anything (FR-012).
    expect(await concepts.innerText()).not.toMatch(/[0-9]/)
    await shot(3, 8)
  })

  await test.step('3.9 Click Open the scenario.', async () => {
    await page.getByRole('link', { name: 'Open the scenario' }).click()
    await page.waitForURL(new RegExp(`/runs/${runId}/work$`))
    await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()
    await expect(
      page.getByText(
        'Read the brief and as much of the Evidence Room as you want to. The working clock starts when you lock your frame, so reading now costs you nothing.',
      ),
    ).toBeVisible()
    await shot(3, 9)
  })
})

// =============================================================================================
// Task 4
// =============================================================================================

test('Task 4: Read the brief and open the Evidence Room', async ({ page, shot }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'student1')
  await page.goto(`/runs/${runId}/work`)
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()

  const room = page.locator('#evidence-room')
  const MINUTES = 'Board minutes, 28 August 2026'

  await test.step('4.1 Find Scenario brief at the top of the left column.', async () => {
    const brief = page.locator('#scenario-brief')
    await expect(brief.getByRole('heading', { name: 'Scenario brief' })).toBeVisible()
    await expect(brief).toContainText('Meridian Roast sells single-origin coffee by subscription.')
    await shot(4, 1)
  })

  await test.step('4.2 Scroll to Evidence Room.', async () => {
    await room.scrollIntoViewIfNeeded()
    await expect(room.getByRole('heading', { name: 'Evidence Room' })).toBeVisible()
    await expect(room.getByRole('listitem')).toHaveCount(9)
    await expect(room.getByRole('heading', { level: 3, name: MINUTES })).toBeVisible()
    await expect(
      room.getByText(
        'Tassl records which ones you open and how long each stays open; it draws no conclusion from that.',
      ),
    ).toBeVisible()
    await shot(4, 2)
  })

  await test.step('4.3 Click Open beside Board minutes, 28 August 2026.', async () => {
    await room.getByRole('button', { name: `Open ${MINUTES}` }).click()
    const reader = page.getByRole('article', { name: MINUTES })
    await expect(reader).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    expect((await reader.innerText()).trim().length).toBeGreaterThan(0)
    await expect(room.getByRole('button', { name: `Close ${MINUTES}` })).toBeVisible()
    await shot(4, 3)
  })

  await test.step('4.4 Click Close beside Board minutes, 28 August 2026.', async () => {
    await room.getByRole('button', { name: `Close ${MINUTES}` }).click()
    await expect(page.getByRole('article', { name: MINUTES })).toHaveCount(0)
    await expect(room.getByRole('button', { name: `Open ${MINUTES}` })).toBeVisible()
    await shot(4, 4)
  })

  await test.step('4.5 Scroll to AI assistant in the right column.', async () => {
    const assistant = assistantPanel(page)
    await assistant.scrollIntoViewIfNeeded()
    await expect(assistant.getByRole('heading', { name: 'AI assistant' })).toBeVisible()
    await expect(
      assistant.getByText(
        'The assistant unlocks the moment you lock your frame. It stays locked until then so that the position you write is yours.',
      ),
    ).toBeVisible()
    await shot(4, 5)
  })

  await test.step('4.6 Scroll to Your decision brief.', async () => {
    const heading = page.getByRole('heading', { name: 'Your decision brief' })
    await heading.scrollIntoViewIfNeeded()
    await expect(heading).toBeVisible()
    await expect(
      page.getByText(
        'The brief is what you hand in: a recommendation, the reasoning under it, and what would change your mind. It opens after you lock your frame.',
      ),
    ).toBeVisible()
    await shot(4, 6)
  })
})

// =============================================================================================
// Task 5
// =============================================================================================

test('Task 5: Lock your frame', async ({ page, shot }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'student1')
  await page.goto(`/runs/${runId}/work`)
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()

  await test.step('5.1 Scroll to Your frame in the right column.', async () => {
    const heading = page.getByRole('heading', { name: 'Your frame' })
    await heading.scrollIntoViewIfNeeded()
    await expect(heading).toBeVisible()
    await expect(page.getByLabel('The decision')).toBeVisible()
    await expect(page.getByText('Load-bearing assumptions')).toBeVisible()
    for (const n of [1, 2, 3])
      await expect(page.getByLabel(`Assumption ${String(n)}`)).toBeVisible()
    await expect(page.getByLabel('Your position now')).toBeVisible()
    await expect(page.getByText('Confidence', { exact: true })).toBeVisible()
    await expect(await counterOf(page, page.getByLabel('The decision'))).toHaveText('0 of 50 words')
    await shot(5, 1)
  })

  await test.step('5.2 Type Guide decision, back the premium tier with most of the quarterly budget in The decision.', async () => {
    await typeAndCount(page, page.getByLabel('The decision'), FRAME.decision, '12 of 50 words')
    await shot(5, 2)
  })

  await test.step('5.3 Type Guide assumption one, premium payback is under a year in Assumption 1.', async () => {
    await typeAndCount(page, page.getByLabel('Assumption 1'), FRAME.assumptions[0], '9 of 25 words')
    await shot(5, 3)
  })

  await test.step('5.4 Type Guide assumption two, value tier demand is flat in Assumption 2.', async () => {
    await typeAndCount(page, page.getByLabel('Assumption 2'), FRAME.assumptions[1], '8 of 25 words')
    await shot(5, 4)
  })

  await test.step('5.5 Type Guide assumption three, the board wants growth in Assumption 3.', async () => {
    await typeAndCount(page, page.getByLabel('Assumption 3'), FRAME.assumptions[2], '7 of 25 words')
    await shot(5, 5)
  })

  await test.step('5.6 Type Guide position, lean premium because the payback looks short in Your position now.', async () => {
    await typeAndCount(page, page.getByLabel('Your position now'), FRAME.position, '9 of 100 words')
    await shot(5, 6)
  })

  await test.step('5.7 Type 60 in Confidence as a number.', async () => {
    const number = page.getByRole('spinbutton', { name: 'Confidence as a number' })
    await number.fill(FRAME.confidence)
    await expect(number).toHaveValue(FRAME.confidence)
    // The slider and the number are one value, not two that agree most of the time.
    await expect(page.getByRole('slider', { name: 'Confidence, 0 to 100' })).toHaveValue(
      FRAME.confidence,
    )
    await shot(5, 7)
  })

  await test.step('5.8 Click Lock the frame.', async () => {
    await page.getByRole('button', { name: 'Lock the frame' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('Lock the frame permanently?')
    await expect(confirm).toContainText(
      'A locked frame is never edited, replaced, or restored — not by you, and not by your instructor. Locking it unlocks the assistant and starts the working clock.',
    )
    await shot(5, 8)
  })

  await test.step('5.9 Click Lock it.', async () => {
    await page.getByRole('alertdialog').getByRole('button', { name: 'Lock it' }).click()
    const band = page.locator('[data-state="working"]')
    await expect(band).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    await expect(band).toContainText('Working')
    await expect(page.getByRole('timer', { name: 'Working clock' })).toHaveText(
      /^2[45]:[0-5][0-9]$/,
    )
    const frame = page.locator('#locked-frame')
    await expect(frame).toContainText('Locked')
    await expect(frame).toContainText('Confidence at the frame')
    await expect(frame).toContainText(`${FRAME.confidence} of 100`)
    await expect(assistantPanel(page).getByLabel('Your request')).toBeVisible()
    await shot(5, 9)
  })
})

// =============================================================================================
// Task 6
// =============================================================================================

test('Task 6: Ask the assistant', async ({ page, shot }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'student1')
  await page.goto(`/runs/${runId}/work`)
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()

  const assistant = assistantPanel(page)
  const log = delegationLog(page)
  const entry = log.getByRole('article', { name: 'Delegation 1', exact: true })

  await test.step('6.1 Type What is the premium payback? in Your request.', async () => {
    await assistant.getByLabel('Your request').fill(FIRST_REQUEST)
    await expect(assistant.locator('#assistant-request-count')).toHaveText('28 of 2000 characters')
    await expect(assistant).toContainText('Ask in your own words. Asking costs you no clock time.')
    await shot(6, 1)
  })

  await test.step('6.2 Click Ask the assistant.', async () => {
    await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
    await expect(assistant.locator('#assistant-reply-status')).toHaveText(
      'Reply complete. One claim surfaced.',
      { timeout: ACTION_TIMEOUT_MS },
    )
    await expect(replyCard(page, 'C3')).toContainText(
      'Premium payback is about 11 months, so the premium tier returns its acquisition cost inside the fiscal year.',
    )
    await shot(6, 2)
  })

  await test.step('6.3 Scroll to Delegation Log.', async () => {
    await log.scrollIntoViewIfNeeded()
    await expect(log.getByRole('heading', { name: 'Delegation Log' })).toBeVisible()
    await expect(entry).toBeVisible()
    await expect(entry).toContainText('You asked')
    await expect(entry).toContainText(FIRST_REQUEST)
    await expect(entry).toContainText('The assistant answered')
    await expect(entry).toContainText('Claims in this reply')
    await expect(entry).toContainText('Claim C3')
    await shot(6, 3)
  })

  await test.step('6.4 Type Guide, checking the payback figure in Why you asked under Delegation 1.', async () => {
    const why = entry.getByLabel('Why you asked, delegation 1')
    await typeAndCount(page, why, WHY, '34 of 200 characters')
    await shot(6, 4)
  })

  await test.step('6.5 Click Save.', async () => {
    await entry.getByRole('button', { name: 'Save' }).click()
    await expect(entry.locator('p[id$="-status"]')).toHaveText('Saved.', {
      timeout: ACTION_TIMEOUT_MS,
    })
    await shot(6, 5)
  })

  await test.step('6.6 Click Mark as used beside Claim C3 under Delegation 1.', async () => {
    await entry.getByRole('button', { name: 'Mark claim C3 as used' }).click()
    const card = logCard(page, 'C3')
    await expect(card).toContainText('Used', { timeout: ACTION_TIMEOUT_MS })
    await expect(card).toContainText('You marked this claim used in the Delegation Log.')
    await expect(
      log.getByText(
        'Marking a claim used records that you leaned on it. A mark stays on the record.',
      ),
    ).toBeVisible()
    await shot(6, 6)
  })
})

// =============================================================================================
// Task 7
// =============================================================================================

test('Task 7: Take a stance on every claim', async ({ page, shot }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'student1')
  await page.goto(`/runs/${runId}/work`)
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()

  const assistant = assistantPanel(page)
  const c3 = workedCard(page, 'C3')

  await test.step("7.1 Find Your stance on the Claim C3 card in the assistant's reply (after a reload, the card is in the Delegation Log).", async () => {
    await c3.scrollIntoViewIfNeeded()
    await expect(c3.getByText('Your stance', { exact: true })).toBeVisible()
    const group = stanceGroup(c3, 'C3')
    await expect(group.getByRole('radio')).toHaveCount(5)
    for (const stance of STANCES) {
      await expect(group.getByRole('radio', { name: stance })).toBeVisible()
    }
    // The hint is said once, at the head of whichever panel is holding the card.
    await expect(
      page
        .getByText(
          'It costs no clock time, and you can change it while the run is open; both are kept.',
        )
        .first(),
    ).toBeVisible()
    await shot(7, 1)
  })

  await test.step('7.2 Click Accept.', async () => {
    await takeStance(page, c3, 'C3', 'Accept')
    await shot(7, 2)
  })

  await test.step('7.3 Click Verify.', async () => {
    await takeStance(page, c3, 'C3', 'Verify')
    await expect(c3).toContainText('Changed from Accept.')
    await shot(7, 3)
  })

  await test.step('7.4 Click into Your request.', async () => {
    const request = assistant.getByLabel('Your request')
    await request.click()
    await expect(request).toHaveValue('')
    await expect(assistant.locator('#assistant-request-count')).toHaveText('0 of 2000 characters')
    await shot(7, 4)
  })

  await test.step('7.5 Type What is the price sensitivity, is the value tier saturated, and what did the survey find?', async () => {
    await assistant.getByLabel('Your request').fill(SECOND_REQUEST)
    await expect(assistant.locator('#assistant-request-count')).toHaveText('89 of 2000 characters')
    await shot(7, 5)
  })

  await test.step('7.6 Click Ask the assistant.', async () => {
    await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
    await expect(assistant.locator('#assistant-reply-status')).toHaveText(
      'Reply complete. 3 claims surfaced.',
      { timeout: ACTION_TIMEOUT_MS },
    )
    for (const key of ['C5', 'C8', 'C7']) await expect(replyCard(page, key)).toBeVisible()
    await shot(7, 6)
  })

  await test.step('7.7 Click Verify under Claim C5.', async () => {
    await takeStance(page, replyCard(page, 'C5'), 'C5', 'Verify')
    await shot(7, 7)
  })

  await test.step('7.8 Click Accept under Claim C8.', async () => {
    await takeStance(page, replyCard(page, 'C8'), 'C8', 'Accept')
    await shot(7, 8)
  })

  await test.step('7.9 Click Verify under Claim C7.', async () => {
    await takeStance(page, replyCard(page, 'C7'), 'C7', 'Verify')
    await shot(7, 9)
  })
})

// =============================================================================================
// Task 8
// =============================================================================================

test('Task 8: Check a claim and escalate one', async ({ page, shot }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'student1')
  await page.goto(`/runs/${runId}/work`)
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()

  const c5 = workedCard(page, 'C5')
  const c7 = workedCard(page, 'C7')
  const c8 = workedCard(page, 'C8')

  await test.step('8.1 Click Check it on Claim C5.', async () => {
    await c5.scrollIntoViewIfNeeded()
    await c5.getByRole('button', { name: 'Check claim C5' }).click()
    const item = page.getByRole('menuitem', { name: /Source Trace/ })
    await expect(item).toBeVisible()
    await expect(item).toContainText('1 min')
    await shot(8, 1)
  })

  await test.step('8.2 Click Source Trace.', async () => {
    await page.getByRole('menuitem', { name: /Source Trace/ }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('Source Trace on claim C5')
    for (const label of ['Document', 'Passage', 'Date', 'Author']) {
      await expect(sheet).toContainText(label)
    }
    await expect(sheet).toContainText('This check cost one minute of your working clock.')
    await shot(8, 2)
  })

  await test.step('8.3 Click Close on the panel.', async () => {
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toBeHidden()
    await expect(c5.getByRole('button', { name: 'Read it again' })).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })
    await shot(8, 3)
  })

  await test.step('8.4 Click Reject under Claim C8.', async () => {
    await takeStance(page, c8, 'C8', 'Reject')
    await expect(c8).toContainText('Changed from Accept.')
    await shot(8, 4)
  })

  await test.step('8.5 Click the button Escalate beneath the stance row on Claim C7.', async () => {
    await c7.getByRole('button', { name: 'Escalate claim C7' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Escalate to a colleague')
    await expect(dialog).toContainText('You have 2 escalations left in this run.')
    await expect(dialog).toContainText('It costs five minutes of your working clock.')
    await shot(8, 5)
  })

  await test.step('8.6 Type Guide, I cannot tell whether the survey sample was large enough in What you cannot settle.', async () => {
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('What you cannot settle').fill(ESCALATION)
    await expect(dialog.locator('#escalation-count')).toHaveText('63 of 280 characters')
    await shot(8, 6)
  })

  await test.step('8.7 Click Send it.', async () => {
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Send it' }).click()
    await expect(dialog).toBeHidden({ timeout: ACTION_TIMEOUT_MS })
    await expect(c7).toContainText('You wrote', { timeout: ACTION_TIMEOUT_MS })
    await expect(c7).toContainText(ESCALATION)
    await expect(c7).toContainText('They answered')
    await expect(c7).toContainText('Rowan Adeyemi, research operations.')
    await expect(c7).toContainText('This escalation cost 5 minutes of your working clock.')
    await shot(8, 7)
  })

  await test.step('8.8 Click the button Escalate beneath the stance row on Claim C5.', async () => {
    await c5.getByRole('button', { name: 'Escalate claim C5' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Escalate to a colleague')
    await expect(dialog).toContainText('You have one escalation left in this run.')
    await shot(8, 8)
  })

  await test.step('8.9 Click Cancel.', async () => {
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    // Unchanged: the stance it had, the check it ran, and no escalation on it.
    await expect(stanceGroup(c5, 'C5').getByRole('radio', { name: 'Verify' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(c5.getByRole('button', { name: 'Read it again' })).toBeVisible()
    await expect(c5).not.toContainText('You wrote')
    await shot(8, 9)
  })
})

// =============================================================================================
// Task 9
// =============================================================================================

test('Task 9: Declare outside-tool use', async ({ page, shot }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'student1')
  await page.goto(`/runs/${runId}/work`)
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()

  const declaration = page.locator('#declaration-control')

  await test.step('9.1 Scroll to Declare outside-tool use under the Delegation Log.', async () => {
    await declaration.scrollIntoViewIfNeeded()
    await expect(
      declaration.getByRole('heading', { name: 'Declare outside-tool use' }),
    ).toBeVisible()
    await expect(
      declaration.getByText(
        'A declaration never lowers a band or a point. Tassl does not detect, infer, or estimate outside use, and nothing it records is treated as misconduct.',
      ),
    ).toBeVisible()
    await shot(9, 1)
  })

  await test.step('9.2 Click the button Declare outside-tool use.', async () => {
    await declaration.getByRole('button', { name: 'Declare outside-tool use' }).click()
    await expect(declaration.getByLabel('What you used, and what for')).toBeVisible()
    await expect(
      declaration.getByText('One sentence is enough. At most 500 characters.'),
    ).toBeVisible()
    await shot(9, 2)
  })

  await test.step('9.3 Type Guide, a calculator for the payback arithmetic in What you used, and what for.', async () => {
    const field = declaration.getByLabel('What you used, and what for')
    await typeAndCount(page, field, DECLARATION, '46 of 500 characters')
    await shot(9, 3)
  })

  await test.step('9.4 Click Record it.', async () => {
    await declaration.getByRole('button', { name: 'Record it' }).click()
    await expect(declaration.getByRole('status')).toHaveText(
      'Recorded. It sits with the run and changes nothing about it.',
      { timeout: ACTION_TIMEOUT_MS },
    )
    await shot(9, 4)
  })
})

// =============================================================================================
// Task 10
// =============================================================================================

test('Task 10: Write your decision brief and file it', async ({ page, shot }) => {
  test.setTimeout(240_000)
  await signInAs(page, 'student1')
  await page.goto(`/runs/${runId}/work`)
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()

  const editor = briefEditor(page)
  const assistant = assistantPanel(page)
  const log = delegationLog(page)
  const saveStatus = editor.locator('#brief-lock-status')
  const lockButton = editor.getByRole('button', { name: 'Lock the decision' })
  const confirm = page.getByRole('alertdialog')

  /**
   * The brief saves as you type: 800 ms after the last keystroke the whole draft goes to the
   * server and the line beside the lock button reads "Saved." — which it may already read from the
   * field before. The wait is therefore on the server's copy of the draft carrying what was just
   * typed, and only then on the line the guide quotes.
   */
  async function waitForSaved(holds: (draft: Record<string, unknown>) => boolean) {
    await expect
      .poll(
        async () => {
          const workspace = await readJson<{ briefDraft: Record<string, unknown> | null }>(
            page.request,
            `/api/v1/runs/${runId}/workspace`,
          )
          return workspace.briefDraft !== null && holds(workspace.briefDraft)
        },
        { message: 'the autosave should carry the value just typed', timeout: ACTION_TIMEOUT_MS },
      )
      .toBe(true)
    await expect(saveStatus).toHaveText('Saved.')
  }

  await test.step('10.1 Scroll to Your decision brief.', async () => {
    await editor.scrollIntoViewIfNeeded()
    await expect(editor.getByRole('heading', { name: 'Your decision brief' })).toBeVisible()
    await expect(editor).toContainText(
      'It saves as you type; nothing is filed until you lock the decision.',
    )
    await expect(editor.getByLabel('Your recommendation')).toBeVisible()
    await expect(editor.getByLabel('Why', { exact: true })).toBeVisible()
    await expect(editor.getByText('Load-bearing assumptions')).toBeVisible()
    await expect(editor.getByLabel('What would change your mind')).toBeVisible()
    await expect(editor.getByText('The figures you are betting on')).toBeVisible()
    await expect(editor.getByText('Confidence', { exact: true })).toBeVisible()
    await shot(10, 1)
  })

  await test.step('10.2 Type Guide recommendation, move most of the budget to premium this quarter in Your recommendation.', async () => {
    await typeAndCount(
      page,
      editor.getByLabel('Your recommendation'),
      BRIEF.recommendation,
      '11 of 120 words',
    )
    await shot(10, 2)
  })

  await test.step('10.3 Type Guide reasoning, the premium payback is short and retention is strong in Why.', async () => {
    await typeAndCount(
      page,
      editor.getByLabel('Why', { exact: true }),
      BRIEF.why,
      '11 of 250 words',
    )
    await shot(10, 3)
  })

  await test.step('10.4 Type Guide brief assumption one, payback stays near eleven months in Assumption 1.', async () => {
    await typeAndCount(
      page,
      editor.getByLabel('Assumption 1'),
      BRIEF.assumptions[0],
      '9 of 25 words',
    )
    await shot(10, 4)
  })

  await test.step('10.5 Type Guide brief assumption two, premium retention holds in Assumption 2.', async () => {
    await typeAndCount(
      page,
      editor.getByLabel('Assumption 2'),
      BRIEF.assumptions[1],
      '7 of 25 words',
    )
    await shot(10, 5)
  })

  await test.step('10.6 Type Guide brief assumption three, the value tier is saturated in Assumption 3.', async () => {
    await typeAndCount(
      page,
      editor.getByLabel('Assumption 3'),
      BRIEF.assumptions[2],
      '9 of 25 words',
    )
    await shot(10, 6)
  })

  await test.step('10.7 Type Guide, a payback figure above sixteen months in What would change your mind.', async () => {
    await typeAndCount(
      page,
      editor.getByLabel('What would change your mind'),
      BRIEF.changeMyMind,
      '7 of 60 words',
    )
    await shot(10, 7)
  })

  await test.step("10.8 Type 60 in Share of the quarter's acquisition budget going to premium, in percent.", async () => {
    const share = editor.getByLabel(
      "Share of the quarter's acquisition budget going to premium, in percent",
    )
    await share.fill(BRIEF.share)
    await expect(share).toHaveValue(BRIEF.share)
    // Digits only: a letter is not taken at all.
    await share.pressSequentially('x')
    await expect(share).toHaveValue(BRIEF.share)
    await shot(10, 8)
  })

  await test.step('10.9 Type 11 in Premium payback you are betting on, in months.', async () => {
    await editor.getByLabel('Premium payback you are betting on, in months').fill(BRIEF.payback)
    await waitForSaved((draft) => JSON.stringify(draft.namedValues ?? {}).includes(BRIEF.payback))
    await shot(10, 9)
  })

  await test.step('10.10 Type 62 in Confidence as a number.', async () => {
    await editor.getByLabel('Confidence as a number').fill(BRIEF.confidence)
    await waitForSaved((draft) => draft.confidence === Number(BRIEF.confidence))
    await shot(10, 10)
  })

  await test.step('10.11 Type What is the value tier payback? in Your request.', async () => {
    await assistant.getByLabel('Your request').fill(THIRD_REQUEST)
    await expect(assistant.locator('#assistant-request-count')).toHaveText('31 of 2000 characters')
    await shot(10, 11)
  })

  await test.step('10.12 Click Ask the assistant.', async () => {
    await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
    await expect(assistant.locator('#assistant-reply-status')).toHaveText(
      'Reply complete. One claim surfaced.',
      { timeout: ACTION_TIMEOUT_MS },
    )
    await expect(replyCard(page, 'C1')).toBeVisible()
    await shot(10, 12)
  })

  await test.step('10.13 Click Mark as used beside Claim C1 under Delegation 3.', async () => {
    const entry = log.getByRole('article', { name: 'Delegation 3', exact: true })
    await entry.getByRole('button', { name: 'Mark claim C1 as used' }).click()
    const card = logCard(page, 'C1')
    await expect(card).toContainText('Used', { timeout: ACTION_TIMEOUT_MS })
    await expect(card).toContainText('You marked this claim used in the Delegation Log.')
    await expect(editor.locator('#brief-lock-preflight')).toHaveText(
      'One claim you leaned on has no stance yet. Filing asks for one on it.',
      { timeout: ACTION_TIMEOUT_MS },
    )
    await shot(10, 13)
  })

  await test.step('10.14 Click Lock the decision.', async () => {
    await lockButton.click()
    await expect(confirm).toContainText('File this decision?')
    await expect(confirm).toContainText('What will be filed')
    await expect(confirm).toContainText(BRIEF.recommendation)
    await expect(confirm).toContainText(`Confidence ${BRIEF.confidence} of 100`)
    await shot(10, 14)
  })

  await test.step('10.15 Click File it.', async () => {
    await confirm.getByRole('button', { name: 'File it' }).click()
    await expect(confirm).toContainText('A claim you leaned on has no stance')
    await expect(confirm).toContainText('The claim')
    await expect(confirm).toContainText(await claimText(page, 'C1'))
    await expect(confirm.getByRole('button', { name: 'Back to the brief' })).toBeVisible()
    await expect(confirm.getByRole('button', { name: 'Go to the claim' })).toBeVisible()
    await shot(10, 15)
  })

  await test.step('10.16 Click Go to the claim.', async () => {
    await confirm.getByRole('button', { name: 'Go to the claim' }).click()
    await expect(confirm).toBeHidden()
    const card = replyCard(page, 'C1')
    await expect(card).toBeFocused()
    await expect(card).toContainText('No stance yet')
    await shot(10, 16)
  })

  await test.step('10.17 Click Accept under Claim C1.', async () => {
    const card = replyCard(page, 'C1')
    await takeStance(page, card, 'C1', 'Accept')
    await expect(card).not.toContainText('No stance yet')
    await shot(10, 17)
  })

  await test.step('10.18 Click Lock the decision.', async () => {
    await lockButton.click()
    await expect(confirm).toContainText('File this decision?')
    await expect(confirm).toContainText('What will be filed')
    await shot(10, 18)
  })

  await test.step('10.19 Click File it.', async () => {
    await confirm.getByRole('button', { name: 'File it' }).click()
    await page.waitForURL(new RegExp(`/runs/${runId}/locked$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Decision locked' })).toBeVisible()
    const filed = page.locator('#locked-brief')
    await expect(page.getByRole('heading', { name: 'The decision you filed' })).toBeVisible()
    await expect(filed).toContainText('Filed')
    await expect(filed).toContainText('Confidence at the lock')
    await expect(filed).toContainText(`${BRIEF.confidence} of 100`)
    await expect(filed).toContainText('Premium payback you are betting on, in months')
    await expect(filed).toContainText(BRIEF.payback)
    await expect(page.getByRole('heading', { name: 'The frame you locked' })).toBeVisible()
    await shot(10, 19)
  })

  await test.step('10.20 Click Add an addendum.', async () => {
    await page.locator('#addendum').getByRole('button', { name: 'Add an addendum' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Add an addendum')
    await expect(dialog.getByLabel('Your addendum')).toBeVisible()
    await expect(
      dialog.getByText('At most 50 words. You can add one addendum per run.'),
    ).toBeVisible()
    await shot(10, 20)
  })

  await test.step('10.21 Type Guide addendum, I would trace the payback figure before filing in Your addendum.', async () => {
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Your addendum').fill(ADDENDUM)
    await expect(dialog.locator('#addendum-count')).toHaveText('10 of 50 words')
    await shot(10, 21)
  })

  await test.step('10.22 Click Add it.', async () => {
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Add it' }).click()
    await expect(dialog).toBeHidden({ timeout: ACTION_TIMEOUT_MS })
    const addendum = page.locator('#addendum')
    await expect(addendum.getByRole('heading', { name: 'Your addendum' })).toBeVisible()
    await expect(addendum).toContainText(ADDENDUM)
    await expect(addendum).toContainText('Added')
    await expect(addendum).toContainText(
      'One addendum per run, and this run has its one. It is kept apart from the decision above.',
    )
    await shot(10, 22)
  })
})

// =============================================================================================
// Task 11
// =============================================================================================

test('Task 11: Respond to the Turn', async ({ page, shot }) => {
  test.setTimeout(240_000)
  await signInAs(page, 'student1')
  await page.goto(`/runs/${runId}/locked`)
  await expect(page.getByRole('heading', { level: 1, name: 'Decision locked' })).toBeVisible()

  const form = page.locator('#turn-response')

  await test.step('11.1 Find the panel The Turn at the top of Decision locked.', async () => {
    const wait = page.locator('#turn-wait')
    await expect(wait.getByRole('heading', { name: 'The Turn' })).toBeVisible()
    await expect(wait.getByRole('timer', { name: 'Time until the Turn' })).toHaveText(
      /^[0-9]{2}:[0-5][0-9]$/,
    )
    await expect(wait).toContainText(
      'A message from the world arrives shortly, and the run reopens for 12 minutes so you can hold, revise or reverse.',
    )
    await shot(11, 1)
  })

  await test.step('11.2 Wait for Time until the Turn to reach zero, about 90 seconds after you filed.', async () => {
    // Locally the test-only route shifts the run's timeline past the Turn (D-109); the page is
    // then waited on as a person would wait on it — the band's poll moves it to the Turn.
    await advanceRunClock(page, runId, PAST_THE_TURN_MS)
    await expect(page.getByRole('heading', { level: 1, name: 'The Turn' })).toBeVisible({
      timeout: POLL_TIMEOUT_MS,
    })
    await page.waitForURL(new RegExp(`/runs/${runId}/turn$`))
    const message = page.locator('#turn-message')
    await expect(message.getByRole('heading', { name: 'What arrived' })).toBeVisible()
    await expect(message.getByText('Stakeholder message', { exact: true })).toBeVisible()
    await shot(11, 2)
  })

  await test.step('11.3 Find Turn window in the band at the top.', async () => {
    await expect(page.getByText('Turn window', { exact: true })).toBeVisible()
    await expect(page.getByRole('timer', { name: 'Turn window' })).toHaveText(/^1[12]:[0-5][0-9]$/)
    await shot(11, 3)
  })

  await test.step('11.4 Read What arrived.', async () => {
    const message = page.locator('#turn-message')
    await expect(message).toContainText('Ellery here.')
    await expect(message).toContainText('61 percent')
    await expect(message).toContainText('Arrived')
    await shot(11, 4)
  })

  await test.step('11.5 Scroll to What this puts in front of you.', async () => {
    const claims = page.locator('#turn-claims')
    await claims.scrollIntoViewIfNeeded()
    await expect(
      claims.getByRole('heading', { name: 'What this puts in front of you' }),
    ).toBeVisible()
    for (const key of ['C2', 'C3']) {
      const card = claims.getByRole('article', { name: `Claim ${key}` })
      await expect(card).toBeVisible()
      await expect(card.getByText('Your stance', { exact: true })).toBeVisible()
    }
    await expect(claims).toContainText(
      'Filing a response asks for a position on each of them, and taking one costs nothing.',
    )
    await shot(11, 5)
  })

  await test.step('11.6 Click Verify under Claim C2.', async () => {
    const card = page.locator('#turn-claims').getByRole('article', { name: 'Claim C2' })
    await takeStance(page, card, 'C2', 'Verify')
    await shot(11, 6)
  })

  await test.step('11.7 Click Challenge under Claim C3.', async () => {
    const card = page.locator('#turn-claims').getByRole('article', { name: 'Claim C3' })
    await takeStance(page, card, 'C3', 'Challenge')
    await expect(card).toContainText('Changed from Verify.')
    await shot(11, 7)
  })

  await test.step('11.8 Find What you can work with in the right column.', async () => {
    const aside = page.getByRole('complementary', { name: 'What you can work with' })
    await expect(aside).toContainText(
      'The assistant and the Evidence Room are open again until the window closes. Checks and escalations cost window time exactly as they cost clock time before the lock.',
    )
    await expect(aside.getByRole('heading', { name: 'Evidence Room' })).toBeVisible()
    await expect(aside.getByRole('heading', { name: 'AI assistant' })).toBeVisible()
    await shot(11, 8)
  })

  await test.step('11.9 Scroll to What you filed before this arrived.', async () => {
    const frozen = page.locator('#turn-frozen')
    await frozen.scrollIntoViewIfNeeded()
    await expect(
      frozen.getByRole('heading', { name: 'What you filed before this arrived' }),
    ).toBeVisible()
    await expect(frozen).toContainText('The frame you locked')
    await expect(frozen).toContainText('The decision you filed')
    // Neither is editable: the record has no field in it.
    await expect(frozen.getByRole('textbox')).toHaveCount(0)
    await shot(11, 9)
  })

  await test.step('11.10 Under Your response, click Revise.', async () => {
    await expect(form.getByRole('heading', { name: 'Your response' })).toBeVisible()
    const revise = form.getByRole('radio', { name: 'Revise' })
    await revise.click()
    await expect(revise).toBeChecked()
    await expect(form).toContainText(
      'The decision holds in direction, and something inside it changes.',
    )
    await shot(11, 10)
  })

  await test.step('11.11 Type Guide revision, the retention figure changed so the payback no longer holds in Why.', async () => {
    await typeAndCount(page, form.getByLabel('Why', { exact: true }), TURN.why, '12 of 150 words')
    await shot(11, 11)
  })

  await test.step('11.12 Type 48 in Confidence as a number.', async () => {
    const confidence = form.getByLabel('Confidence as a number')
    await confidence.fill(TURN.confidence)
    await expect(confidence).toHaveValue(TURN.confidence)
    await expect(form).toContainText('of 100')
    await shot(11, 12)
  })

  await test.step('11.13 Click File the response.', async () => {
    await form.getByRole('button', { name: 'File the response' }).click()
    await page.waitForURL(new RegExp(`/runs/${runId}/defense$`))
    await expect(page.getByRole('heading', { level: 1, name: 'The defense' })).toBeVisible()
    await shot(11, 13)
  })
})

// =============================================================================================
// Task 12
// =============================================================================================

test('Task 12: Answer the defense', async ({ page, shot }) => {
  test.setTimeout(240_000)
  await signInAs(page, 'student1')
  await page.goto(`/runs/${runId}/defense`)
  await expect(page.getByRole('heading', { level: 1, name: 'The defense' })).toBeVisible()

  const questions = page.locator('#defense-questions')

  await test.step('12.1 Read the sentence under the heading The defense.', async () => {
    await expect(page.getByText('There is no assistant here and no Evidence Room')).toBeVisible()
    await expect(page.locator('#assistant-panel')).toHaveCount(0)
    await expect(page.locator('#evidence-room')).toHaveCount(0)
    await expect(page.locator('#delegation-log')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'AI assistant' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Evidence Room' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Delegation Log' })).toHaveCount(0)
    await shot(12, 1)
  })

  await test.step('12.2 Scroll to Questions.', async () => {
    await questions.scrollIntoViewIfNeeded()
    await expect(questions.getByRole('heading', { name: 'Questions' })).toBeVisible()
    await expect(questions).toContainText(
      'There is no clock on this stage; nothing runs out and nothing is taken away.',
    )
    await expect(questions.getByText('Question 1', { exact: true })).toBeVisible()
    await expect(questions.getByLabel('Your answer')).toBeVisible()
    await shot(12, 2)
  })

  await test.step('12.3 Type I went with what I remembered and did not note where it came from. in Your answer.', async () => {
    await typeAndCount(
      page,
      questions.getByLabel('Your answer'),
      FROM_MEMORY,
      '66 of 5000 characters',
    )
    await shot(12, 3)
  })

  await test.step('12.4 Click Submit answer.', async () => {
    await questions.getByRole('button', { name: 'Submit answer' }).click()
    await expect(questions.getByText(FROM_MEMORY)).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    await expect(questions).toContainText('Answered')
    await expect(questions.getByText('Follow-up', { exact: true })).toBeVisible()
    await expect(questions.getByLabel('Your answer')).toHaveValue('')
    await shot(12, 4)
  })

  await test.step('12.5 Answer all but the last question with Guide, 16 months because the memo says so via Submit answer.', async () => {
    for (;;) {
      const listed = await defenseQuestions(page)
      const outstanding = listed.filter((question) => !question.answered).length
      if (outstanding <= 1) break
      const answered = listed.length - outstanding
      await questions.getByLabel('Your answer').fill(SOURCED_ANSWER)
      await questions.getByRole('button', { name: 'Submit answer' }).click()
      // The screen re-reads the interview after every answer; the next box is typed into only
      // once the progress line has moved on.
      await expect(questions).toContainText(
        `${String(answered + 1)} of ${String(listed.length)} answered`,
        { timeout: ACTION_TIMEOUT_MS },
      )
    }
    const listed = await defenseQuestions(page)
    expect(listed.filter((question) => !question.answered)).toHaveLength(1)
    await expect(questions).toContainText(
      `${String(listed.length - 1)} of ${String(listed.length)} answered`,
    )
    await expect(questions.getByLabel('Your answer')).toHaveCount(1)
    await expect(questions.getByLabel('Your answer')).toHaveValue('')
    await shot(12, 5)
  })

  await test.step('12.6 Scroll to What you filed in the right column.', async () => {
    const filed = page.getByRole('complementary', { name: 'What you filed' })
    await filed.scrollIntoViewIfNeeded()
    await expect(filed.getByRole('heading', { name: 'What you filed' })).toBeVisible()
    await expect(filed.getByRole('heading', { name: 'Your addendum' })).toBeVisible()
    await expect(filed.getByRole('heading', { name: 'Your Turn response' })).toBeVisible()
    await expect(filed).toContainText('Revise')
    await expect(filed).toContainText(TURN.why)
    await expect(filed).toContainText('Confidence after the Turn')
    await expect(filed).toContainText(`${TURN.confidence} of 100`)
    await shot(12, 6)
  })

  await test.step('12.7 Click Finish the defense.', async () => {
    await questions.getByRole('button', { name: 'Finish the defense' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('Finish the defense?')
    await expect(confirm).toContainText(
      'One question has no answer. Unanswered questions count as no answer, and are filed empty.',
    )
    await expect(confirm.getByRole('button', { name: 'Keep answering' })).toBeVisible()
    await expect(confirm.getByRole('button', { name: 'Finish it' })).toBeVisible()
    await shot(12, 7)
  })

  await test.step('12.8 Click Finish it.', async () => {
    await page.getByRole('alertdialog').getByRole('button', { name: 'Finish it' }).click()
    await page.waitForURL(new RegExp(`/runs/${runId}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Run status' })).toBeVisible()
    await shot(12, 8)
  })
})

// =============================================================================================
// Task 13
// =============================================================================================

test('Task 13: Read your result and your debrief', async ({ page, request, shot }) => {
  test.setTimeout(300_000)
  await signInAs(page, 'student1')
  await page.goto(`/runs/${runId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Run status' })).toBeVisible()

  const status = page.locator('#run-status')
  const bands = page.locator('#debrief-bands')
  const questions = page.locator('#debrief-questions')

  await test.step('13.1 Find the heading under Run status.', async () => {
    await expect(status.getByRole('heading', { level: 2 })).toHaveText(
      /^(Your run is being scored|Your debrief is ready)$/,
    )
    await shot(13, 1)
  })

  await test.step('13.2 Wait on Run status for scoring to finish, a few seconds.', async () => {
    await expect(
      status.getByRole('heading', { level: 2, name: 'Your debrief is ready' }),
    ).toBeVisible({ timeout: SCORING_TIMEOUT_MS })
    await expect(status).toContainText(
      'The bands in it are drafts until your instructor confirms them',
    )
    await expect(status.getByRole('link', { name: 'Read the debrief' })).toBeVisible()
    await shot(13, 2)
  })

  await test.step('13.3 Click Read the debrief.', async () => {
    await status.getByRole('link', { name: 'Read the debrief' }).click()
    await page.waitForURL(new RegExp(`/runs/${runId}/debrief$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Run Debrief' })).toBeVisible()
    await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible()
    await expect(
      page.getByText(
        'Every band below is a draft. Your instructor reads the run and confirms or changes each one; when they do, this page shows what they decided in place of the draft.',
      ),
    ).toBeVisible()
    await shot(13, 3)
  })

  await test.step('13.4 Scroll down Run Debrief from top to bottom.', async () => {
    const sections = page.locator('section[id^="debrief-"]')
    await expect(sections).toHaveCount(DEBRIEF_SECTIONS.length)
    const titles = await sections.evaluateAll((nodes) =>
      nodes.map((node) => node.querySelector('h2')?.textContent?.trim() ?? ''),
    )
    expect(titles).toEqual([...DEBRIEF_SECTIONS])
    await sections.last().scrollIntoViewIfNeeded()
    await shot(13, 4)
  })

  await test.step('13.5 Scroll to The seven dimensions.', async () => {
    await bands.scrollIntoViewIfNeeded()
    await expect(bands.getByRole('heading', { name: 'The seven dimensions' })).toBeVisible()
    for (const dimension of DIMENSIONS) {
      await expect(
        bands.getByRole('heading', { level: 3, name: dimension, exact: true }),
      ).toBeVisible()
    }
    await expect(bands.getByText('Draft band')).toHaveCount(7)
    await shot(13, 5)
  })

  await test.step('13.6 Scroll to What your course does with the bands.', async () => {
    const points = page.locator('#debrief-points')
    await points.scrollIntoViewIfNeeded()
    await expect(
      points.getByRole('heading', { name: 'What your course does with the bands' }),
    ).toBeVisible()
    await expect(points.getByText('Provisional points, draft')).toBeVisible()
    await expect(
      points.getByText('No draft band reaches a gradebook, and this number is in no export.'),
    ).toBeVisible()
    await shot(13, 6)
  })

  await test.step('13.7 Open Runs after your instructor has confirmed the bands.', async () => {
    // The instructor's act on the replay's Bands tab, through the endpoint that tab's shortcut
    // calls, in a request context of its own so the student's session is untouched.
    await signInAsInstructor(request)
    await confirmEveryBand(request, runId)

    await page.goto('/runs')
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
    const row = runRow(page, WALKTHROUGH)
    await expect(row.getByText('Confirmed', { exact: true })).toBeVisible()
    await expect(row.getByRole('link', { name: `Read the debrief · ${WALKTHROUGH}` })).toBeVisible()
    await shot(13, 7)
  })

  await test.step('13.8 Click Read the debrief.', async () => {
    await runRow(page, WALKTHROUGH)
      .getByRole('link', { name: `Read the debrief · ${WALKTHROUGH}` })
      .click()
    await page.waitForURL(new RegExp(`/runs/${runId}/debrief$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Run Debrief' })).toBeVisible()
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible()
    await expect(
      page.getByText(
        'Your instructor has read this run. Each band below is what they decided, with any note they wrote.',
      ),
    ).toBeVisible()
    await shot(13, 8)
  })

  await test.step('13.9 Scroll to The seven dimensions.', async () => {
    await bands.scrollIntoViewIfNeeded()
    await expect(bands.getByText('Confirmed band')).toHaveCount(7)
    await expect(bands.getByText('Draft band')).toHaveCount(0)
    await expect(
      bands.getByRole('heading', { name: 'Your instructor wrote', exact: true }),
    ).toHaveCount(7)
    await expect(bands.getByText('Your instructor wrote no note on this dimension.')).toHaveCount(7)
    await shot(13, 9)
  })

  await test.step('13.10 Scroll to Two questions.', async () => {
    await questions.scrollIntoViewIfNeeded()
    await expect(questions.getByRole('heading', { name: 'Two questions' })).toBeVisible()
    await expect(
      questions.getByLabel('Which single stance would you change, and to what?'),
    ).toBeVisible()
    await expect(
      questions.getByLabel('What will you do differently in the next run like this?'),
    ).toBeVisible()
    await expect(questions.getByText('Up to 100 words.')).toHaveCount(2)
    await shot(13, 10)
  })

  await test.step('13.11 Type Guide, Verify on C5 to Challenge in Which single stance would you change, and to what?', async () => {
    await typeAndCount(
      page,
      questions.getByLabel('Which single stance would you change, and to what?'),
      DEBRIEF_ANSWERS.stanceToChange,
      '6 / 100 words',
    )
    await shot(13, 11)
  })

  await test.step('13.12 Type Guide, trace every figure first in What will you do differently in the next run like this?', async () => {
    await typeAndCount(
      page,
      questions.getByLabel('What will you do differently in the next run like this?'),
      DEBRIEF_ANSWERS.doDifferently,
      '5 / 100 words',
    )
    await shot(13, 12)
  })

  await test.step('13.13 Click File both answers.', async () => {
    await questions.getByRole('button', { name: 'File both answers' }).click()
    // The closing sentence is drawn by the server's next render, after the fields have gone: it is
    // what says the answers were filed rather than merely typed.
    await expect(questions).toContainText('Both answers are filed and this run is closed.', {
      timeout: ACTION_TIMEOUT_MS,
    })
    await expect(questions.getByRole('button', { name: 'File both answers' })).toHaveCount(0)
    await expect(questions.getByText(DEBRIEF_ANSWERS.stanceToChange)).toBeVisible()
    await expect(questions.getByText(DEBRIEF_ANSWERS.doDifferently)).toBeVisible()
    await expect(questions).toContainText('Answered')
    await shot(13, 13)
  })
})

// =============================================================================================
// Task 14
// =============================================================================================

test('Task 14: Open your Judgment Record', async ({ page, shot }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'student1')

  const graphs = page.locator('#record-graphs')

  await test.step('14.1 Click Runs in the rail.', async () => {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Runs' })
      .click()
    await page.waitForURL(/\/runs$/)
    const row = runRow(page, WALKTHROUGH)
    await expect(row.getByText('Recorded', { exact: true })).toBeVisible()
    await expect(
      row.getByRole('link', { name: `Open the Judgment Record · ${WALKTHROUGH}` }),
    ).toBeVisible()
    await shot(14, 1)
  })

  await test.step('14.2 Click Open the Judgment Record.', async () => {
    await runRow(page, WALKTHROUGH)
      .getByRole('link', { name: `Open the Judgment Record · ${WALKTHROUGH}` })
      .click()
    await page.waitForURL(new RegExp(`/records/${runId}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Judgment Record' })).toBeVisible()
    await expect(page.getByText(/^Bands confirmed .+/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Download record' })).toBeVisible()
    await shot(14, 2)
  })

  await test.step('14.3 Scroll to The four graphs.', async () => {
    await graphs.scrollIntoViewIfNeeded()
    await expect(graphs.getByRole('heading', { name: 'The four graphs' })).toBeVisible()
    for (const title of [
      'Confidence line',
      'Clock timeline',
      'Stance matrix',
      'Frame beside decision',
    ]) {
      await expect(graphs.getByRole('heading', { name: title })).toBeVisible({
        timeout: GRAPH_TIMEOUT_MS,
      })
    }
    await expect(graphs.getByRole('button', { name: 'Show data table' })).toHaveCount(4)
    await shot(14, 3)
  })

  await test.step('14.4 Click Show data table under Stance matrix.', async () => {
    const matrix = graphs.locator('figure[data-graph="stance_matrix"]')
    await matrix.getByRole('button', { name: 'Show data table' }).click()
    await expect(matrix.getByRole('columnheader', { name: 'Stance taken' })).toBeVisible()
    await expect(matrix.getByRole('columnheader', { name: 'Stance warranted' })).toBeVisible()
    await expect(matrix.getByRole('button', { name: 'Show graph' })).toBeVisible()
    await expect(matrix.getByRole('button', { name: 'Show data table' })).toHaveCount(0)
    await shot(14, 4)
  })

  await test.step('14.5 Scroll to The seven dimensions.', async () => {
    const bands = page.locator('#record-bands')
    await bands.scrollIntoViewIfNeeded()
    await expect(bands.getByRole('heading', { name: 'The seven dimensions' })).toBeVisible()
    for (const dimension of DIMENSIONS) {
      await expect(
        bands.getByRole('heading', { level: 3, name: dimension, exact: true }),
      ).toBeVisible()
    }
    await expect(bands.getByText('Confirmed band')).toHaveCount(7)
    await expect(
      bands.getByRole('heading', { name: 'Your instructor wrote', exact: true }),
    ).toHaveCount(7)
    await shot(14, 5)
  })

  await test.step('14.6 Scroll to How this run was set up.', async () => {
    const context = page.locator('#record-context')
    await context.scrollIntoViewIfNeeded()
    await expect(context.getByRole('heading', { name: 'How this run was set up' })).toBeVisible()
    await expect(context.getByText('Mode', { exact: true })).toBeVisible()
    await expect(context.getByText('Standard', { exact: true })).toBeVisible()
    await expect(context.getByText('Variant', { exact: true })).toBeVisible()
    await expect(context.getByText('Defective', { exact: true })).toBeVisible()
    await shot(14, 6)
  })

  await test.step('14.7 Find the sentence under Download record.', async () => {
    const download = page.getByRole('link', { name: 'Download record' })
    await download.scrollIntoViewIfNeeded()
    await expect(
      page.getByText(
        'A JSON file of this run: the events, the graphs and the confirmed bands. It carries no course arithmetic, so nothing in it is a grade.',
      ),
    ).toBeVisible()
    await shot(14, 7)
  })

  await test.step('14.8 Click Download record.', async () => {
    const saving = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Download record' }).click()
    const download = await saving
    expect(download.suggestedFilename()).toBe(`tassl-record-${runId}.json`)
    await shot(14, 8)
  })

  await test.step('14.9 Scroll to Four-run trajectory at the bottom of the page.', async () => {
    const trajectory = page.getByRole('region', { name: 'Four-run trajectory' })
    await trajectory.scrollIntoViewIfNeeded()
    await expect(trajectory.getByRole('heading', { name: 'Four-run trajectory' })).toBeVisible()
    await expect(trajectory.getByText('Illustrative sample data')).toBeVisible()
    await expect(
      trajectory.getByText('These four runs are invented and describe no student, including you.'),
    ).toBeVisible()
    await shot(14, 9)
  })
})

// =============================================================================================
// Task 15
// =============================================================================================

test('Task 15: Continue after an assistant outage', async ({ page, request, shot }) => {
  test.setTimeout(300_000)
  await signInAs(page, 'student1')

  /** The second run, on the sound variant. */
  let soundRunId = ''
  const assistant = assistantPanel(page)

  await test.step('15.1 Click Runs in the rail.', async () => {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Runs' })
      .click()
    await page.waitForURL(/\/runs$/)
    await expect(runRow(page, SOUND).getByRole('button', { name: `Start ${SOUND}` })).toBeVisible()
    await shot(15, 1)
  })

  await test.step('15.2 Click Start in the row Decision Run 1 (sound).', async () => {
    await runRow(page, SOUND)
      .getByRole('button', { name: `Start ${SOUND}` })
      .click()
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}\/start$/)
    soundRunId = runIdFromUrl(page.url())
    await expect(page.getByRole('heading', { level: 1, name: 'Before you begin' })).toBeVisible()
    await shot(15, 2)
  })

  await test.step('15.3 Click Begin the Readiness Check.', async () => {
    await page.getByRole('button', { name: 'Begin the Readiness Check' }).click()
    await page.waitForURL(new RegExp(`/runs/${soundRunId}/readiness$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Readiness Check' })).toBeVisible()
    await expect(page.getByText('0 of 16 answered')).toBeVisible()
    await shot(15, 3)
  })

  await test.step('15.4 Click Submit the check.', async () => {
    await page.getByRole('button', { name: 'Submit the check' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('Submit the Readiness Check?')
    await expect(confirm).toContainText(
      '16 items have no answer. Submitting closes the check and opens the scenario; an item left blank simply leaves its idea unread.',
    )
    await shot(15, 4)
  })

  await test.step('15.5 Click Submit.', async () => {
    await page.getByRole('alertdialog').getByRole('button', { name: 'Submit', exact: true }).click()
    await page.waitForURL(new RegExp(`/runs/${soundRunId}/readiness/result$`))
    await expect(page.getByRole('heading', { level: 1, name: 'What the check read' })).toBeVisible()
    await shot(15, 5)
  })

  await test.step('15.6 Click Open the scenario.', async () => {
    await page.getByRole('link', { name: 'Open the scenario' }).click()
    await page.waitForURL(new RegExp(`/runs/${soundRunId}/work$`))
    await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()
    await shot(15, 6)
  })

  await test.step('15.7 Type Guide outage decision, hold the budget split in The decision.', async () => {
    await typeAndCount(
      page,
      page.getByLabel('The decision'),
      OUTAGE_FRAME.decision,
      '7 of 50 words',
    )
    await shot(15, 7)
  })

  await test.step('15.8 Type Guide outage assumption one in Assumption 1.', async () => {
    await typeAndCount(
      page,
      page.getByLabel('Assumption 1'),
      OUTAGE_FRAME.assumptions[0],
      '4 of 25 words',
    )
    await shot(15, 8)
  })

  await test.step('15.9 Type Guide outage assumption two in Assumption 2.', async () => {
    await typeAndCount(
      page,
      page.getByLabel('Assumption 2'),
      OUTAGE_FRAME.assumptions[1],
      '4 of 25 words',
    )
    await shot(15, 9)
  })

  await test.step('15.10 Type Guide outage assumption three in Assumption 3.', async () => {
    await typeAndCount(
      page,
      page.getByLabel('Assumption 3'),
      OUTAGE_FRAME.assumptions[2],
      '4 of 25 words',
    )
    await shot(15, 10)
  })

  await test.step('15.11 Type Guide outage position, hold in Your position now.', async () => {
    await typeAndCount(
      page,
      page.getByLabel('Your position now'),
      OUTAGE_FRAME.position,
      '4 of 100 words',
    )
    await shot(15, 11)
  })

  await test.step('15.12 Click Lock the frame.', async () => {
    await page.getByRole('button', { name: 'Lock the frame' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('Lock the frame permanently?')
    await shot(15, 12)
  })

  await test.step('15.13 Click Lock it.', async () => {
    await page.getByRole('alertdialog').getByRole('button', { name: 'Lock it' }).click()
    const band = page.locator('[data-state="working"]')
    await expect(band).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    await expect(band).toContainText('Working')
    await expect(assistant.getByLabel('Your request')).toBeVisible()
    await shot(15, 13)
  })

  await test.step('15.14 Type What is the premium payback? in Your request.', async () => {
    // "After you lock the frame, your instructor arms one assistant outage from the replay's
    // Actions tab (a test control), and your next request meets it" — the Goal of this task, done
    // through the control that tab calls, in the instructor's own request context.
    await signInAsInstructor(request)
    const armed = await request.post(
      `/api/v1/review/runs/${soundRunId}/test-controls/force-assistant-failure`,
      { data: {}, headers: WRITE_HEADERS },
    )
    expect(armed.status(), await armed.text()).toBe(200)

    await assistant.getByLabel('Your request').fill(FIRST_REQUEST)
    await expect(assistant.locator('#assistant-request-count')).toHaveText('28 of 2000 characters')
    await shot(15, 14)
  })

  await test.step('15.15 Click Ask the assistant.', async () => {
    await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
    const overlay = page.getByRole('alertdialog')
    await expect(overlay).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    await expect(overlay).toContainText('The run is paused')
    await expect(overlay).toContainText('The assistant did not answer.')
    await expect(overlay).toContainText(
      'Your clock stopped when it happened, and the time this pause takes is given back to you when you resume. Nothing you have done is lost.',
    )
    await shot(15, 15)
  })

  await test.step('15.16 Click Resume the run.', async () => {
    const overlay = page.getByRole('alertdialog')
    await overlay.getByRole('button', { name: 'Resume the run' }).click()
    await expect(overlay).toBeHidden({ timeout: ACTION_TIMEOUT_MS })
    const band = page.locator('[data-state="working"]')
    await expect(band).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    await expect(band).toContainText('Working')
    await expect(delegationLog(page)).toContainText(
      'No answer came back. The run paused, your clock stopped, and the time was given back when you resumed.',
    )
    await shot(15, 16)
  })

  await test.step('15.17 Type What is the premium payback? in Your request, replacing what is there.', async () => {
    await assistant.getByLabel('Your request').fill(FIRST_REQUEST)
    await expect(assistant.locator('#assistant-request-count')).toHaveText('28 of 2000 characters')
    await shot(15, 17)
  })

  await test.step('15.18 Click Ask the assistant.', async () => {
    await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
    await expect(assistant.locator('#assistant-reply-status')).toHaveText(
      'Reply complete. One claim surfaced.',
      { timeout: ACTION_TIMEOUT_MS },
    )
    await expect(replyCard(page, 'C3')).toBeVisible()
    await shot(15, 18)
  })
})

// =============================================================================================
// Task 16
// =============================================================================================

test('Task 16: Manage notifications, your account, and sign out', async ({ page, shot }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'student1')

  const header = page.getByRole('banner')

  await test.step('16.1 Click the Notifications bell in the header.', async () => {
    await header.getByRole('link', { name: /^Notifications:/ }).click()
    await page.waitForURL(/\/notifications$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
    await expect(page.getByText('What Tassl has told you, newest first.')).toBeVisible()
    const list = page.getByRole('list', { name: 'Notifications' })
    await expect(list.getByText('Your run has been scored').first()).toBeVisible()
    await expect(list.getByText('Your bands are confirmed').first()).toBeVisible()
    await shot(16, 1)
  })

  await test.step('16.2 Click Mark all read.', async () => {
    await page.getByRole('button', { name: 'Mark all read' }).click()
    await expect(page.getByText('Everything is marked read.')).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })
    await shot(16, 2)
  })

  await test.step('16.3 Click the Account button in the header.', async () => {
    await header.getByRole('button', { name: /^Account:/ }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu).toContainText('Student One')
    await expect(menu).toContainText(seatEmail('student1'))
    await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    await shot(16, 3)
  })

  await test.step('16.4 Click Settings.', async () => {
    await page.getByRole('menu').getByRole('menuitem', { name: 'Settings' }).click()
    await page.waitForURL(/\/settings$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Account settings' })).toBeVisible()
    const tabs = page.getByRole('navigation', { name: 'Account settings sections' })
    for (const tab of ['Profile', 'Security', 'Data']) {
      await expect(tabs.getByRole('link', { name: tab })).toBeVisible()
    }
    await expect(page.getByLabel('Your name')).toBeVisible()
    const email = page.getByLabel('Email address')
    await expect(email).toHaveValue(seatEmail('student1'))
    await expect(email).not.toBeEditable()
    await shot(16, 4)
  })

  await test.step('16.5 Click Security.', async () => {
    await page
      .getByRole('navigation', { name: 'Account settings sections' })
      .getByRole('link', { name: 'Security' })
      .click()
    await page.waitForURL(/\/settings\/security$/)
    await expect(page.getByRole('heading', { name: 'Password' })).toBeVisible()
    for (const label of ['Current password', 'New password', 'New password again']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible()
    }
    await expect(page.getByRole('heading', { name: 'Signed-in devices' })).toBeVisible()
    await expect(page.getByText('This device', { exact: true })).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })
    await shot(16, 5)
  })

  await test.step('16.6 Click Data.', async () => {
    await page
      .getByRole('navigation', { name: 'Account settings sections' })
      .getByRole('link', { name: 'Data' })
      .click()
    await page.waitForURL(/\/settings\/data$/)
    await expect(page.getByRole('heading', { name: 'Download my data' })).toBeVisible()
    await expect(
      page.getByText(
        'A JSON file holding your profile, your memberships, your runs, your notifications, and the actions you took. Twice an hour.',
      ),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Delete account' })).toBeVisible()
    await shot(16, 6)
  })

  await test.step('16.7 Click the button Download my data.', async () => {
    const saving = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download my data' }).click()
    await expect(page.getByText('Your file is downloading.')).toBeVisible()
    const download = await saving
    expect(download.suggestedFilename()).toBe('tassl-my-data.json')
    await shot(16, 7)
  })

  await test.step('16.8 Click Delete my account.', async () => {
    await page.getByRole('button', { name: 'Delete my account' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Delete your account?')
    await expect(dialog.getByLabel(`Type ${seatEmail('student1')} to confirm`)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Keep my account' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Delete my account' })).toBeVisible()
    await shot(16, 8)
  })

  await test.step('16.9 Click Keep my account.', async () => {
    // The seeded seat is shared: the dialog is left through the one button that keeps it.
    const dialog = page.getByRole('alertdialog')
    await dialog.getByRole('button', { name: 'Keep my account' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Download my data' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Delete account' })).toBeVisible()
    await expect(page).toHaveURL(/\/settings\/data$/)
    await shot(16, 9)
  })

  await test.step('16.10 Click the Account button, then Sign out.', async () => {
    await header.getByRole('button', { name: /^Account:/ }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: 'Sign out' }).click()
    await page.waitForURL(/\/sign-in/)
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Tassl' })).toBeVisible()
    await shot(16, 10)
  })
})
