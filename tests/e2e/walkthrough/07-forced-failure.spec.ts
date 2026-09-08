// Step 7 of the walkthrough (PRD §12): the forced failure (FR-118, FR-001, UI-023's paused state).
//
// The instructor arms one assistant failure on a live run, the student's next delegation meets it,
// and what happens next is the standing rule of FR-001 rather than an error screen: the run pauses,
// the clock stops, an overlay says so, and Resume gives the time back.
//
// Four things this proves, and each is a product rule rather than a screen behaviour.
//
//   * **The control is the faculty seat's and nobody else's** (FR-118, 12 §4 A04). It is armed
//     through `POST /review/runs/{runId}/test-controls/force-assistant-failure` by the section's
//     instructor. The student's own attempt at the same endpoint is refused, and the spec asserts
//     that too — a test control a student can reach is a way to stop their own clock.
//   * **The student is never told a control did it.** The overlay says a component did not answer;
//     it does not name a test control, an instructor, a provider or a delegation, and the
//     assertions below pin that its text is the same four sentences a genuine outage would produce.
//   * **The pause is modal and the clock is stopped.** Nothing behind the overlay can be used,
//     because nothing behind it would answer; `GET /runs/{runId}` reports the run in `paused` with
//     `clock.paused` true.
//   * **Resume gives the time back** (FR-001). The pause's wall-clock span goes into
//     `total_paused_ms` and comes straight out of the clock's arithmetic, and the failed
//     component's own cost is credited on top of that — which for a delegation is zero, because a
//     delegation charges no clock at all (10 §7). So `clock_credited_ms` is 0 and that is the
//     correct number; what proves the rule is the reading itself, which has dropped by less than
//     the pause lasted.
//
// **The control's own UI is Phase 11's** (the step says so): until the faculty replay lands, the
// control is exercised through the endpoint, which is what a reviewer's screen will call.
//
// The run reaches `working` through the documented endpoints, as the sibling specs do, because the
// working period is proven in `06-working-period.spec.ts` and repeating it here would only make this
// spec slower and give it a second reason to fail.
import type { APIRequestContext, Page } from '@playwright/test'
import { axe, expect, seatEmail, signInAs, signOut, test } from '../fixtures'
import { addSectionMember, createStudentAssignment, signInAsInstructor } from '../instructor/api'

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
const WRITE_HEADERS = { 'content-type': 'application/json', 'X-Requested-With': 'tassl' } as const

/** The request the armed failure meets. Its wording is immaterial: nothing answers it. */
const REQUEST = 'What is the premium payback?'

/** How long the outage is left standing, so the span it took is bigger than the reads around it. */
const PAUSE_MS = 4_000

/** Two HTTP reads and a click, on a loaded machine: the noise the span assertion allows for. */
const CLOCK_SLACK_MS = 2_000

/** The frame this run locks, inside FR-040's limits; setup rather than subject. */
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

type StudentAssignment = { assignmentId: string; label: string; latestRun: { id: string } | null }
type RunView = {
  state: string
  clock: { remainingMs: number; paused: boolean; creditedMs: number; chargedMs: number } | null
}
type TraceEvent = { seq: number; type: string; payload: Record<string, unknown> }

async function readJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path)
  expect(response.status(), `GET ${path}: ${await response.text()}`).toBe(200)
  return (await response.json()) as T
}

/** A documented write, checked: a setup step that half-failed must not be discovered ten lines on. */
async function post<T>(page: Page, path: string, data: unknown = {}, expected = 200): Promise<T> {
  const response = await page.request.post(path, { data, headers: WRITE_HEADERS })
  expect(response.status(), `POST ${path}: ${await response.text()}`).toBe(expected)
  return (await response.json().catch(() => null)) as T
}

/** The student's own assignment row, by the label the instructor gave it, carrying no attempt yet. */
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

  const run = await readJson<RunView>(page.request, `/api/v1/runs/${runId}`)
  expect(run.state, 'the run should be in `working` before the failure is armed').toBe('working')
  return runId
}

