// NFR-012: every screen a student meets in a run — the runs list, the policy display, the Readiness
// Check, its concept-map result, the workspace in `framing` and again in `working`, the locked
// decision, the Turn window, the defense, and the two screens that come after it, the Run Debrief
// and the Judgment Record — carries no WCAG 2.1 A/AA violation.
//
// Every screen is scanned with something in it rather than empty, because an empty one proves very
// little: a runs table with no rows has no cells to associate, a check with no items has no radio
// group to name, a room with no documents has no disclosure to expand, and a form nobody has
// submitted has no error to announce. So the run is driven through the states in order and each
// screen is scanned in the state a student meets it in — including the frame form with its
// refusals on screen and a document open in the Evidence Room, which are the two surfaces on
// `/work` that exist only after somebody has acted.
//
// The three popups are scanned open, and separately, for the same reason. A menu and a dialog are
// portalled out of the page's own tree and carry roles, names and focus behaviour of their own, so
// a scan of the page behind them says nothing about either: the claim card's actions menu, the
// addendum dialog and the defense's finish confirmation each get a scan with the popup on screen.
//
// It runs as `student2`, one seat away from `tests/e2e/walkthrough/02-05-start-to-frame.spec.ts`,
// on an assignment it makes for itself: an instructor creates a course, a section, the enrolment
// and an assignment on the **seeded** confirmed package version before the student signs in
// (`createStudentAssignment` in ../instructor/api.ts). The package is the seeded Meridian Roast one
// (06 §5 item 4), so the screens are scanned with the nine documents and sixteen items a real run
// carries; only the assignment is this spec's.
//
// It scanned the seeded walkthrough assignment ("Decision Run 1 (walkthrough)", 06 §5 item 5) until
// Step 6.5's review, and that made it a spec that only passed once. D-041 allows one run per
// student per assignment until it is voided, so the three browser projects collided with each other
// inside one run of the suite, and a second `pnpm test:e2e` against the same database met the
// attempt the first had left. Nothing in the product could take that attempt back out:
// `deleteWalkthroughRun` (D-104), the Delete control on UI-032, is the one thing meant to remove a
// run, and the database refused it — migration 0005 declared every run child table (`run_events`,
// `run_document_opens`, `run_readiness_answers`, `run_readiness_results`, `run_frames`) `ON DELETE
// no action`, so `DELETE FROM runs` raised 23503 for any run that had done anything at all.
// Migration `0012_run_delete_cascade` (D-255) closed that, and the delete now works on a run that
// has been taken. This scan does not depend on it either way: `purgeRuns` in
// `tests/e2e/global-setup.ts` takes its own run out.
import type { APIRequestContext, Page } from '@playwright/test'
import { axe, expect, seatEmail, signInAs, signOut, test, type Seat } from '../fixtures'
import { addSectionMember, createStudentAssignment, signInAsInstructor } from '../instructor/api'
import { driveRunToScored, post, readJson as readApi } from '../walkthrough/scored-run'

/**
 * The seat the debrief run is taken in.
 *
 * `student1` rather than the `student2` the scan above uses: D-041 allows one run per student per
 * assignment, the two tests in this file make an assignment each, and giving them separate seats
 * keeps one seat's D-026 write budget from carrying two endpoint-driven runs at once across three
 * browser projects.
 */
const DEBRIEF_STUDENT: Seat = 'student1'

/** Enough answers that the navigator is scanned with both of its states in it. */
const ANSWERED_ITEMS = 3

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
const WRITE_HEADERS = { 'content-type': 'application/json', 'X-Requested-With': 'tassl' } as const

/** Raises C3; the claim whose card is scanned with its controls on it. */
const REQUEST = 'What is the premium payback?'
const CLAIM_KEY = 'C3'

/**
 * The frame and the brief this scan files.
 *
 * Both are written through the documented endpoints rather than through the form. The frame form
 * with its refusals on screen is scanned above, which is what this spec is for; typing the frame
 * and then the brief a second time through the browser would add minutes to every project for a
 * starting position two other specs already prove (`02-05-start-to-frame`, `08-lock`).
 */
