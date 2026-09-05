// Steps 2 to 5 of the walkthrough (PRD §12 "The walkthrough"), taken in the student seat, in the
// order the student meets them and with nothing done for them behind the screen.
//
//   2. Run start — the policy display: the outside-AI policy, the run's weight, the band-to-points
//      mapping, and the statement that this run counts (FR-201, UI-021).
//   3. Readiness Check — sixteen items in eight minutes, closing on a concept map that names ideas
//      in plain language with no score and no rank (FR-010 to FR-018, UI-022).
//   4. Brief and Evidence Room — the brief and the nine dated, attributed documents of the seeded
//      Meridian Roast package, with an open and a close recorded and the assistant still locked
//      (FR-020 to FR-024, FR-117, UI-023).
//   5. Frame — an incomplete frame refused, the word limits enforced, and the lock irreversible:
//      afterwards the run is in `working`, the editing controls are gone, and the frame cannot be
//      locked a second time (FR-040 to FR-043).
//
// **It runs on the seeded package version, on the defective variant, through an assignment of its
// own.** The package is the seeded Meridian Roast one (06 §5 item 4) — its brief, its nine
// documents and its sixteen readiness items are what the walkthrough is defined on, and nothing
// below would mean anything against a stand-in. The *assignment* is this spec's: an instructor
// makes a course, a section, an enrolment for `student1` and an assignment on that version before
// the student signs in (`createStudentAssignment` in ../instructor/api.ts), all named through
// `suiteName` so `tests/e2e/global-setup.ts` finds them again.
//
// It ran on the seeded walkthrough assignment ("Decision Run 1 (walkthrough)", 06 §5 item 5) until
// Step 6.5's review, and that made it a spec that only passed once. D-041 allows one run per
// student per assignment until it is voided, so the three browser projects collided with each other
// inside one run of the suite, and a second `pnpm test:e2e` against the same database met the
// attempt the first had left. Nothing in the product could take that attempt back out:
// `deleteWalkthroughRun` (D-104), the Delete control on UI-032, is the one thing meant to remove a
// run, and the database refused it — migration 0005 declared every run child table (`run_events`,
// `run_document_opens`, `run_readiness_answers`, `run_readiness_results`, `run_frames`) `ON DELETE
// no action`, so `DELETE FROM runs` raised 23503 for any run that had done anything at all.
// Migration `0012_run_delete_cascade` (D-255) closed that: every child of a run now cascades, and
// the product's own delete works on a run that has been taken. This spec does not depend on it
// either way — its run is on a row the suite owns, and `purgeRuns` in
// `tests/e2e/global-setup.ts` deletes the children in dependency order before the run, at the start
// of every suite and again in the teardown. That purge can now be reduced to its `runs` delete, or
// replaced by `deleteWalkthroughRun` in an `afterEach`, whenever this suite is next opened.
//
// Three sources of truth are kept apart on purpose:
//
//   * what the **course** says — read through the instructor's own endpoints, so "the policy
//     display shows the course's real values" is checked against the course rather than against the
//     student endpoint that draws the screen;
//   * what the **screen** shows — read through the browser, as a student sees it;
//   * what the **trace** recorded — read through `GET /runs/{runId}/trace`, which is the record the
//     graphs, the bands and the debrief are all built from, and which is asserted here both for the
//     events this phase writes and for the two fields a student's own view withholds (`correct` on
//     a readiness item, `skim` on a document close).
//
// Nothing here shows the student anything they may not see: no assertion reads a warranted stance,
// an evidence status, a failure family, a planted flag or a verification result, and the one place
// the variant is named is an instructor-side read that proves *which* run is being taken.
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, seatEmail, signInAs, signOut, test } from '../fixtures'
import { createStudentAssignment, signInAsInstructor } from '../instructor/api'

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
const WRITE_HEADERS = { 'content-type': 'application/json', 'X-Requested-With': 'tassl' } as const

/** The title UI-021 shows for each course policy (`run.policyOpen` and its two siblings). */
const POLICY_TITLES: Record<string, string> = {
  open: 'You may use any AI tool',
  declared: 'Declare what you use outside Tassl',
  in_environment_only: 'Work with the assistant inside Tassl',
}

/** The four bands in the order the mapping table lists them, under the names the courses use. */
const BANDS = [
  ['novice', 'Novice'],
  ['developing', 'Developing'],
  ['proficient', 'Proficient'],
  ['professional', 'Professional'],
] as const

