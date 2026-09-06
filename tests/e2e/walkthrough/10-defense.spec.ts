// Step 10 of the walkthrough (PRD §12): the defense (FR-120 to FR-126, UI-026, UI-027's pending
// state).
//
// One run, driven to the Turn response through the documented endpoints — step 9 is proved on the
// screen by its own spec — and then taken through the interview *on the screen*, which is what this
// step is about.
//
// Five things it proves, and they are the five the step names.
//
//   **Six to nine typed questions, selected from the run's own record** (FR-121), including the
//   provenance question about the payback figure — the claim the Turn window put in front of this
//   student and the one their decision was priced on.
//
//   **An answer from memory with no source earns the follow-up** (FR-123, D-031). The rule is
//   deterministic and it is three tests anyone can run on their own answer: no number, no run of two
//   words from a document's title, no reason marker. The answer below is written to fail all three,
//   which is what an honest "I remember reading it" looks like.
//
//   **The artifacts are there and the room is not.** The frame, the decision, the Turn response —
//   the student's own work — and no assistant, no Evidence Room, and no route to either. The trace
//   is sealed at the API for the same reason (D-279), so this is not a screen hiding a door.
//
//   **Finishing names the unanswered count first** (UI-026), files the remainder empty, and hands
//   the run to scoring.
//
//   **UI-027 then says the run is being scored**, and says nothing else: no composite, no rank, no
//   percentile, no queue position and no estimate (FR-140, CLAUDE.md).
//
// What this spec deliberately does not assert: anything about whether an answer was *good*. Nothing
// on this screen evaluates one, `nothing_answered` is an instructor flag the student never sees
// (FR-125, 12 §8.1), and the expected-answer notes behind every question are the faculty seat's.
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, seatEmail, signInAs, signOut, test } from '../fixtures'
import { createStudentAssignment, signInAsInstructor } from '../instructor/api'

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
const WRITE_HEADERS = { 'content-type': 'application/json', 'X-Requested-With': 'tassl' } as const

/** Past the longest Turn delay a run can draw (FR-110: 60 to 120 seconds after the lock). */
const PAST_THE_TURN_MS = 130_000

/** FR-121: six to nine questions, and the fill takes it to six when the conditions find fewer. */
const MIN_QUESTIONS = 6
const MAX_QUESTIONS = 9

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

const TURN_RESPONSE = {
  response: 'revise',
  justification:
    'The retention number the payback was priced on has been corrected by the person who was quoting it, so the share I set on the old figure no longer follows from anything I can point at.',
  confidence: 48,
} as const

/**
 * The answer that earns the follow-up (D-031), and the reason each of the three tests fails.
 *
 * No digit anywhere in it. No run of two consecutive words that also appears in a document's title —
 * the room's titles are "Premium Tier Positioning Review (February 2025 board deck)", "Quarterly
 * acquisition cohort table" and seven more, and nothing below shares two consecutive words with any
 * of them. And none of `because`, `since`, `so that`, `given`, `as the`. It is what answering from
 * memory actually sounds like, which is exactly the case FR-123 exists to press on.
 */
const FROM_MEMORY =
  'I went with what I remembered reading earlier and did not write down where it came from.'

type StudentAssignment = { assignmentId: string; label: string; latestRun: { id: string } | null }
type ClaimRow = { id: string; key: string; inTurnWindow: boolean }
type DefenseQuestionRow = { runQuestionId: string; seq: number; text: string; answered: boolean }

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

/** Steps 2 to 9 through the endpoints the screens call; returns the run, in `defense_pending`. */
async function reachDefense(page: Page, assignmentId: string): Promise<string> {
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

  // The Turn falls due on the run's own clock; the shift is the only honest way to reach it (D-109).
  await post(page, `/api/v1/test/runs/${runId}/advance-clock`, { ms: PAST_THE_TURN_MS })

  // FR-111: every claim the window raised needs a stance before the response can lock.
  const claims = await readJson<ClaimRow[]>(page.request, `/api/v1/runs/${runId}/claims`)
  const windowClaims = claims.filter((claim) => claim.inTurnWindow)
  expect(windowClaims.length, 'the Turn should have raised claims').toBeGreaterThan(0)
  for (const claim of windowClaims) {
    const stanced = await page.request.put(`/api/v1/runs/${runId}/claims/${claim.id}/stance`, {
      data: { stance: 'verify' },
      headers: WRITE_HEADERS,
    })
    expect(stanced.status(), await stanced.text()).toBe(200)
  }

  await post(page, `/api/v1/runs/${runId}/turn/response`, TURN_RESPONSE)

  const run = await readJson<{ state: string }>(page.request, `/api/v1/runs/${runId}`)
  expect(run.state, 'the run should be in `defense_pending`').toBe('defense_pending')
  return runId
}