const FRAME = {
  decision: 'Hold the premium share where it is until the payback figure has been checked.',
  assumptions: [
    'The premium payback figure has not been revised since the board deck.',
    'Value tier acquisition keeps performing at its current rate.',
    'Roastery capacity absorbs the current premium volume this quarter.',
  ],
  position:
    'I lean towards holding the split until the payback number is checked against something later than the board deck.',
  confidence: 55,
} as const

const BRIEF = {
  recommendation: 'Hold the premium share at its current level for one more quarter.',
  rationale:
    'The payback figure the upmarket case rests on was computed before premium fulfillment was quoted, and nothing dated later confirms it.',
  assumptions: [
    'Value acquisition holds at its current blended cost.',
    'Roastery capacity absorbs current premium volume.',
    'No competitor repositions inside the quarter.',
  ],
  changeMyMind: 'A payback figure recomputed with fulfillment in it and dated later than the deck.',
  confidence: 62,
  namedValues: {},
} as const

/** Locks the frame, which is what opens the assistant and starts the working clock (FR-041). */
async function frameRun(page: Page, runId: string): Promise<void> {
  const response = await page.request.post(`/api/v1/runs/${runId}/frame`, {
    data: FRAME,
    headers: WRITE_HEADERS,
  })
  expect(response.status(), await response.text()).toBe(200)
}

/** Files the decision, so `/locked` can be scanned with a real record on it (FR-102). */
async function lockDecision(page: Page, runId: string): Promise<void> {
  const response = await page.request.post(`/api/v1/runs/${runId}/lock`, {
    data: BRIEF,
    headers: WRITE_HEADERS,
  })
  expect(response.status(), await response.text()).toBe(200)
}

/**
 * Brings the Turn forward past its delay, so `/turn` can be scanned with a real window open.
 *
 * `advance-clock` shifts the run's own timestamps and the read materializes what the clock made
 * true (D-042, D-109); nothing here decides that the Turn arrived. 130 seconds is past the longest
 * delay a run can draw (FR-110: 60 to 120 seconds after the lock).
 */
async function deliverTurn(page: Page, runId: string): Promise<void> {
  const shifted = await page.request.post(`/api/v1/test/runs/${runId}/advance-clock`, {
    data: { ms: 130_000 },
    headers: WRITE_HEADERS,
  })
  expect(shifted.status(), await shifted.text()).toBe(200)
}

/**
 * Files the Turn response, so `/defense` can be scanned with a real interview on it.
 *
 * Every claim the window raised needs a stance first (FR-111), which is the gate the Turn screen
 * draws and `tests/e2e/walkthrough/09-turn.spec.ts` proves on the screen.
 */
async function respondToTurn(page: Page, runId: string): Promise<void> {
  const claims = await readJson<{ id: string; inTurnWindow: boolean }[]>(
    page.request,
    `/api/v1/runs/${runId}/claims`,
  )
  for (const claim of claims.filter((entry) => entry.inTurnWindow)) {
    const stanced = await page.request.put(`/api/v1/runs/${runId}/claims/${claim.id}/stance`, {
      data: { stance: 'verify' },
      headers: WRITE_HEADERS,
    })
    expect(stanced.status(), await stanced.text()).toBe(200)
  }

  const response = await page.request.post(`/api/v1/runs/${runId}/turn/response`, {
    data: {
      response: 'hold',
      justification: 'Nothing in the message moves the number the decision rests on.',
      confidence: 55,
    },
    headers: WRITE_HEADERS,
  })
  expect(response.status(), await response.text()).toBe(200)
}

async function readJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path)
  expect(response.status(), `GET ${path}: ${await response.text()}`).toBe(200)
  return (await response.json()) as T
}

/**
 * The seat's row for this spec's own assignment, with no attempt on it.
 *
 * `/me/assignments` is keyed by the seat's section memberships (10 §3 `listMyAssignments`), so
 * finding the row is also the proof that the enrolment took — and a freshly created assignment
 * cannot carry an attempt, which is what makes the scan below repeatable.
 */