/** `PolicyDisplay` formats every number with this; the assertions read the same string. */
const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/** `EvidenceRoom` formats a calendar date in UTC (D-177); the assertion reads the same string. */
const DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

// The frame this run locks. Every field is inside FR-040's limit, and the decision is distinctive
// enough that finding it again after the lock proves the panel is reading the frame that was typed.
const DECISION =
  'Hold premium acquisition at its current share this quarter and fund one recheck of the premium payback figure before committing more.'
const ASSUMPTIONS = [
  'The premium payback figure in the board deck has not been revised since it was published.',
  'Value tier acquisition keeps performing at the rate the last two quarters recorded.',
  'Roastery capacity can absorb the current premium volume without new equipment.',
] as const
const POSITION =
  'I lean towards holding the split until the payback number is checked. Moving budget upmarket on a figure nobody has confirmed this quarter would put most of the acquisition budget behind an assumption rather than behind evidence, and the cost of waiting one recheck is small next to the cost of being wrong about the premium tier.'
const CONFIDENCE = '62'

/** `n` distinct words, so `countWords` sees exactly `n` and nothing collapses into one. */
const words = (n: number): string =>
  Array.from({ length: n }, (_, index) => `word${String(index)}`).join(' ')

// ---------------------------------------------------------------------------------------------
// Reads
//
// The student's reads go through `page.request`, which shares the browser's cookie jar and is
// therefore the same session the screens are using. The instructor's go through the `request`
// fixture, which has a jar of its own — so signing an instructor in for the course values and for
// the cleanup never disturbs the student session the test is driving.
// ---------------------------------------------------------------------------------------------

type StudentAssignment = {
  assignmentId: string
  label: string
  courseId: string
  latestRun: { id: string } | null
}
type TraceEvent = { seq: number; type: string; payload: Record<string, unknown> }

async function readJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path)
  expect(response.status(), `GET ${path}: ${await response.text()}`).toBe(200)
  return (await response.json()) as T
}

/** The run's trace as its own student reads it (`GET /runs/{runId}/trace`, FR-007). */
async function traceOf(page: Page, runId: string): Promise<TraceEvent[]> {
  return readJson<TraceEvent[]>(page.request, `/api/v1/runs/${runId}/trace`)
}

/**
 * The student's own assignment row, by the label the instructor gave it — which is also the proof
 * that the enrolment took: `/me/assignments` is keyed by the seat's own section memberships, so an
 * assignment that appears here is one this seat is a student on (10 §3 `listMyAssignments`).
 *
 * The row is asserted to carry no attempt. On a freshly created assignment that cannot be otherwise,
 * which is exactly the point: it is the invariant the old spec could not hold, stated where a
 * regression to a shared assignment would break it rather than merely make the run flaky.
 */
async function myAssignment(page: Page, label: string): Promise<StudentAssignment> {
  const { items } = await readJson<{ items: StudentAssignment[] }>(
    page.request,
    '/api/v1/me/assignments',
  )
  const found = items.find((item) => item.label === label)
  expect(
    found,
    `no assignment "${label}" among ${JSON.stringify(items.map((item) => item.label))}`,
  ).toBeDefined()
  expect(found?.latestRun, `"${label}" already carries an attempt`).toBeNull()
  return found as StudentAssignment
}