test('walkthrough step 7: an armed assistant failure pauses the run, and Resume gives the time back', async ({
  page,
  request,
}) => {
  // Sixteen answered items, a full page build and a paused delegation put this past Playwright's
  // default; the assertions are unchanged, only the patience (D-188).
  test.setTimeout(240_000)

  await signInAsInstructor(request)
  const { section, label } = await createStudentAssignment(request, {
    what: 'Forced failure',
    studentEmail: seatEmail('student2'),
    variant: 'defective',
  })
  await addSectionMember(request, section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  await signInAs(page, 'student2')
  const assignment = await myAssignment(page, label)
  const runId = await reachWorking(page, assignment.assignmentId)

  const control = `/api/v1/review/runs/${runId}/test-controls/force-assistant-failure`

  // -------------------------------------------------------------------------------------------
  // The control is the instructor's (FR-118, 08 §5)
  // -------------------------------------------------------------------------------------------

  // The student holds every in-run capability on their own run and this is not one of them: a seat
  // that could arm a failure could stop its own clock whenever it liked.
  const refused = await page.request.post(control, { data: {}, headers: WRITE_HEADERS })
  expect(refused.status(), await refused.text()).toBe(403)

  const armed = await request.post(control, { data: {}, headers: WRITE_HEADERS })
  expect(armed.status(), await armed.text()).toBe(200)
  expect(await armed.json()).toEqual({ armed: true })

  // Arming writes nothing to the run: what the run records is the outage, not the arming (10 §6).
  const beforeFailure = await readJson<TraceEvent[]>(page.request, `/api/v1/runs/${runId}/trace`)
  expect(beforeFailure.some((event) => event.type === 'pause')).toBe(false)

  // The reading, and the wall clock it was taken at: the two together are what let the assertion
  // after the resume separate the time the student spent from the time the outage took.
  const wallBefore = Date.now()
  const beforePause = await readJson<RunView>(page.request, `/api/v1/runs/${runId}`)
  expect(beforePause.state).toBe('working')
  expect(beforePause.clock?.paused).toBe(false)

  // -------------------------------------------------------------------------------------------
  // The student delegates, and meets it (FR-001, UI-023's paused state)
  // -------------------------------------------------------------------------------------------

  await page.goto(`/runs/${runId}/work`)
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()

  const assistant = page.locator('#assistant-panel')
  await assistant.getByLabel('Your request').fill(REQUEST)
  // The live character count is the panel's own state, so waiting for it is the proof that React
  // owns the field this browser is about to submit: a click that lands ahead of hydration is a
  // native form post carrying a value the form never saw (the trap D-182 found in WebKit).
  await expect(assistant.getByText(`${String(REQUEST.length)} of 2000 characters`)).toBeVisible()
  await assistant.getByRole('button', { name: 'Ask the assistant' }).click()

  // The overlay is an alert dialog, and it is not dismissible: a student cannot dismiss their way
  // back into a run that is not running.
  const overlay = page.getByRole('alertdialog')
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText('The run is paused')
  await expect(overlay).toContainText('The assistant did not answer.')
  await expect(overlay).toContainText(
    'Your clock stopped when it happened, and the time this pause takes is given back to you when you resume. Nothing you have done is lost.',
  )

  // Nothing in it names a test control, an instructor, a provider or a delegation: the student is
  // never told a control did this, and there is nothing here they could act on if they were.
  const spoken = ((await overlay.textContent()) ?? '').toLowerCase()
  for (const word of ['test control', 'instructor', 'forced', 'provider', 'delegation']) {
    expect(spoken, `the paused overlay must not say "${word}"`).not.toContain(word)
  }

  // UI-023's paused state, scanned (16 §8.2, B14). This is the only place in the suite the overlay
  // is on screen — it takes an armed failure to reach — and it is a modal `alertdialog` that makes
  // the workspace behind it `inert`, which is exactly the shape an axe scan is for.
  await axe(page)

  // The run is paused on the server and the clock is stopped there, which is the fact the overlay
  // is drawn from rather than a state this browser is holding.
  const paused = await readJson<RunView>(page.request, `/api/v1/runs/${runId}`)
  expect(paused.state).toBe('paused')
  expect(paused.clock?.paused).toBe(true)

  const pausedTrace = await readJson<TraceEvent[]>(page.request, `/api/v1/runs/${runId}/trace`)
  const pauseEvent = pausedTrace.filter((event) => event.type === 'pause')
  expect(pauseEvent).toHaveLength(1)
  expect(pauseEvent[0]?.payload).toMatchObject({ cause: 'assistant_failure' })

  // -------------------------------------------------------------------------------------------
  // Resume: the clock comes back, and the time it lost comes back with it (FR-001)
  // -------------------------------------------------------------------------------------------

  // A measurable outage. The clock records milliseconds and the assertion below is about a span, so
  // the pause is left standing long enough that the span is bigger than the noise in two HTTP reads
  // — which is what a real outage looks like and what a sub-second one would not prove.
  await page.waitForTimeout(PAUSE_MS)

  await overlay.getByRole('button', { name: 'Resume the run' }).click()
  await expect(overlay).toBeHidden()

  // The workspace is usable again: the request box is back and the clock is running.
  await expect(assistant.getByLabel('Your request')).toBeVisible()

  const resumed = await readJson<RunView>(page.request, `/api/v1/runs/${runId}`)
  const wallAfter = Date.now()
  expect(resumed.state).toBe('working')
  expect(resumed.clock?.paused).toBe(false)

  const resumedTrace = await readJson<TraceEvent[]>(page.request, `/api/v1/runs/${runId}/trace`)
  const resumeEvent = resumedTrace.filter((event) => event.type === 'resume')
  expect(resumeEvent).toHaveLength(1)
  expect(resumeEvent[0]?.payload.pause_id).toBe(pauseEvent[0]?.payload.pause_id)
  expect(resumeEvent[0]?.seq).toBeGreaterThan(pauseEvent[0]?.seq ?? 0)

  // The pause took real time, and the event says how much.
  const pausedMs = resumeEvent[0]?.payload.paused_ms as number
  expect(pausedMs).toBeGreaterThan(0)

  // **And that time was not taken from the student.** The clock is not "credited" for a delegation
  // — `clock_credited_ms` is the *failed component's own cost*, and a delegation charges no clock at
  // all (10 §7), so it is zero and rightly so. What the pause gave back is the wall-clock span,
  // which goes into `total_paused_ms` and is subtracted from the clock's arithmetic: the reading
  // after the resume has therefore dropped by less than the pause lasted, which is the only way to
  // see FR-001 from outside.
  expect(resumeEvent[0]?.payload.clock_credited_ms).toBe(0)
  expect(resumed.clock?.creditedMs).toBe(0)
  expect(resumed.clock?.chargedMs).toBe(0)

  expect(pausedMs).toBeGreaterThanOrEqual(PAUSE_MS)
  const spent = (beforePause.clock?.remainingMs ?? 0) - (resumed.clock?.remainingMs ?? 0)
  const wall = wallAfter - wallBefore
  expect(
    spent,
    'the working clock must move by the time outside the pause, not by the wall clock',
  ).toBeLessThan(wall - pausedMs + CLOCK_SLACK_MS)

  // One failure, armed once: the flag is consumed, so the next request is answered.
  await assistant.getByLabel('Your request').fill(REQUEST)
  // The live character count is the panel's own state, so waiting for it is the proof that React
  // owns the field this browser is about to submit: a click that lands ahead of hydration is a
  // native form post carrying a value the form never saw (the trap D-182 found in WebKit).
  await expect(assistant.getByText(`${String(REQUEST.length)} of 2000 characters`)).toBeVisible()
  await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
  await expect(assistant.locator('#assistant-reply-status')).toContainText('Reply complete')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)

  await signOut(page)
})
