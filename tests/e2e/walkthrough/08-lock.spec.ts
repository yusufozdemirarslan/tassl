// Step 8 of the walkthrough (PRD §12): the Decision Lock (FR-084, FR-100 to FR-108, UI-023's brief
// editor, UI-024).
//
// Two runs, because the step is two things and the second cannot be reached by pressing anything.
//
// **The first run is the lock as a student takes it.** They lean on a claim without taking a
// position on it, and the gate refuses — naming the claim in the words they already read, and
// offering the way back to it (FR-084). They take a stance, file the decision with the figures it
// rests on, and from that moment nothing about it can change: the workspace is gone, the brief
// endpoint refuses, and the only thing left to write is the one addendum FR-107 allows.
//
// **The second run is the clock taking it for them** (FR-105, D-044). Its assignment is labelled
// "Auto-lock test run"; the frame is locked, the brief is left unwritten, and `advance-clock`
// (D-109 — the only honest way to reach an expiry without waiting for the clock) puts the working
// clock past zero. The decision is then filed as it stood, which is empty, and the assertion is
// made through the trace as well as the screen: `decision_locked` with `auto: true` and every
// field empty is what FR-105 says must be recorded, and a screen showing "Left empty." over a
// record that says something else would be the wrong half of the proof.
//
// The seed carries an assignment of that name with a two-minute clock (06 §5 item 5), and this
// spec deliberately does not use it: D-041 allows one run per student per assignment until it is
// voided, so three browser projects starting a run on one seeded assignment would collide inside a
// single run of the suite — the trap `tests/e2e/a11y/student-run.spec.ts` documents at length. The
// assignment made here carries the same name under `SUITE_PREFIX` and the package's own clock, and
// `advance-clock` reaches the expiry either way: what the run proves is the auto-lock, not how many
// minutes it waited.
//
// Two things this spec deliberately does not assert. The `speed_outlier` flag is not read from the
// student's trace, because the student's trace does not carry it (`trace/owner-view.ts` marks it
// reviewer-only, D-298): FR-106 calls it a signal rather than a penalty, and a signal shown to the
// person it is about is a penalty. And nothing here asserts that the lock was quick or slow — the
// run is filed in whatever time the browser takes, and that is not a thing the product judges.
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, seatEmail, signInAs, signOut, test } from '../fixtures'
import { createStudentAssignment, signInAsInstructor } from '../instructor/api'

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
const WRITE_HEADERS = { 'content-type': 'application/json', 'X-Requested-With': 'tassl' } as const

/** Raises C3, whose carried figure is the one the brief's payback field names (D-076). */
const REQUEST = 'What is the premium payback?'
const CLAIM_KEY = 'C3'

/** The frame both runs lock, inside FR-040's limits; setup rather than subject. */
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

/** The brief this run files, every field inside FR-100's limits. */
const BRIEF = {
  recommendation:
    'Hold the premium share at its current level for one more quarter and re-run the payback with fulfillment costs in it.',
  rationale:
    'The payback figure the upmarket case rests on was computed before premium fulfillment was quoted, and nothing dated after the board deck confirms it. Holding costs one quarter of upside; moving on an unchecked figure puts most of the acquisition budget behind an assumption.',
  assumptions: [
    'Value acquisition holds at its current blended cost.',
    'Roastery capacity absorbs current premium volume.',
    'No competitor repositions inside the quarter.',
  ],
  changeMyMind:
    'A payback figure recomputed with premium fulfillment in it, dated later than the board deck, and still inside a year.',
  confidence: '62',
} as const

/** FR-101: the figure the recommendation rests on, in the unit the field asks for. */
const PAYBACK_FIGURE = '11'

/** FR-107's fifty words, well inside them. */
const ADDENDUM =
  'I should have said that the capacity assumption comes from the operations note rather than from anything I checked myself.'

type StudentAssignment = { assignmentId: string; label: string; latestRun: { id: string } | null }
type TraceEvent = { seq: number; type: string; payload: Record<string, unknown> }

async function readJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path)
  expect(response.status(), `GET ${path}: ${await response.text()}`).toBe(200)
  return (await response.json()) as T
}