test('walkthrough steps 2 to 5: policy display, Readiness Check, Evidence Room, frame lock', async ({
  page,
  request,
}) => {
  // Steps 2 to 5 are one continuous run: they cannot be split into four tests without starting four
  // runs, three of which would only be reaching the state the fourth needed anyway. Sixteen
  // answered items and nine documents make this long rather than slow (the patience of D-188).
  test.setTimeout(240_000)

  // The course this run is taken in, built by an instructor before the student arrives: the seeded
  // package version, the defective variant, and `student1` enrolled on the section. Everything here
  // is proven by the instructor specs of Phase 4; it is setup, not subject.
  await signInAsInstructor(request)
  const { label } = await createStudentAssignment(request, {
    what: 'Walkthrough',
    studentEmail: seatEmail('student1'),
    variant: 'defective',
  })

  await signInAs(page, 'student1')
  const assignment = await myAssignment(page, label)

  // The course and the assignment as their instructor holds them. This is the "real values" the
  // policy display is checked against — reading the student endpoint that draws the screen would
  // prove only that the screen agrees with itself.
  const course = await readJson<{
    outsideAiPolicy: string
    mapping: Record<string, number>
    defaultRunWeight: number
  }>(request, `/api/v1/courses/${assignment.courseId}`)
  const configured = await readJson<{
    runType: string
    variantKey: string
    effectiveWeight: number
    effectiveWorkingClockSeconds: number
  }>(request, `/api/v1/assignments/${assignment.assignmentId}`)

  // The walkthrough's own condition: this run is on the defective variant (PRD §12, 06 §5 item 5).
  // It is read here, on the instructor's side, and asserted nowhere the student can see — which is
  // the whole reason for reading it here rather than from anything the run answers.
  expect(configured.variantKey).toBe('defective')

  // -------------------------------------------------------------------------------------------
  // Step 2 — Run start: the policy display (FR-201, UI-021)
  // -------------------------------------------------------------------------------------------

  await page.goto('/runs')
  await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()

  const assignmentRow = page.getByRole('row').filter({ hasText: label })
  await expect(assignmentRow).toBeVisible()
  await assignmentRow.getByRole('button', { name: `Start ${label}` }).click()

  // Start is a write, and where it lands is the new run's own `links.next` — so the address the
  // browser reaches is where the run id is read from, rather than one this spec composed.
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}\/start$/)
  const runId = new URL(page.url()).pathname.split('/')[2] as string

  await expect(page.getByRole('heading', { level: 1, name: 'Before you begin' })).toBeVisible()

  // The statement that this run counts, as an h2: the one thing on this screen that must not read
  // as small print (09 §UI-021).
  await expect(
    page.getByRole('heading', {
      level: 2,
      name: 'This run counts toward the course grade. Run one counts.',
    }),
  ).toBeVisible()

  const counts = page.locator('#run-counts')
  await expect(counts).toContainText('Decision Run')
  await expect(counts).toContainText(
    `${NUMBER.format(configured.effectiveWeight)} percent of the course grade`,
  )
  expect(configured.effectiveWeight).toBe(course.defaultRunWeight)

  // The course's outside-AI policy, said to the student in the second person, with the no-penalty
  // sentence beside it (FR-201, PRD §7.6).
  const policy = page.locator('#run-policy')
  await expect(policy).toContainText(POLICY_TITLES[course.outsideAiPolicy] as string)
  await expect(policy).toContainText('A declaration never lowers a band or a point.')
  await expect(policy).toContainText('nothing it records is treated as misconduct')

  // The band-to-points mapping, row by row, against the course's own numbers.
  const mapping = page.locator('#run-mapping')
  for (const [key, label] of BANDS) {
    await expect(mapping.getByRole('row').filter({ hasText: label })).toContainText(
      NUMBER.format(course.mapping[key] as number),
    )
  }
  await expect(mapping).toContainText('There is no total score, no rank, and no percentile')

  // The working clock's length, from the assignment's effective value, and the uncalibrated label
  // the build carries wherever a difficulty figure would otherwise appear (PRD §12).
  const clockSeconds = configured.effectiveWorkingClockSeconds
  const minutes = Math.floor(clockSeconds / 60)
  const seconds = clockSeconds % 60
  const clockLength =
    seconds === 0
      ? `${String(minutes)} minutes`
      : `${String(minutes)} minutes ${String(seconds)} seconds`
  const clockPanel = page.locator('#run-clock-length')
  await expect(clockPanel).toContainText(clockLength)
  await expect(clockPanel).toContainText('The clock starts when you lock your frame, not now.')
  await expect(clockPanel).toContainText('Uncalibrated')

  await expect(page.locator('#run-begin')).toContainText(
    'Sixteen short questions with an eight-minute limit.',
  )
  await page.getByRole('button', { name: 'Begin the Readiness Check' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/readiness$`))

  // What the acknowledgement recorded is what the screen showed, and both came from the course
  // (10 §6): the same function answers the display and stamps the event.
  const afterAck = await traceOf(page, runId)
  const displayed = afterAck.find((event) => event.type === 'policy_displayed')
  expect(displayed, 'no policy_displayed event in the trace').toBeDefined()
  expect(displayed?.payload).toMatchObject({
    outside_ai_policy: course.outsideAiPolicy,
    weight: configured.effectiveWeight,
    mapping: course.mapping,
    run_type: configured.runType,
    counts_statement: true,
  })

  // -------------------------------------------------------------------------------------------
  // Step 3 — the Readiness Check: sixteen items, eight minutes, a concept map with no score
  // -------------------------------------------------------------------------------------------

  await expect(page.getByRole('heading', { level: 1, name: 'Readiness Check' })).toBeVisible()

  // The clock counts down to an instant the server set, and the browser only displays it (D-042).
  // Eight minutes therefore reads as 08:00, or a second or two under it.
  await expect(page.getByRole('timer', { name: 'Readiness Check clock' })).toHaveText(
    /^0[78]:[0-5][0-9]$/,
  )

  const navigator = page.getByRole('toolbar', { name: 'Items' })
  await expect(navigator.getByRole('button')).toHaveCount(16)
  await expect(page.getByText('0 of 16 answered')).toBeVisible()

  // Sixteen items, answered in order. Which option is chosen is deliberately arbitrary — this spec
  // does not know which key is right and must not: correctness is computed server-side and no
  // response carries it (FR-012).
  for (let position = 1; position <= 16; position += 1) {
    await expect(page.getByText(`Item ${String(position)} of 16`)).toBeVisible()
    const options = page.getByRole('radiogroup').getByRole('radio')
    await expect(options).toHaveCount(4)
    await options.first().click()
    await expect(
      navigator.getByRole('button', { name: `Item ${String(position)}, answered` }),
    ).toBeVisible()
    if (position < 16) await page.getByRole('button', { name: 'Next item' }).click()
  }

  // The screen says how many items have an answer, which is progress through a form. It says
  // nothing about how many are right, because nothing on this screen knows (FR-012).
  await expect(page.getByText('16 of 16 answered')).toBeVisible()
  expect(await page.locator('#readiness-item').innerText()).not.toMatch(
    /\b(correct|incorrect|right|wrong|score|marks?)\b/i,
  )
  expect(await page.locator('#readiness-progress').innerText()).not.toMatch(
    /\b(correct|incorrect|score|rank)\b/i,
  )

  await page.getByRole('button', { name: 'Submit the check' }).click()
  const submitConfirm = page.getByRole('alertdialog')
  await expect(submitConfirm).toContainText('Submit the Readiness Check?')
  await expect(submitConfirm).toContainText('Every item has an answer.')
  await submitConfirm.getByRole('button', { name: 'Submit', exact: true }).click()

  await page.waitForURL(new RegExp(`/runs/${runId}/readiness/result$`))
  await expect(page.getByRole('heading', { level: 1, name: 'What the check read' })).toBeVisible()
  await expect(
    page.getByText('There is no score here, no total and no comparison with anyone else'),
  ).toBeVisible()

  // The concept map: one sentence per idea the check asked about, and no row that adds them up.
  const conceptPanel = page.locator('#readiness-concepts')
  const conceptRows = conceptPanel.getByRole('listitem')
  expect(await conceptRows.count()).toBeGreaterThanOrEqual(6)
  for (const row of await conceptRows.allInnerTexts()) {
    expect(row.trim()).toMatch(
      /^(You showed a working grasp of .+\.|.+ looks thin\.|We could not tell about .+\.)$/,
    )
  }

  // No score, no total, no percentage, no rank — put as the absence of any number at all in the one
  // panel a student most expects a mark in (FR-012, PRD §7.1, CLAUDE.md).
  const conceptText = await conceptPanel.innerText()
  expect(conceptText).not.toMatch(/[0-9]/)
  expect(conceptText).not.toMatch(/\b(score|rank|percentile|percent|out of|correct)\b/i)

  // Sixteen items in the trace, each carrying the key the student chose — and none carrying whether
  // it was right: `correct` is withheld from the owner's own view until the run is scored
  // (`trace/owner-view.ts`, D-117).
  const afterCheck = await traceOf(page, runId)
  const answered = afterCheck.filter((event) => event.type === 'readiness_item')
  expect(answered).toHaveLength(16)
  for (const event of answered) {
    expect(typeof event.payload.answer_key).toBe('string')
    expect(event.payload).not.toHaveProperty('correct')
  }

  // Standard Mode, which is what every run in the build opens in (PRD §7.1).
  const framing = await readJson<{ state: string; mode: string }>(
    page.request,
    `/api/v1/runs/${runId}`,
  )
  expect(framing.state).toBe('framing')
  expect(framing.mode).toBe('standard')
  expect(framing).not.toHaveProperty('variantKey')

  // -------------------------------------------------------------------------------------------
  // Step 4 — the Scenario Brief and the Evidence Room (FR-020 to FR-024, FR-117)
  // -------------------------------------------------------------------------------------------

  await page.getByRole('link', { name: 'Open the scenario' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/work$`))
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()
  await expect(
    page.getByText('The working clock starts when you lock your frame, so reading now costs you'),
  ).toBeVisible()

  const workspace = await readJson<{
    brief: { text: string }
    documents: { id: string; title: string; author: string; datedOn: string }[]
  }>(page.request, `/api/v1/runs/${runId}/workspace`)

  // FR-020: a brief of at most 200 words. FR-021: six to twelve documents — nine, in this package.
  const briefWords = workspace.brief.text.trim().split(/\s+/).filter(Boolean)
  expect(briefWords.length).toBeGreaterThan(0)
  expect(briefWords.length).toBeLessThanOrEqual(200)
  expect(workspace.documents).toHaveLength(9)
  expect(workspace).not.toHaveProperty('variantKey')

  await expect(page.locator('#scenario-brief')).toContainText(
    (workspace.brief.text.split('\n')[0] ?? '').trim(),
  )

  // Every document is in the room, dated and attributed, and nothing else is said about any of them
  // (FR-023: no hints, no highlighting, no recommended order, no summary).
  const room = page.locator('#evidence-room')
  await expect(room.getByRole('list', { name: 'Documents in the Evidence Room' })).toBeVisible()
  await expect(room.getByRole('listitem')).toHaveCount(9)
  for (const document of workspace.documents) {
    await expect(room.getByRole('heading', { level: 3, name: document.title })).toBeVisible()
    await expect(room).toContainText(document.author)
    await expect(room).toContainText(DATE.format(new Date(document.datedOn)))
  }

  // One document opened and closed from the screen. The open is what returns the body, so a reading
  // that happened and a reading that was recorded are the same event (10 §6).
  const opened = workspace.documents[0] as { id: string; title: string }
  await room.getByRole('button', { name: `Open ${opened.title}` }).click()
  const reader = page.getByRole('article', { name: opened.title })
  await expect(reader).toBeVisible()
  expect((await reader.innerText()).length).toBeGreaterThan(200)

  await room.getByRole('button', { name: `Close ${opened.title}` }).click()
  await expect(reader).toHaveCount(0)

  // The close goes through a Server Action the screen does not wait on, so the trace is polled for
  // it rather than read once.
  await expect
    .poll(
      async () =>
        (await traceOf(page, runId)).filter((event) => event.type === 'document_close').length,
    )
    .toBe(1)

  const afterReading = await traceOf(page, runId)
  const open = afterReading.find((event) => event.type === 'document_open')
  const close = afterReading.find((event) => event.type === 'document_close')
  expect(open?.payload).toMatchObject({
    document_id: opened.id,
    // FR-022: the assistant has not been used, so this reading is before the first delegation.
    before_first_delegation: true,
  })
  expect(close?.payload).toMatchObject({
    document_id: opened.id,
    open_id: open?.payload.open_id,
    before_first_delegation: true,
  })
  expect(typeof close?.payload.duration_ms).toBe('number')
  expect(close?.payload.duration_ms as number).toBeGreaterThanOrEqual(0)
  // D-082: how a reading was read is an input to a band, and the student is not told it mid-run.
  expect(close?.payload).not.toHaveProperty('skim')
  // The order is the trace's own: the open precedes the close that ended it.
  expect((open?.seq ?? 0) < (close?.seq ?? 0)).toBe(true)

  // A second document, left open on purpose: FR-117 says the frame lock closes a reading the
  // student never ended, and the lock below is where that is proven.
  const leftOpen = workspace.documents[1] as { id: string; title: string }
  await room.getByRole('button', { name: `Open ${leftOpen.title}` }).click()
  await expect(page.getByRole('article', { name: leftOpen.title })).toBeVisible()

  // FR-020: the assistant stays locked for the whole of the framing period.
  await expect(page.locator('#assistant-panel')).toContainText(
    'The assistant unlocks the moment you lock your frame.',
  )

  // -------------------------------------------------------------------------------------------
  // Step 5 — the frame: refused while incomplete, then locked irreversibly (FR-040 to FR-043)
  // -------------------------------------------------------------------------------------------

  const lockButton = page.getByRole('button', { name: 'Lock the frame' })
  const decisionBox = page.getByLabel('The decision')

  // An incomplete frame is refused, and every empty field is named rather than the first one: the
  // decision, the three assumptions and the position (FR-040). The lock is irreversible, so a frame
  // that breaks a rule must not reach the confirmation at all — the refused submit moves focus to
  // the first field at fault, which is what makes "no dialog" an assertion about a finished submit
  // rather than about a race with one.
  await lockButton.click()
  await expect(page.getByText('This is part of the frame. Write something in it.')).toHaveCount(5)
  await expect(decisionBox).toBeFocused()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  // The word limits, counted live on the same count the server refuses on (D-075).
  await decisionBox.fill(words(51))
  await expect(page.getByText('51 of 50 words')).toBeVisible()
  await expect(
    page.getByText('This is over the limit. Cut it back to 50 words to lock the frame.'),
  ).toBeVisible()
  await lockButton.click()
  await expect(decisionBox).toBeFocused()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  await decisionBox.fill(DECISION)
  for (const [index, assumption] of ASSUMPTIONS.entries()) {
    await page.getByLabel(`Assumption ${String(index + 1)}`).fill(assumption)
  }
  await page.getByLabel('Your position now').fill(POSITION)
  await page.getByRole('spinbutton', { name: 'Confidence as a number' }).fill(CONFIDENCE)
  // The slider and the number are one value, not two that agree most of the time.
  await expect(page.getByRole('slider', { name: 'Confidence, 0 to 100' })).toHaveValue(CONFIDENCE)
  await expect(
    page.getByText('This is over the limit. Cut it back to 50 words to lock the frame.'),
  ).toHaveCount(0)

  await lockButton.click()
  const lockConfirm = page.getByRole('alertdialog')
  await expect(lockConfirm).toContainText('Lock the frame permanently?')
  await expect(lockConfirm).toContainText(
    'A locked frame is never edited, replaced, or restored — not by you, and not by your instructor.',
  )
  await lockConfirm.getByRole('button', { name: 'Lock it' }).click()

  // The run is in `working`: the frame reads back where the form stood, the working clock is
  // running in the band, and the assistant is unlocked without a word about the frame (FR-041).
  const lockedFrame = page.locator('#locked-frame')
  await expect(lockedFrame).toContainText(DECISION)
  await expect(lockedFrame).toContainText(`${CONFIDENCE} of 100`)
  for (const assumption of ASSUMPTIONS) await expect(lockedFrame).toContainText(assumption)
  await expect(page.locator('[data-state="working"]')).toBeVisible()
  await expect(page.getByRole('timer', { name: 'Working clock' })).toHaveText(
    /^[0-9]{2}:[0-5][0-9]$/,
  )
  await expect(page.locator('#assistant-panel')).toContainText(
    'Your frame is locked, so the assistant is unlocked.',
  )

  // The editing controls are gone, and they stay gone on a fresh load of the same address (FR-043).
  await expect(lockButton).toHaveCount(0)
  await expect(decisionBox).toHaveCount(0)
  await page.reload()
  await expect(page.locator('#locked-frame')).toContainText(DECISION)
  await expect(page.getByRole('button', { name: 'Lock the frame' })).toHaveCount(0)
  await expect(page.getByLabel('The decision')).toHaveCount(0)

  // And the server refuses a second lock, which is the half of "irreversible" that a missing button
  // cannot prove.
  const secondLock = await page.request.post(`/api/v1/runs/${runId}/frame`, {
    data: {
      decision: 'A different decision, filed after the frame was already locked.',
      assumptions: ['One.', 'Two.', 'Three.'],
      position: 'A different position.',
      confidence: 10,
    },
    headers: WRITE_HEADERS,
  })
  expect(secondLock.status(), await secondLock.text()).toBe(409)
  expect(((await secondLock.json()) as { error: { code: string } }).error.code).toBe(
    'ILLEGAL_TRANSITION',
  )

  const working = await readJson<{ state: string; clock: { remainingMs: number } | null }>(
    page.request,
    `/api/v1/runs/${runId}`,
  )
  expect(working.state).toBe('working')
  expect(working.clock).not.toBeNull()

  // The frame the trace holds is the frame that was typed, exactly once; and the reading the
  // student never ended was closed by the lock (FR-117).
  const finalTrace = await traceOf(page, runId)
  const locked = finalTrace.filter((event) => event.type === 'frame_locked')
  expect(locked).toHaveLength(1)
  expect(locked[0]?.payload).toMatchObject({
    decision: DECISION,
    assumptions: [...ASSUMPTIONS],
    position: POSITION,
    confidence: Number(CONFIDENCE),
  })
  const closes = finalTrace.filter((event) => event.type === 'document_close')
  expect(closes.map((event) => event.payload.document_id)).toContain(leftOpen.id)

  await signOut(page)
})