test('walkthrough step 10: the defense asks from the run record, presses an unsourced answer, and hands the run to scoring', async ({
  page,
  request,
}) => {
  // A full run driven to the defense plus an interview typed on screen is past Playwright's default
  // patience on a loaded machine (D-188). The assertions are unchanged, only the wait.
  test.setTimeout(420_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Defense',
    studentEmail: seatEmail('student1'),
    variant: 'defective',
  })

  await signInAs(page, 'student1')
  const mine = await myAssignment(page, assignment.label)
  const runId = await reachDefense(page, mine.assignmentId)

  // -------------------------------------------------------------------------------------------
  // UI-026: the interview, selected from the run's own record (FR-121, FR-122)
  // -------------------------------------------------------------------------------------------

  await page.goto(`/runs/${runId}/defense`)
  await expect(page.getByRole('heading', { level: 1, name: 'The defense' })).toBeVisible()

  const defense = await readJson<{ questions: DefenseQuestionRow[] }>(
    page.request,
    `/api/v1/runs/${runId}/defense`,
  )
  expect(defense.questions.length).toBeGreaterThanOrEqual(MIN_QUESTIONS)
  expect(defense.questions.length).toBeLessThanOrEqual(MAX_QUESTIONS)

  const questions = page.locator('#defense-questions')
  for (const question of defense.questions) {
    await expect(questions).toContainText(question.text)
  }

  // The provenance question about the figure the decision was priced on: the claim the window put
  // in front of this student, quoted back with the author's own question after it (FR-122).
  await expect(questions).toContainText('Where did the payback figure come from')

  // One box, on the first question without an answer (FR-126).
  await expect(questions.getByRole('textbox')).toHaveCount(1)

  // -------------------------------------------------------------------------------------------
  // FR-120: no assistant, no Evidence Room, and no route to either
  // -------------------------------------------------------------------------------------------

  await expect(page.locator('#assistant-panel')).toHaveCount(0)
  await expect(page.locator('#evidence-room')).toHaveCount(0)
  await expect(page.locator('#delegation-log')).toHaveCount(0)
  const room = ((await page.locator('main').textContent()) ?? '').toLowerCase()
  for (const word of ['ask the assistant', 'open the scenario', 'delegation log']) {
    expect(room, `the defense must not offer "${word}"`).not.toContain(word)
  }
  // And the record is sealed at the API too, so there is no second tab that hands the room back.
  const sealed = await page.request.get(`/api/v1/runs/${runId}/trace`)
  expect(sealed.status(), await sealed.text()).toBe(403)

  // -------------------------------------------------------------------------------------------
  // UI-026: the artifacts, which are the student's own work and nothing else
  // -------------------------------------------------------------------------------------------

  const artifacts = page.locator('#defense-artifacts')
  await expect(artifacts).toContainText(FRAME.decision)
  await expect(artifacts).toContainText(BRIEF.recommendation)
  await expect(artifacts).toContainText('Revise')
  await expect(artifacts).toContainText(TURN_RESPONSE.justification)
  await expect(artifacts).toContainText('48 of 100')

  // Nothing on this screen evaluates anything the student did (12 §8.1, CLAUDE.md).
  const spoken = ((await page.locator('main').textContent()) ?? '').toLowerCase()
  for (const word of ['defect', 'planted', 'warranted', 'score', 'rank', 'percentile', 'outlier']) {
    expect(spoken, `the defense must not say "${word}"`).not.toContain(word)
  }

  // -------------------------------------------------------------------------------------------
  // FR-123: an answer from memory, with no source, no number and no reason, earns the follow-up
  // -------------------------------------------------------------------------------------------

  const first = defense.questions[0] as DefenseQuestionRow
  await questions.getByLabel('Your answer').fill(FROM_MEMORY)
  await questions.getByRole('button', { name: 'Submit answer' }).click()

  // The label above the follow-up, exactly: the announcer's sentence carries the word too, and the
  // question itself is the heading (DESIGN.md §The Descending-Heading Rule).
  await expect(questions.getByText('Follow-up', { exact: true })).toBeVisible()
  await expect(questions).toContainText(FROM_MEMORY)

  // The follow-up sits beneath the question that earned it, not at the end of the running order
  // (D-344) — and nothing on the screen says which rule asked for it.
  const answered = await readJson<{
    questions: (DefenseQuestionRow & { followUpOf: string | null })[]
  }>(page.request, `/api/v1/runs/${runId}/defense`)
  const followUp = answered.questions.find((question) => question.followUpOf !== null)
  expect(followUp, 'the answer should have earned a follow-up').toBeDefined()
  expect(followUp?.followUpOf).toBe(first.runQuestionId)

  // -------------------------------------------------------------------------------------------
  // UI-026: finishing names the unanswered count, then files the remainder empty
  // -------------------------------------------------------------------------------------------

  await questions.getByRole('button', { name: 'Finish the defense' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Finish the defense?')
  await expect(confirm).toContainText('count as no answer')
  await confirm.getByRole('button', { name: 'Finish it' }).click()

  // -------------------------------------------------------------------------------------------
  // UI-027: the run is being scored, and that is the whole of what the student is told (FR-140)
  // -------------------------------------------------------------------------------------------

  await page.waitForURL(new RegExp(`/runs/${runId}$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Run status' })).toBeVisible()
  await expect(page.locator('#run-status')).toContainText('Your run is being scored')

  const scored = await readJson<{ state: string; scoringStatus: string }>(
    page.request,
    `/api/v1/runs/${runId}`,
  )
  expect(scored.state).toBe('defense_complete')
  expect(['queued', 'running', 'done', 'held']).toContain(scored.scoringStatus)

  // No number of any kind: no composite, no rank, no percentile, no queue position, no estimate.
  const status = ((await page.locator('main').textContent()) ?? '').toLowerCase()
  for (const word of ['rank', 'percentile', 'points', 'band', 'position in', 'minutes']) {
    expect(status, `the status page must not say "${word}"`).not.toContain(word)
  }

  await signOut(page)
})