async function post<T>(page: Page, path: string, data: unknown = {}, expected = 200): Promise<T> {
  const response = await page.request.post(path, { data, headers: WRITE_HEADERS })
  expect(response.status(), `POST ${path}: ${await response.text()}`).toBe(expected)
  return (await response.json().catch(() => null)) as T
}

async function traceOf(page: Page, runId: string): Promise<TraceEvent[]> {
  return readJson<TraceEvent[]>(page.request, `/api/v1/runs/${runId}/trace`)
}

/** The one event of a type, asserted to be the only one of it. */
function onlyEvent(events: readonly TraceEvent[], type: string): TraceEvent {
  const found = events.filter((event) => event.type === type)
  expect(found, `expected exactly one ${type} event, got ${String(found.length)}`).toHaveLength(1)
  return found[0] as TraceEvent
}

async function myAssignment(page: Page, label: string): Promise<StudentAssignment> {
  const { items } = await readJson<{ items: StudentAssignment[] }>(
    page.request,
    '/api/v1/me/assignments',
  )
  const found = items.find((item) => item.label === label)
  expect(found, `no assignment "${label}"`).toBeDefined()
  return found as StudentAssignment
}

/** Steps 2 to 5 through the endpoints the screens call; returns the run, in `working`. */
async function reachWorking(page: Page, assignmentId: string): Promise<string> {
  const { id: runId } = await post<{ id: string }>(
    page,
    `/api/v1/assignments/${assignmentId}/runs`,
    {},
    201,
  )
  await post(page, `/api/v1/runs/${runId}/policy-ack`)

  const check = await readJson<{ items: { id: string; options: { key: string }[] }[] }>(
    page.request,
    `/api/v1/runs/${runId}/readiness`,
  )
  for (const item of check.items) {
    const answered = await page.request.put(`/api/v1/runs/${runId}/readiness/answers/${item.id}`, {
      data: { answerKey: item.options[0]?.key },
      headers: WRITE_HEADERS,
    })
    expect(answered.status(), await answered.text()).toBe(204)
  }
  await post(page, `/api/v1/runs/${runId}/readiness/submit`)
  await post(page, `/api/v1/runs/${runId}/frame`, FRAME)

  const run = await readJson<{ state: string }>(page.request, `/api/v1/runs/${runId}`)
  expect(run.state, 'the run should be in `working`').toBe('working')
  return runId
}

