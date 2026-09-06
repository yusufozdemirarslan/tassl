// Step 9 of the walkthrough (PRD §12): the Turn (FR-110 to FR-115, UI-024's countdown, UI-025).
//
// One run, driven to a filed decision through the documented endpoints — steps 2 to 8 are proved by
// their own specs and typing them again here would only make this one slower — and then taken
// through the Turn *on the screen*, which is what this step is about.
//
// Four things it proves, and they are the four the step names.
//
//   **The Turn arrives on its own clock, and the locked page opens it.** `advance-clock` (D-109 —
//   the only honest way to reach a timer without waiting for it) moves the run's timestamps past
//   `turn_due_at`, and nothing in the browser decides anything after that: the next server render
//   materializes the delivery, `/locked`'s guard sees `turn_open`, and the student is on `/turn`
//   without pressing anything (D-042).
//
//   **A window claim needs a stance before the response can be filed** (FR-111). The window
//   surfaces the Turn's own claims into the run, the response is refused while any of them is
//   unstanced, and the refusal names the claim in the words on its card (D-306's discipline, one
//   state along). Nothing is lost by it — `respondToTurn` reads the claims and rolls back — so the
//   justification is still in the box.
//
//   **The response is `revise`, with a justification and an updated confidence** (FR-112), and the
//   run moves to the defense the moment it lands.
//
//   **The frozen record is visible beside it** (UI-025): the frame locked before the assistant was
//   in the room, and the decision filed after it, neither of which can change from here.
//
// Two things this spec deliberately does not assert. Nothing about what the Turn *deserves* —
// `warrants_change` and `proportionate_response` are the instrument the response is measured
// against and no student payload carries either (D-336) — and nothing about which variant the run
// drew, which is the one thing about the scenario a student may not know before scoring.
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, seatEmail, signInAs, signOut, test } from '../fixtures'
import { createStudentAssignment, signInAsInstructor } from '../instructor/api'

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
const WRITE_HEADERS = { 'content-type': 'application/json', 'X-Requested-With': 'tassl' } as const

/** Past the longest Turn delay a run can draw (FR-110: 60 to 120 seconds after the lock). */
const PAST_THE_TURN_MS = 130_000

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

/** The decision this run files, every field inside FR-100's limits. */
const BRIEF = {
  recommendation:
    'Hold the premium share at its current level for one more quarter and re-run the payback with fulfillment costs in it.',
  rationale:
    'The payback figure the upmarket case rests on was computed before premium fulfillment was quoted, and nothing dated after the board deck confirms it.',
  assumptions: [
    'Value acquisition holds at its current blended cost.',
    'Roastery capacity absorbs current premium volume.',
    'No competitor repositions inside the quarter.',
  ],
  changeMyMind: 'A payback figure recomputed with fulfillment in it and dated later than the deck.',
  confidence: 62,
  namedValues: {},
} as const

/** FR-112's response: inside 150 words, with the confidence the student now holds. */
const JUSTIFICATION =
  'The retention number the payback was priced on has been corrected downward by the person who was quoting it, so the share I set on the old figure no longer follows from anything I can point at. I am moving the share down and keeping the direction.'
const CONFIDENCE_AFTER = '48'

type StudentAssignment = { assignmentId: string; label: string; latestRun: { id: string } | null }
type TraceEvent = { seq: number; type: string; payload: Record<string, unknown> }
type ClaimRow = { id: string; key: string; text: string; inTurnWindow: boolean }

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

async function myAssignment(page: Page, label: string): Promise<StudentAssignment> {
  const { items } = await readJson<{ items: StudentAssignment[] }>(
    page.request,
    '/api/v1/me/assignments',
  )
  const found = items.find((item) => item.label === label)
  expect(found, `no assignment "${label}"`).toBeDefined()
  return found as StudentAssignment
}

/** Steps 2 to 8 through the endpoints the screens call; returns the run, in `decision_locked`. */
async function reachLocked(page: Page, assignmentId: string): Promise<string> {
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
  await post(page, `/api/v1/runs/${runId}/lock`, BRIEF)

  const run = await readJson<{ state: string }>(page.request, `/api/v1/runs/${runId}`)
  expect(run.state, 'the run should be in `decision_locked`').toBe('decision_locked')
  return runId
}