async function assignmentWithNoAttempt(page: Page, label: string): Promise<void> {
  const assignments = await readJson<{
    items: { assignmentId: string; label: string; latestRun: { id: string } | null }[]
  }>(page.request, '/api/v1/me/assignments')
  const assignment = assignments.items.find((item) => item.label === label)
  expect(assignment, `no assignment "${label}" for this seat`).toBeDefined()
  expect(assignment?.latestRun, `"${label}" already carries an attempt`).toBeNull()
}

test('the student run screens have no axe violations', async ({ page, request }) => {
  // Nine full-page scans on top of a run driven from the list to the defense is more than the
  // suite's default patience allows on a loaded machine (D-188). The assertions are unchanged.
  test.setTimeout(600_000)

  // The course this scan is taken in, built through the instructor's own endpoints on a request
  // context with its own cookie jar, so the student session below is never disturbed.
  await signInAsInstructor(request)
  const { label } = await createStudentAssignment(request, {
    what: 'Student a11y',
    studentEmail: seatEmail('student2'),
    variant: 'defective',
  })

  await signInAs(page, 'student2')
  await assignmentWithNoAttempt(page, label)

  // UI-020, the runs list, with this seat's assignments in it and a Start on the row that has no
  // attempt yet.
  await page.goto('/runs')
  await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
  const assignmentRow = page.getByRole('row').filter({ hasText: label })
  await expect(assignmentRow).toBeVisible()
  await axe(page)

  // UI-021, the policy display: the counts statement, the policy, the mapping table and the clock.
  await assignmentRow.getByRole('button', { name: `Start ${label}` }).click()
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}\/start$/)
  const runId = new URL(page.url()).pathname.split('/')[2] as string

  await expect(page.getByRole('heading', { level: 1, name: 'Before you begin' })).toBeVisible()
  await expect(page.locator('#run-mapping').getByRole('table')).toBeVisible()
  await axe(page)

  // UI-022, the Readiness Check: the clock, the navigator of sixteen items, and one item's radio
  // group. Three items are answered before the scan so the navigator carries both of its states.
  await page.getByRole('button', { name: 'Begin the Readiness Check' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/readiness$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Readiness Check' })).toBeVisible()

  const navigator = page.getByRole('toolbar', { name: 'Items' })
  await expect(navigator.getByRole('button')).toHaveCount(16)
  for (let position = 1; position <= ANSWERED_ITEMS; position += 1) {
    await page.getByRole('radiogroup').getByRole('radio').first().click()
    await expect(
      navigator.getByRole('button', { name: `Item ${String(position)}, answered` }),
    ).toBeVisible()
    if (position < ANSWERED_ITEMS) await page.getByRole('button', { name: 'Next item' }).click()
  }
  await axe(page)

  // UI-022's result: the concept map, with a row for every idea the check asked about.
  await page.getByRole('button', { name: 'Submit the check' }).click()
  const submitConfirm = page.getByRole('alertdialog')
  await expect(submitConfirm).toContainText('Submit the Readiness Check?')
  await submitConfirm.getByRole('button', { name: 'Submit', exact: true }).click()

  await page.waitForURL(new RegExp(`/runs/${runId}/readiness/result$`))
  await expect(page.getByRole('heading', { level: 1, name: 'What the check read' })).toBeVisible()
  const conceptRows = page.locator('#readiness-concepts').getByRole('listitem')
  expect(await conceptRows.count()).toBeGreaterThanOrEqual(6)
  await axe(page)

  // UI-023 in `framing`: the brief, the Evidence Room with a document open, and the frame form with
  // its refusals on screen.
  await page.getByRole('link', { name: 'Open the scenario' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/work$`))
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()

  const room = page.locator('#evidence-room')
  const documents = room.getByRole('listitem')
  await expect(documents).toHaveCount(9)
  const firstTitle = (await documents.first().getByRole('heading', { level: 3 }).innerText()).trim()
  await room.getByRole('button', { name: `Open ${firstTitle}` }).click()
  await expect(page.getByRole('article', { name: firstTitle })).toBeVisible()

  await page.getByRole('button', { name: 'Lock the frame' }).click()
  await expect(page.getByText('This is part of the frame. Write something in it.')).toHaveCount(5)
  await axe(page)

  // -------------------------------------------------------------------------------------------
  // UI-023 in `working`, with everything on it that a student can reach (Phase 8)
  //
  // The framing scan above is half the screen. The working state is the other half and it is the
  // larger one: three columns, a claim card with its stance radio group and its actions menu, the
  // brief editor with six fields and a numeric one, and the Delegation Log. Each of those is a
  // shape a scan can fail on — a radio group without a name, a menu item without a label, a numeric
  // field whose unit only exists as a visual adornment — so the run is driven into that state and
  // scanned there rather than empty.
  // -------------------------------------------------------------------------------------------

  await frameRun(page, runId)
  await page.goto(`/runs/${runId}/work`)
  await expect(page.locator('[data-state="working"]')).toBeVisible()

  const assistant = page.locator('#assistant-panel')
  await assistant.getByLabel('Your request').fill(REQUEST)
  // The live character count is the panel's own state, so waiting for it is the proof that React
  // owns the field this browser is about to submit: a click that lands ahead of hydration is a
  // native form post carrying a value the form never saw (the trap D-182 found in WebKit).
  await expect(assistant.getByText(`${String(REQUEST.length)} of 2000 characters`)).toBeVisible()
  await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
  await expect(assistant.locator('#assistant-reply-status')).toContainText('Reply complete')

  // A claim card with its controls, and the brief editor with something in it: a form nobody has
  // typed into has no counter to associate and no numeric field to name.
  //
  // The card with the controls is the assistant's: a claim is worked where it was most recently
  // surfaced, and the Delegation Log's copy of a claim the reply is holding draws the record
  // instead of a second identical instrument (D-313).
  const claimCard = assistant.getByRole('article', { name: `Claim ${CLAIM_KEY}` })
  await expect(claimCard.getByRole('radiogroup')).toBeVisible()
  await expect(
    page.locator('#delegation-log').getByRole('article', { name: `Claim ${CLAIM_KEY}` }),
  ).toContainText('You are taking a position on this claim in the reply above.')
  const editor = page.locator('#brief-editor-panel')
  await editor
    .getByLabel('Your recommendation')
    .fill('Hold the premium share for one more quarter.')
  await editor.getByLabel('Premium payback you are betting on, in months').fill('11')
  await axe(page)

  // The actions menu open, because a popup is a surface of its own: it is portalled out of the
  // page's own tree and carries its own roles and labels.
  await claimCard.getByRole('button', { name: `Check claim ${CLAIM_KEY}` }).click()
  await expect(page.getByRole('menuitem').first()).toBeVisible()
  await axe(page)
  await page.keyboard.press('Escape')

  // -------------------------------------------------------------------------------------------
  // UI-024 `/runs/[runId]/locked`: the filed brief, the frozen frame, the Turn countdown and the
  // addendum control
  // -------------------------------------------------------------------------------------------

  await lockDecision(page, runId)
  await page.goto(`/runs/${runId}/locked`)
  await expect(page.getByRole('heading', { level: 1, name: 'Decision locked' })).toBeVisible()
  await expect(page.getByRole('timer', { name: 'Time until the Turn' })).toBeVisible()
  await axe(page)

  // And the addendum dialog, for the same reason the menu was scanned open.
  await page.locator('#addendum').getByRole('button', { name: 'Add an addendum' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await axe(page)
  await page.keyboard.press('Escape')

  // -------------------------------------------------------------------------------------------
  // UI-025 `/runs/[runId]/turn`: the Turn, its window claims with their stance groups, the reopened
  // room and assistant, the response form, and the frozen record beside
  //
  // It is the densest screen in the run after the workspace, and every shape a scan can fail on is
  // on it: a second `role="timer"` in the band, a radio group with three choice cards, claim cards
  // with their own radio groups and menus, and a numeric field whose unit is drawn beside it.
  // -------------------------------------------------------------------------------------------

  await deliverTurn(page, runId)
  await page.goto(`/runs/${runId}/turn`)
  await expect(page.getByRole('heading', { level: 1, name: 'The Turn' })).toBeVisible()
  await expect(page.getByRole('timer', { name: 'Turn window' })).toBeVisible()
  // Scanned with something typed into the response, because a form nobody has typed into has no
  // counter to associate and no numeric field to name.
  await page
    .locator('#turn-response')
    .getByLabel('Why', { exact: true })
    .fill('The retention figure the payback was priced on has been corrected.')
  await axe(page)

  // -------------------------------------------------------------------------------------------
  // UI-026 `/runs/[runId]/defense`: the interview with one box open, the artifacts beside it, and
  // the confirm dialog that finishes it
  // -------------------------------------------------------------------------------------------

  await respondToTurn(page, runId)
  await page.goto(`/runs/${runId}/defense`)
  await expect(page.getByRole('heading', { level: 1, name: 'The defense' })).toBeVisible()
  await expect(page.locator('#defense-questions').getByRole('textbox')).toHaveCount(1)
  await page.locator('#defense-questions').getByLabel('Your answer').fill('I do not remember.')
  await axe(page)

  // And the confirm dialog open, for the same reason the menu and the addendum were.
  await page
    .locator('#defense-questions')
    .getByRole('button', { name: 'Finish the defense' })
    .click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await axe(page)
  await page.keyboard.press('Escape')

  await signOut(page)
})

// UI-028 and UI-029, the two screens after the run: the Run Debrief in both of its versions and the
// Judgment Record.
//
// A separate test with its own run, because these three screens exist only past states the scan
// above deliberately stops short of — the debrief opens at `scored` and the record at `confirmed`,
// and reaching either means an instructor deciding seven bands. The run is driven through the
// documented endpoints (`../walkthrough/scored-run.ts`) for the reason that file's header gives.
//
// All three are dense: twelve labelled regions, seven band articles, four graphs each with a
// heading, a hidden description and a data table behind a toggle, two textareas with live word
// counters, and a table of invented numbers inside a labelled sample panel. A scan of one says
// nothing about the others.
test('the debrief and the Judgment Record have no axe violations', async ({ page, request }) => {
  // A full run driven to a confirmed one, then four full-page axe scans (D-188).
  test.setTimeout(600_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Axe debrief',
    studentEmail: seatEmail(DEBRIEF_STUDENT),
    variant: 'defective',
  })
  await addSectionMember(request, assignment.section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  await signInAs(page, DEBRIEF_STUDENT)
  const runId = await driveRunToScored(page.request, assignment.assignment.id)

  // The draft version: every band amber, the provisional figure labelled draft, the form open.
  await page.goto(`/runs/${runId}/debrief`)
  await expect(page.getByRole('heading', { level: 1, name: 'Run Debrief' })).toBeVisible()
  await expect(page.locator('#debrief-bands').getByText('Draft band').first()).toBeVisible()
  // Scanned with something typed into the two questions: a form nobody has typed into has no
  // counter to associate and no error to announce.
  await page
    .locator('#debrief-questions')
    .getByLabel('Which single stance would you change, and to what?')
    .fill('I would verify the premium payback figure rather than accepting it.')
  await axe(page)

  await signOut(page)

  // The confirmed version, and the record it opens.
  await signInAsInstructor(request)
  await post(request, `/api/v1/review/runs/${runId}/confirm-remaining`)
  const confirmed = await readApi<{ run: { state: string } }>(
    request,
    `/api/v1/review/runs/${runId}`,
  )
  expect(confirmed.run.state).toBe('confirmed')

  await signInAs(page, DEBRIEF_STUDENT)
  await page.goto(`/runs/${runId}/debrief`)
  await expect(page.locator('#debrief-bands').getByText('Confirmed band').first()).toBeVisible()
  await axe(page)

  await page.goto(`/records/${runId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Judgment Record' })).toBeVisible()
  await expect(page.locator('#record-bands').getByText('Confirmed band').first()).toBeVisible()
  await axe(page)

  await signOut(page)
})