test('walkthrough step 8: the lock gate refuses, the decision is filed, and the clock files an unwritten one', async ({
  page,
  request,
}) => {
  // Two full runs, each with sixteen answered items and a page build, is well past Playwright's
  // default; the assertions are unchanged, only the patience (D-188).
  test.setTimeout(420_000)

  await signInAsInstructor(request)
  const filed = await createStudentAssignment(request, {
    what: 'Decision lock',
    studentEmail: seatEmail('student1'),
    variant: 'defective',
  })
  // The label the step names: "Auto-lock test run". `suiteName` prefixes and suffixes it so the
  // global teardown can find it again, and the phrase itself is what this run is called.
  const autoLock = await createStudentAssignment(request, {
    what: 'Auto-lock test',
    studentEmail: seatEmail('student1'),
    variant: 'defective',
  })
  expect(autoLock.label).toContain('Auto-lock test run')

  await signInAs(page, 'student1')

  // ===========================================================================================
  // Run one: the gate, the lock, and what cannot happen afterwards
  // ===========================================================================================

  const assignment = await myAssignment(page, filed.label)
  const runId = await reachWorking(page, assignment.assignmentId)

  await page.goto(`/runs/${runId}/work`)
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()

  const assistant = page.locator('#assistant-panel')
  const log = page.locator('#delegation-log')
  const editor = page.locator('#brief-editor-panel')

  // A claim, and a declaration that the student leaned on it — with no position taken on it. The
  // used mark is one of FR-084's three routes into reliance (`log_mark`, 06 §3.4).
  await assistant.getByLabel('Your request').fill(REQUEST)
  // The live character count is the panel's own state, so waiting for it is the proof that React
  // owns the field this browser is about to submit: a click that lands ahead of hydration is a
  // native form post carrying a value the form never saw (the trap D-182 found in WebKit).
  await expect(assistant.getByText(`${String(REQUEST.length)} of 2000 characters`)).toBeVisible()
  await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
  await expect(assistant.locator('#assistant-reply-status')).toContainText('Reply complete')

  // The mark is the log's own control (D-270); the claim is *worked* in the reply that raised it,
  // which is where the stance below is taken (D-313).
  const logCard = log.getByRole('article', { name: `Claim ${CLAIM_KEY}` })
  const workCard = assistant.getByRole('article', { name: `Claim ${CLAIM_KEY}` })
  await expect(logCard).toBeVisible()
  await expect(logCard).toContainText('You are taking a position on this claim in the reply above.')
  await log.getByRole('button', { name: `Mark claim ${CLAIM_KEY} as used` }).click()
  await expect(logCard).toContainText('You marked this claim used in the Delegation Log.')

  // FR-084 said before the irreversible press rather than by it (D-319): the claim now wears the
  // mark on its own card, and the lock says how many claims it is going to ask about.
  await expect(workCard).toContainText('No stance yet')
  await expect(editor).toContainText(
    'One claim you leaned on has no stance yet. Filing asks for one on it.',
  )

  // -------------------------------------------------------------------------------------------
  // The brief (FR-100), written into the editor the workspace's third column carries
  // -------------------------------------------------------------------------------------------

  await editor.getByLabel('Your recommendation').fill(BRIEF.recommendation)
  await editor.getByLabel('Why', { exact: true }).fill(BRIEF.rationale)
  for (const [index, assumption] of BRIEF.assumptions.entries()) {
    await editor.getByLabel(`Assumption ${String(index + 1)}`).fill(assumption)
  }
  await editor.getByLabel('What would change your mind').fill(BRIEF.changeMyMind)
  await editor.getByLabel('Confidence as a number').fill(BRIEF.confidence)

  // The counters are the server's counts (D-075): the number under the box is the number
  // `wordLimit(n)` will refuse on, counted by the same rule — a word is a run of non-whitespace.
  const rationaleWords = BRIEF.rationale.trim().split(/\s+/).length
  await expect(editor.getByText(`${String(rationaleWords)} of 250 words`)).toBeVisible()

  // -------------------------------------------------------------------------------------------
  // The gate refuses, and names the claim (FR-084, UI-024)
  // -------------------------------------------------------------------------------------------

  await editor.getByRole('button', { name: 'Lock the decision' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('File this decision?')
  // An irreversible press shows what it is about to file, in the student's own words and with no
  // mark on any of it (D-319).
  await expect(confirm).toContainText('What will be filed')
  await expect(confirm).toContainText(BRIEF.recommendation)
  await confirm.getByRole('button', { name: 'File it' }).click()

  const claims = await readJson<{ id: string; key: string; text: string }[]>(
    page.request,
    `/api/v1/runs/${runId}/claims`,
  )
  const claim = claims.find((entry) => entry.key === CLAIM_KEY)
  expect(claim, `claim ${CLAIM_KEY} should be surfaced`).toBeDefined()

  // The same dialog, answering the same press: the claim named in the words the student read, and
  // not one word about what stance it deserves (FR-073).
  await expect(confirm).toContainText('A claim you leaned on has no stance')
  await expect(confirm).toContainText(claim?.text ?? '')
  const spoken = ((await confirm.textContent()) ?? '').toLowerCase()
  for (const word of ['defect', 'defective', 'planted', 'warranted', 'should']) {
    expect(spoken, `the refusal must not say "${word}"`).not.toContain(word)
  }

  // Nothing was filed, and the run is still the student's to work on.
  const refusedRun = await readJson<{ state: string }>(page.request, `/api/v1/runs/${runId}`)
  expect(refusedRun.state).toBe('working')

  // The refusal is on the record with the claim it named (10 §10).
  const refusal = onlyEvent(await traceOf(page, runId), 'lock_refused')
  expect(refusal.payload).toMatchObject({
    reason: 'unstanced_relied_on',
    claim_id: claim?.id,
    claim_text: claim?.text,
  })

  // "Go to the claim" takes the student to the card that answers it, and puts the focus in it.
  await confirm.getByRole('button', { name: 'Go to the claim' }).click()
  await expect(confirm).toBeHidden()
  await expect(page.locator(`[data-claim-id="${claim?.id ?? ''}"]`).first()).toBeFocused()

  // -------------------------------------------------------------------------------------------
  // The stance, then the lock with the figure the decision rests on (FR-080, FR-101, FR-102)
  // -------------------------------------------------------------------------------------------

  const stances = workCard.getByRole('radiogroup', { name: `Your stance on claim ${CLAIM_KEY}` })
  await stances.getByRole('radio', { name: 'Challenge' }).click()
  await expect(stances.getByRole('radio', { name: 'Challenge' })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  // FR-101: typing a claim's figure into a named numeric field is the student saying they leaned on
  // it. The field carries the author's own label and the unit it is entered in.
  const payback = editor.getByLabel('Premium payback you are betting on, in months')
  await expect(payback).toBeVisible()
  await payback.fill(PAYBACK_FIGURE)
  // FR-100: numbers only. A letter is not taken at all.
  await payback.fill('eleven')
  await expect(payback).toHaveValue(PAYBACK_FIGURE)

  await editor.getByRole('button', { name: 'Lock the decision' }).click()
  await expect(confirm).toContainText('File this decision?')
  await confirm.getByRole('button', { name: 'File it' }).click()

  // The lock moves the run and the workspace stops existing for it: the poll and the guard together
  // put the student on `/locked` (D-042).
  await page.waitForURL(new RegExp(`/runs/${runId}/locked$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Decision locked' })).toBeVisible()

  const locked = await readJson<{ state: string; clock: unknown; turn: { dueAt: string } | null }>(
    page.request,
    `/api/v1/runs/${runId}`,
  )
  expect(locked.state).toBe('decision_locked')
  // There is no working clock after the Decision Lock; the Turn's own is what the screen counts.
  expect(locked.clock).toBeNull()
  expect(locked.turn?.dueAt).toBeTruthy()

  // -------------------------------------------------------------------------------------------
  // What is on the locked page (UI-024)
  // -------------------------------------------------------------------------------------------

  const filedBrief = page.locator('#locked-brief')
  await expect(filedBrief).toContainText(BRIEF.recommendation)
  await expect(filedBrief).toContainText(BRIEF.changeMyMind)
  await expect(filedBrief).toContainText('62 of 100')
  // The figure is read back with the author's label rather than the database's key.
  await expect(filedBrief).toContainText('Premium payback you are betting on, in months')
  await expect(filedBrief).toContainText(PAYBACK_FIGURE)

  // The frozen frame, so the decision can be read beside the position it started from.
  await expect(page.locator('#locked-frame')).toContainText(FRAME.decision)

  // The Turn is what happens next, and the page says so and counts down to it.
  const turn = page.locator('#turn-wait')
  await expect(turn).toContainText('The Turn')
  await expect(turn.getByRole('timer', { name: 'Time until the Turn' })).toBeVisible()

  // Nothing on this page evaluates the decision or reports the instructor's own observation (D-298).
  const lockedText = ((await page.locator('main').textContent()) ?? '').toLowerCase()
  for (const word of ['speed', 'outlier', 'too fast', 'score', 'rank', 'percentile']) {
    expect(lockedText, `the locked page must not say "${word}"`).not.toContain(word)
  }

  // -------------------------------------------------------------------------------------------
  // The lock is irreversible (FR-102)
  // -------------------------------------------------------------------------------------------

  // The workspace is not a place a locked run can stand: asking for it lands back here.
  await page.goto(`/runs/${runId}/work`)
  await page.waitForURL(new RegExp(`/runs/${runId}/locked$`))

  // And the brief endpoint refuses, which is the rule rather than the screen's opinion of it.
  const edit = await page.request.put(`/api/v1/runs/${runId}/brief`, {
    data: { recommendation: 'Actually, move the budget upmarket.' },
    headers: WRITE_HEADERS,
  })
  expect(edit.status(), await edit.text()).toBe(409)

  // And what is on the page is still what was filed: the refusal changed nothing.
  await expect(page.locator('#locked-brief')).toContainText(BRIEF.recommendation)
  await expect(page.locator('#locked-brief')).not.toContainText('move the budget upmarket')

  // -------------------------------------------------------------------------------------------
  // The addendum: offered once, saved, and never part of the decision (FR-107)
  // -------------------------------------------------------------------------------------------

  const addendum = page.locator('#addendum')
  await addendum.getByRole('button', { name: 'Add an addendum' }).click()
  const addendumDialog = page.getByRole('dialog')
  await expect(addendumDialog).toContainText('Add an addendum')
  await addendumDialog.getByLabel('Your addendum').fill(ADDENDUM)
  await addendumDialog.getByRole('button', { name: 'Add it' }).click()
  await expect(addendumDialog).toBeHidden()

  await expect(addendum).toContainText(ADDENDUM)
  // One per run, and the control is gone rather than disabled beside the note it wrote.
  await expect(addendum.getByRole('button', { name: 'Add an addendum' })).toHaveCount(0)
  await expect(addendum).toContainText('One addendum per run, and this run has its one.')

  // It is its own event, apart from the decision, which the brief above still reads as it was filed.
  const afterAddendum = await traceOf(page, runId)
  expect(onlyEvent(afterAddendum, 'addendum').payload).toEqual({ text: ADDENDUM })
  const decisionEvent = onlyEvent(afterAddendum, 'decision_locked')
  expect(decisionEvent.payload).toMatchObject({
    recommendation: BRIEF.recommendation,
    auto: false,
    named_values: { premium_payback_months: 11 },
  })
  // The relied-on claim carries a stance by the time the lock lands, which is FR-084's whole point.
  expect(decisionEvent.payload.relied_on_claim_ids).toContain(claim?.id)
  expect(decisionEvent.payload.unstanced_relied_on_claim_ids).toEqual([])
  // D-298: the instructor's own observation is not in the student's copy of their own trace.
  expect(decisionEvent.payload).not.toHaveProperty('speed_outlier')

  // ===========================================================================================
  // Run two: the clock files a brief nobody wrote (FR-105, D-044, D-109)
  // ===========================================================================================

  const autoAssignment = await myAssignment(page, autoLock.label)
  const autoRunId = await reachWorking(page, autoAssignment.assignmentId)

  // The frame is locked and the brief is left exactly as it started: unwritten.
  await page.goto(`/runs/${autoRunId}/work`)
  await expect(page.locator('#brief-editor-panel')).toBeVisible()
  await expect(page.locator('#brief-editor-panel').getByLabel('Your recommendation')).toHaveValue(
    '',
  )

  // Past the working clock's end. Nothing here decides the expiry: the shift moves the run's own
  // timestamps and the next read materializes what the clock made true (D-042, D-109).
  await post(page, `/api/v1/test/runs/${autoRunId}/advance-clock`, { ms: 1_500_000 + 5_000 })

  const autoLocked = await readJson<{ state: string }>(page.request, `/api/v1/runs/${autoRunId}`)
  expect(autoLocked.state).toBe('decision_locked')

  await page.goto(`/runs/${autoRunId}/locked`)
  await expect(page.getByRole('heading', { level: 1, name: 'Decision locked' })).toBeVisible()

  // The screen reads the empty fields back as empty rather than hiding them: what was filed is what
  // the student has to be able to see.
  const autoBrief = page.locator('#locked-brief')
  await expect(autoBrief.getByText('Left empty.').first()).toBeVisible()
  await expect(autoBrief).toContainText('No figure.')
  // The frame the student did lock is still there, whole.
  await expect(page.locator('#locked-frame')).toContainText(FRAME.decision)

  // And the record says the same thing, which is the half of FR-105 that matters: an auto-lock files
  // the draft as it stands, empty fields and all, and marks itself as the clock's rather than the
  // student's.
  const autoEvent = onlyEvent(await traceOf(page, autoRunId), 'decision_locked')
  expect(autoEvent.payload).toMatchObject({
    auto: true,
    recommendation: '',
    rationale: '',
    change_my_mind: '',
    confidence: null,
  })
  expect(autoEvent.payload.assumptions).toEqual(['', '', ''])
  expect(autoEvent.payload.named_values).toEqual({})

  await signOut(page)
})