test('walkthrough step 9: the Turn lands, a window claim needs a stance, and the response is filed', async ({
  page,
  request,
}) => {
  // A full run, a page build and a form typed on screen is past Playwright's default patience on a
  // loaded machine (D-188). The assertions are unchanged, only the wait.
  test.setTimeout(420_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Turn window',
    studentEmail: seatEmail('student1'),
    variant: 'defective',
  })

  await signInAs(page, 'student1')
  const mine = await myAssignment(page, assignment.label)
  const runId = await reachLocked(page, mine.assignmentId)

  // -------------------------------------------------------------------------------------------
  // UI-024: the wait, and the countdown that is a plain reading
  // -------------------------------------------------------------------------------------------

  await page.goto(`/runs/${runId}/locked`)
  await expect(page.getByRole('heading', { level: 1, name: 'Decision locked' })).toBeVisible()
  await expect(page.getByRole('timer', { name: 'Time until the Turn' })).toBeVisible()

  // -------------------------------------------------------------------------------------------
  // The Turn falls due, and the locked page opens it (FR-110, FR-115, D-042)
  // -------------------------------------------------------------------------------------------

  await post(page, `/api/v1/test/runs/${runId}/advance-clock`, { ms: PAST_THE_TURN_MS })

  await page.goto(`/runs/${runId}/locked`)
  await page.waitForURL(new RegExp(`/runs/${runId}/turn$`))
  await expect(page.getByRole('heading', { level: 1, name: 'The Turn' })).toBeVisible()

  const delivered = await readJson<{ state: string; turn: { windowEndsAt: string | null } | null }>(
    page.request,
    `/api/v1/runs/${runId}`,
  )
  expect(delivered.state).toBe('turn_open')
  expect(delivered.turn?.windowEndsAt).toBeTruthy()

  // -------------------------------------------------------------------------------------------
  // UI-025: the message in the world's voice, the window clock, and the frozen record beside
  // -------------------------------------------------------------------------------------------

  const message = page.locator('#turn-message')
  await expect(message).toContainText('Stakeholder message')
  await expect(message).toContainText('Ellery here.')
  await expect(message).toContainText('61 percent')

  // The window is a clock the student is under, so it is in the sticky band with the working
  // clock's own place and its own thresholds (D-346).
  await expect(page.getByRole('timer', { name: 'Turn window' })).toBeVisible()

  // The frozen pre-Turn record: the frame locked before the assistant was in the room, and the
  // decision filed after it.
  const frozen = page.locator('#turn-frozen')
  await expect(frozen).toContainText(FRAME.decision)
  await expect(frozen).toContainText(BRIEF.recommendation)
  await expect(frozen).toContainText('62 of 100')

  // -------------------------------------------------------------------------------------------
  // FR-111: a window claim with no stance refuses the response, and the refusal names it
  // -------------------------------------------------------------------------------------------

  const claims = await readJson<ClaimRow[]>(page.request, `/api/v1/runs/${runId}/claims`)
  const windowClaims = claims.filter((claim) => claim.inTurnWindow)
  expect(windowClaims.length, 'the Turn should have raised claims').toBeGreaterThan(0)

  const cards = page.locator('#turn-claims')
  for (const claim of windowClaims) {
    await expect(cards.getByRole('article', { name: `Claim ${claim.key}` })).toBeVisible()
  }

  // The delivery is on the record, and `window_claim_ids` is deliberately not in the student's own
  // copy of it: which claims the Turn lands on is the instrument the response is measured against
  // (FR-114, D-336). Read now, because the trace seals the moment the response locks (D-279).
  const events = await readJson<TraceEvent[]>(page.request, `/api/v1/runs/${runId}/trace`)
  const arrived = events.filter((event) => event.type === 'turn_delivered')
  expect(arrived).toHaveLength(1)
  expect(arrived[0]?.payload).toMatchObject({ voice: 'stakeholder_message' })
  expect(arrived[0]?.payload).not.toHaveProperty('window_claim_ids')

  // One of them gets a stance and one does not, so the refusal below is about a single claim and
  // can name it in the words the student read on its card.
  const stanced = windowClaims[0] as ClaimRow
  const unstanced = windowClaims[windowClaims.length - 1] as ClaimRow
  expect(stanced.id, 'the Turn should raise at least two claims').not.toBe(unstanced.id)

  const stancedCard = cards.getByRole('article', { name: `Claim ${stanced.key}` })
  await stancedCard
    .getByRole('radiogroup', { name: `Your stance on claim ${stanced.key}` })
    .getByRole('radio', { name: 'Verify' })
    .click()
  await expect(
    stancedCard.getByRole('radiogroup').getByRole('radio', { name: 'Verify' }),
  ).toHaveAttribute('aria-checked', 'true')

  const form = page.locator('#turn-response')
  await form.getByRole('radio', { name: 'Revise' }).click()
  await form.getByLabel('Why', { exact: true }).fill(JUSTIFICATION)
  // The counter is the server's count (D-075): the number under the box is the number
  // `wordLimit(150)` will refuse on.
  const words = JUSTIFICATION.trim().split(/\s+/).length
  await expect(form.getByText(`${String(words)} of 150 words`)).toBeVisible()
  await form.getByLabel('Confidence as a number').fill(CONFIDENCE_AFTER)
  await form.getByRole('button', { name: 'File the response' }).click()

  const refusal = form.locator('div[role="alert"]').first()
  await expect(refusal).toContainText('has no stance yet')
  await expect(refusal).toContainText(unstanced.text)
  // And not one word about what stance the claim deserves (FR-073).
  const spoken = ((await refusal.textContent()) ?? '').toLowerCase()
  for (const word of ['defect', 'planted', 'warranted', 'should', 'wrong']) {
    expect(spoken, `the refusal must not say "${word}"`).not.toContain(word)
  }

  // Nothing was filed, and what the student typed is still in the box (D-293).
  const refused = await readJson<{ state: string }>(page.request, `/api/v1/runs/${runId}`)
  expect(refused.state).toBe('turn_open')
  await expect(form.getByLabel('Why', { exact: true })).toHaveValue(JUSTIFICATION)

  // "Go to the claim" lands on the card that can answer it, and puts the focus in it.
  await refusal.getByRole('button', { name: 'Go to the claim' }).click()
  await expect(page.locator(`[data-claim-id="${unstanced.id}"]`).first()).toBeFocused()

  // -------------------------------------------------------------------------------------------
  // FR-112: the response is filed and the run moves on to the defense
  // -------------------------------------------------------------------------------------------

  const unstancedCard = cards.getByRole('article', { name: `Claim ${unstanced.key}` })
  await unstancedCard
    .getByRole('radiogroup', { name: `Your stance on claim ${unstanced.key}` })
    .getByRole('radio', { name: 'Challenge' })
    .click()
  await expect(
    unstancedCard.getByRole('radiogroup').getByRole('radio', { name: 'Challenge' }),
  ).toHaveAttribute('aria-checked', 'true')

  await form.getByRole('button', { name: 'File the response' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/defense$`))
  await expect(page.getByRole('heading', { level: 1, name: 'The defense' })).toBeVisible()

  // What was filed is read back on the defense's artifacts panel, in the student's own words
  // (UI-026, D-341): the category, the justification and the confidence they now hold.
  const artifacts = page.locator('#defense-artifacts')
  await expect(artifacts).toContainText('Revise')
  await expect(artifacts).toContainText(JUSTIFICATION)
  await expect(artifacts).toContainText(`${CONFIDENCE_AFTER} of 100`)

  // The window is closed for good, and the record is sealed while the defense is open: a student
  // answering from memory does not get their own trace back to read from (D-279).
  const closed = await page.request.get(`/api/v1/runs/${runId}/turn`)
  expect(closed.status(), await closed.text()).toBe(409)
  const sealed = await page.request.get(`/api/v1/runs/${runId}/trace`)
  expect(sealed.status(), await sealed.text()).toBe(403)

  await signOut(page)
})
