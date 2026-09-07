// Step 11 of the walkthrough (PRD §12), part 1: **scoring**. The debrief itself is UI-028 and lands
// in Phase 11; what this spec proves is everything that has to be true before there can be one.
//
// It picks the run up exactly where `10-defense.spec.ts` puts it down — a finished defense, a run in
// `defense_complete`, and a status screen that says the run is being scored — and follows it through
// to `scored`.
//
// Four things, and they are the four the step names.
//
//   **The run reaches `scored`, and it does it inside NFR-001's mock budget.** The measurement is
//   the run's own two server timestamps, `defenseCompletedAt` and `scoredAt`, not the browser's
//   clock: the target is how long Tassl takes to score a run, and a Playwright process on a loaded
//   Windows box is not part of that. The poll around it has a twenty-second ceiling so a run that is
//   *held* fails with a sentence rather than by hanging (FR-140).
//
//   **The student is told nothing while it happens.** The payload they are handed at the instant
//   scoring starts — the answer to `POST /defense/complete` — carries no band, no points, no rank
//   and no percentile at any depth, and their own trace is still sealed (D-279). This is the
//   deterministic half: it is read at the one moment the state cannot have moved yet, because it is
//   the answer to the request that moved it.
//
//   **What they see afterwards carries nothing that is the reviewer's.** The seven draft bands are
//   in the student's own trace once the run is scored (D-117), and every one of them arrives without
//   `quotes` and without `evidence_event_seqs` — and the sweep is table-driven off `owner-view.ts`,
//   so a field classified `reviewer_only` later is caught here without anybody remembering this
//   file. The same run read by an instructor of the section *does* carry them, which is what keeps
//   the assertion from passing on a run with nothing to hide.
//
//   **Both notifications go out** (SYS-010, FR-130): one to the student, one to every reviewer of
//   the section, and neither says anything about a band or a point.
//
// What this spec deliberately does not assert: any band, any point, and any graph. Which bands this
// run earns is `tests/unit/scoring/bands.test.ts` and `evals/scoring`, where the fixtures are fixed
// and the placement is the subject; asserting one here would make an end-to-end spec fail whenever
// the rubric moved, and would say nothing about whether the run reached scoring at all.
//
// **The run is assistant-free**, and that is a property worth naming rather than a shortcut: with no
// delegation in the log, the Delegation read falls back to the defense answers and the band is
// marked `defense_only` (D-406, FR-064). It is the path the pipeline is least often walked down and
// the one no fixture in the unit suite exercises through a real HTTP request. It also keeps the run
// clear of D-026's ten delegations a minute, which three browser projects on one seat share.
import type { APIRequestContext, APIResponse, Page } from '@playwright/test'
import { expect, seatEmail, signInAs, signOut, test, type Seat } from '../fixtures'
import { addSectionMember, createStudentAssignment, signInAsInstructor } from '../instructor/api'
import { findForbiddenKeys } from '@/server/auth/student-view'
import { fieldPolicyFor } from '@/server/modules/trace/owner-view'
import { RUN_EVENT_TYPES } from '@/server/modules/trace/schema'

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
const WRITE_HEADERS = { 'content-type': 'application/json', 'X-Requested-With': 'tassl' } as const

/**
 * The seat this run is taken in, and it is deliberately not `student1`.
 *
 * D-026 puts the `write` bucket at sixty requests a minute **per user**, and a run driven through
 * the endpoints rather than the screen spends about fourteen of them in a few seconds: the start,
 * the acknowledgement, the readiness submit, the two locks, the clock shift, the Turn response, one
 * per defense answer, and the completion. The nineteen other places in this suite that sign in as
 * `student1` spend theirs slowly, because they are driving a browser between writes; these two specs
 * would spend a third of that seat's minute in a burst, three times over, and take the walkthrough
 * specs down with them. `editor` is a seeded institution member (06 §5) that nothing else in the
 * suite signs in as, so the burst lands in a budget of its own — and a scenario author enrolled as a
 * student on a section is a real arrangement rather than a fiction, which is why the seat is used as
 * it is rather than a sixth one invented for the lane.
 */
const STUDENT_SEAT: Seat = 'editor'

/** Past the longest Turn delay a run can draw (FR-110: 60 to 120 seconds after the lock). */
const PAST_THE_TURN_MS = 130_000

/** NFR-001: five seconds from a finished defense to a scored run, on the mock provider. */
const SCORING_BUDGET_MS = 5_000

/** The ceiling on the poll. Far past the budget: a run that misses it has gone wrong, not slow. */
const SCORING_TIMEOUT_MS = 20_000

/** The seven dimensions of PRD Appendix A, in the order `rubric/index.ts` declares them. */
const DIMENSIONS = [
  'framing',
  'delegation',
  'verification',
  'calibration',
  'decision_quality',
  'adaptation',
  'ownership',
] as const

/** The four bands, by the names the courses and the rubric use. */
const BAND_NAMES = ['novice', 'developing', 'proficient', 'professional'] as const

/**
 * Key names that may not appear at any depth in a payload the student is handed about their run,
 * before scoring or after it (FR-131, FR-140, CLAUDE.md).
 *
 * Matched as whole key names rather than as substrings, because `scoringStatus` is a legitimate
 * field whose name contains one of them and a substring test would report it as a leak.
 */
const NEVER_IN_A_STUDENT_RUN_PAYLOAD = [
  'band',
  'bands',
  'points',
  'pointsDraft',
  'points_draft',
  'score',
  'scores',
  'rank',
  'percentile',
  'graphs',
  'falseChallengeRate',
  'false_challenge_rate',
]

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
 * Three answers, cycled through the interview.
 *
 * Each one carries a digit and a reason marker, so none of them earns the authored follow-up
 * (FR-123, D-031) and the interview stays the six to nine questions it was drawn as. None is a
 * substring of the filed brief, so none earns D-090's follow-up either. Whether an answer is *good*
 * is not a thing this spec asserts and not a thing this screen decides — what they are here for is
 * to be the material the Ownership and Delegation reads are run over, which on an assistant-free
 * run is the only material there is (D-406).
 */
const ANSWERS = [
  'I priced this on the payback figure of 11 months because it is the only number in front of me that speaks to the premium tier at all, and I said in the brief that it wanted rechecking.',
  'I did not settle it, because the 1 document that would have dated the figure after the board deck is not in the room, so I filed the decision that survives either answer.',
  'I moved my confidence down to 48 because the person who quoted the retention number corrected it, and the share I had set was priced on the old one.',
] as const

type StudentAssignment = { assignmentId: string; label: string; latestRun: { id: string } | null }
type ClaimRow = { id: string; key: string; inTurnWindow: boolean }
type DefenseQuestionRow = { runQuestionId: string; seq: number; text: string; answered: boolean }
type TraceEvent = {
  seq: number
  type: string
  occurredAt: string
  clockRemainingMs: number | null
  actorId: string | null
  payload: Record<string, unknown>
}
type RunView = {
  id: string
  state: string
  scoringStatus: string
  timestamps: { defenseCompletedAt: string | null; scoredAt: string | null }
  links: { next: string }
}
type NotificationRow = {
  id: string
  type: string
  title: string
  body: string
  link: string | null
}

async function readJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path)
  expect(response.status(), `GET ${path}: ${await response.text()}`).toBe(200)
  return (await response.json()) as T
}

/** At most this many refusals are waited out before a 429 is reported as the failure it is. */
const RATE_LIMIT_WAITS = 4

/**
 * One documented write, checked — and waited out when the limiter refuses it.
 *
 * The seat above keeps this burst out of `student1`'s minute; three browser projects still share
 * `editor`'s. Six runs of fourteen writes against a budget of sixty a minute (D-026) is over it,
 * and the overage is a fact about a lane where one seat takes the same run three times at once
 * rather than a defect in the product — the limiter is proven on its own in
 * `tests/integration/rate-limit`. So a refusal is waited out rather than failed on, exactly as
 * `signIn` in ../fixtures.ts waits out Better Auth's: the answer carries `retryAfterSeconds`, the
 * wait is bounded, and a lane under contention degrades to slow instead of red. Every other status
 * is this spec's own failure and is raised where it happened.
 */
async function write(
  page: Page,
  method: 'post' | 'put',
  path: string,
  data: unknown,
  expected: number,
): Promise<APIResponse> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await page.request[method](path, { data, headers: WRITE_HEADERS })
    if (response.status() !== 429 || attempt >= RATE_LIMIT_WAITS) {
      expect(response.status(), `${method.toUpperCase()} ${path}: ${await response.text()}`).toBe(
        expected,
      )
      return response
    }
    const refusal = (await response.json().catch(() => null)) as {
      error?: { details?: { retryAfterSeconds?: number } }
    } | null
    const seconds = Math.min(Math.max(refusal?.error?.details?.retryAfterSeconds ?? 5, 1), 60)
    await page.waitForTimeout(seconds * 1000 + 500)
  }
}

async function post<T>(page: Page, path: string, data: unknown = {}, expected = 200): Promise<T> {
  const response = await write(page, 'post', path, data, expected)
  return (await response.json().catch(() => null)) as T
}

async function put(page: Page, path: string, data: unknown, expected = 200): Promise<void> {
  await write(page, 'put', path, data, expected)
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

/**
 * The payload fields `owner-view.ts` withholds from the run's own student in any state, **by event
 * type**.
 *
 * Per type and not as one flat set of names, because the same word is a different field in two
 * payloads: `probe_fired.claim_id` is the reviewer's and `stance_set.claim_id` is the student's own
 * act. That is the collision `owner-view.ts` exists to resolve, and a sweep that flattened the table
 * would report the resolution as a leak. Reading the table rather than restating it is what makes a
 * field classified `reviewer_only` next year fail here without anyone editing this file.
 */
const REVIEWER_ONLY_BY_TYPE = new Map(
  RUN_EVENT_TYPES.map((type) => [
    String(type),
    new Set(
      Object.entries(fieldPolicyFor(type) ?? {})
        .filter(([, visibility]) => visibility === 'reviewer_only')
        .map(([key]) => key),
    ),
  ]),
)

/** `type.field` for every reviewer-only field an event stream actually carries. */
function reviewerOnlyFieldsIn(events: readonly TraceEvent[]): string[] {
  return events.flatMap((event) => {
    const forbidden = REVIEWER_ONLY_BY_TYPE.get(event.type) ?? new Set<string>()
    return Object.keys(event.payload)
      .filter((key) => forbidden.has(key))
      .map((key) => `${event.type}.${key}`)
  })
}

/** Every key name in a JSON value, at any depth, with the path it was found at. */
function keysAtAnyDepth(value: unknown, path = ''): { key: string; path: string }[] {
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => keysAtAnyDepth(entry, `${path}[${String(index)}]`))
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const at = path === '' ? key : `${path}.${key}`
    return [{ key, path: at }, ...keysAtAnyDepth(child, at)]
  })
}

/**
 * The assertion that a payload about a run says nothing about how the run was assessed.
 *
 * `findForbiddenKeys` is the codebase's own list (12 §8.1, §8.2) and runs first, so a leak of the
 * answer key is reported in the words `student-view.ts` uses for it; the band and points names are
 * added on top, because FR-131's "no total, no rank, no percentile" is not a key set that file owns.
 */
function saysNothingAboutTheAssessment(payload: unknown, what: string, scored: boolean): void {
  expect(
    findForbiddenKeys(payload, { scored }),
    `${what} carries a field a student may not see`,
  ).toEqual([])
  const found = keysAtAnyDepth(payload).filter((entry) =>
    NEVER_IN_A_STUDENT_RUN_PAYLOAD.includes(entry.key),
  )
  expect(found, `${what} names the assessment`).toEqual([])
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
    await put(
      page,
      `/api/v1/runs/${runId}/readiness/answers/${item.id}`,
      { answerKey: item.options[0]?.key },
      204,
    )
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
    await put(page, `/api/v1/runs/${runId}/claims/${claim.id}/stance`, { stance: 'verify' })
  }

  await post(page, `/api/v1/runs/${runId}/turn/response`, TURN_RESPONSE)

  const run = await readJson<{ state: string }>(page.request, `/api/v1/runs/${runId}`)
  expect(run.state, 'the run should be in `defense_pending`').toBe('defense_pending')
  return runId
}

/**
 * The interview, answered to the last question.
 *
 * `GET /defense` is the read that opens (FR-126), so the first call is what draws the questions. The
 * loop runs twice at most: an answer can earn one follow-up and a follow-up never earns another
 * (FR-123), so a pass that answers everything outstanding leaves at most the follow-ups it caused.
 */
async function answerEveryQuestion(page: Page, runId: string): Promise<number> {
  let answered = 0
  for (let pass = 0; pass < 3; pass += 1) {
    const defense = await readJson<{ questions: DefenseQuestionRow[] }>(
      page.request,
      `/api/v1/runs/${runId}/defense`,
    )
    const outstanding = defense.questions.filter((question) => !question.answered)
    if (outstanding.length === 0) return answered
    for (const question of outstanding) {
      await post(page, `/api/v1/runs/${runId}/defense/questions/${question.runQuestionId}/answer`, {
        text: ANSWERS[answered % ANSWERS.length],
        durationMs: 45_000,
      })
      answered += 1
    }
  }
  throw new Error('the defense still had unanswered questions after three passes')
}

test('walkthrough step 11: the finished defense becomes a scored run inside the mock budget, and the student is told nothing about how', async ({
  page,
  request,
}) => {
  // A full run driven to a finished defense is past Playwright's default patience on a loaded
  // machine (D-188). The assertions are unchanged, only the wait.
  test.setTimeout(420_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Scoring',
    studentEmail: seatEmail(STUDENT_SEAT),
    variant: 'defective',
  })
  // The instructor is put on the section as well as the student, for two reasons this spec needs
  // and one it does not: the reviewer's read of the same trace is what makes "nothing
  // reviewer-only" an assertion about a projection rather than about an empty vocabulary
  // (`requireRunReviewer` wants a section membership, 08 §5), and FR-130 sends the section's
  // reviewers a notification that has to land somewhere.
  await addSectionMember(request, assignment.section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  await signInAs(page, STUDENT_SEAT)
  const mine = await myAssignment(page, assignment.label)
  const runId = await reachDefense(page, mine.assignmentId)
  const questionCount = await answerEveryQuestion(page, runId)
  expect(questionCount, 'FR-121: six to nine questions').toBeGreaterThanOrEqual(6)

  // -------------------------------------------------------------------------------------------
  // Before the defense is filed: nothing has been assessed, and the record is sealed (D-279)
  // -------------------------------------------------------------------------------------------

  const beforeCompleting = await readJson<RunView>(page.request, `/api/v1/runs/${runId}`)
  expect(beforeCompleting.state).toBe('defense_pending')
  expect(beforeCompleting.scoringStatus).toBe('idle')
  saysNothingAboutTheAssessment(beforeCompleting, 'the run before its defense is filed', false)

  const sealed = await page.request.get(`/api/v1/runs/${runId}/trace`)
  expect(sealed.status(), await sealed.text()).toBe(403)

  // -------------------------------------------------------------------------------------------
  // The defense is filed, and the run is handed to scoring (FR-120, FR-130, D-046)
  //
  // This answer is the one payload in the run's life that cannot be racing the scoring job: it is
  // the answer to the request that started it, built inside the transaction that moved the run.
  // So it is where "the student sees no band and no points while the run is being scored" is
  // asserted, rather than on a later read that may arrive after the job has already finished.
  // -------------------------------------------------------------------------------------------

  const filed = await post<RunView>(page, `/api/v1/runs/${runId}/defense/complete`)
  expect(filed.state).toBe('defense_complete')
  expect(filed.scoringStatus, 'the run is queued for scoring by its own completion').toBe('queued')
  saysNothingAboutTheAssessment(filed, 'the run at the instant scoring begins', false)

  // -------------------------------------------------------------------------------------------
  // UI-027: what the student is looking at while it happens, and what it becomes (FR-140)
  //
  // The E2E server drains the queue in the `after()` of the request that enqueued the job, so the
  // run may already be scored by the time this page renders. Which of UI-027's sentences is on
  // screen is therefore not a thing to assert; that it is one of the three this run can reach, and
  // that none of them carries a number, is.
  // -------------------------------------------------------------------------------------------

  await page.goto(`/runs/${runId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Run status' })).toBeVisible()

  const status = page.locator('#run-status')
  await expect(
    status.getByRole('heading', { level: 2 }),
    'UI-027 says one of three sentences to a run between the defense and the debrief',
  ).toHaveText(/^(Your run is being scored|Your defense is in|Your debrief is ready)$/)

  // No number of any kind, in either sentence: no composite, no rank, no percentile, no queue
  // position, no estimate of how long scoring will take (FR-131, FR-140, CLAUDE.md).
  const scoringText = (await status.textContent()) ?? ''
  expect(scoringText, 'the status panel must carry no number').not.toMatch(/[0-9]/)
  for (const word of [...BAND_NAMES, 'rank', 'percentile', 'points']) {
    expect(scoringText.toLowerCase(), `the status panel must not say "${word}"`).not.toContain(word)
  }

  // The page moves itself: the poll in the run band watches `scoringStatus` and refreshes the
  // server render when it changes, so nobody has to reload to find out (UI-027).
  await expect(
    status.getByRole('heading', { level: 2, name: 'Your debrief is ready' }),
  ).toBeVisible({ timeout: SCORING_TIMEOUT_MS })

  // -------------------------------------------------------------------------------------------
  // NFR-001: from a finished defense to a scored run in under five seconds on the mock
  //
  // Measured on the run's own two server timestamps rather than on the browser's clock. What the
  // requirement bounds is how long Tassl takes to score a run; how long Playwright took to ask is
  // not part of it, and on a machine running three browser projects it would be most of it.
  // -------------------------------------------------------------------------------------------

  await expect
    .poll(
      async () => {
        const run = await readJson<RunView>(page.request, `/api/v1/runs/${runId}`)
        return `${run.state}/${run.scoringStatus}`
      },
      {
        timeout: SCORING_TIMEOUT_MS,
        message:
          'the finished defense hands the run to scoring (FR-130); `defense_complete/held` means a band read did not come back',
      },
    )
    .toBe('scored/done')

  const scored = await readJson<RunView>(page.request, `/api/v1/runs/${runId}`)
  const completedAt = Date.parse(scored.timestamps.defenseCompletedAt ?? '')
  const scoredAt = Date.parse(scored.timestamps.scoredAt ?? '')
  expect(Number.isFinite(completedAt) && Number.isFinite(scoredAt)).toBe(true)
  expect(scoredAt).toBeGreaterThanOrEqual(completedAt)
  expect(
    scoredAt - completedAt,
    `NFR-001: scoring a run on the mock provider takes under ${String(SCORING_BUDGET_MS)} ms`,
  ).toBeLessThan(SCORING_BUDGET_MS)
  // The number itself, on the report rather than only in a failure message: NFR-001 is a budget,
  // and a budget nobody can read the current spend of is one that is discovered at the ceiling.
  test.info().annotations.push({
    type: 'NFR-001',
    description: `${String(scoredAt - completedAt)} ms from defense_complete to scored`,
  })

  // The scored run is still not a payload that says how it went: the debrief is where a band is
  // read, and the run row says only that there is one to read.
  saysNothingAboutTheAssessment(scored, 'the scored run', true)
  expect(scored.links.next, 'a scored run points at its debrief (UI-028)').toBe(
    `/runs/${runId}/debrief`,
  )

  // -------------------------------------------------------------------------------------------
  // What the student may now read of their own run (D-117), and what stays the reviewer's
  // -------------------------------------------------------------------------------------------

  const ownTrace = await readJson<TraceEvent[]>(page.request, `/api/v1/runs/${runId}/trace`)
  const drafted = ownTrace.filter((event) => event.type === 'draft_band')

  // Seven draft bands, one per dimension, written by the job that scored the run (FR-130 to
  // FR-137). Which band each one carries is the unit suite's subject and not this spec's; that
  // there are seven and that each names its dimension is what says the pipeline ran to the end.
  expect(drafted).toHaveLength(DIMENSIONS.length)
  expect(drafted.map((event) => event.payload.dimension).sort()).toEqual([...DIMENSIONS].sort())
  for (const event of drafted) {
    expect(Object.keys(event.payload).sort()).toEqual([
      'band',
      'basis',
      'dimension',
      'graph_keys',
      'provisional',
      'rationale',
      'reason',
      'status',
    ])
  }

  // Nothing anywhere in the student's copy of their own trace is a field `owner-view.ts` marks the
  // reviewer's — including the two on a draft band: the sequence numbers the dense renumbering
  // exists to hide (FR-053), and the quotes the debrief will project without them (FR-151).
  expect(reviewerOnlyFieldsIn(ownTrace)).toEqual([])

  // And the same run, read by an instructor of its section, does carry them. Without this the
  // assertion above would pass just as well on a scoring job that recorded no evidence at all.
  const reviewerTrace = await readJson<TraceEvent[]>(request, `/api/v1/runs/${runId}/trace`)
  const reviewerBands = reviewerTrace.filter((event) => event.type === 'draft_band')
  expect(reviewerBands).toHaveLength(DIMENSIONS.length)
  expect(
    reviewerBands.every((event) => Array.isArray(event.payload.evidence_event_seqs)),
    'the reviewer’s copy of a draft band carries the evidence it was read from',
  ).toBe(true)
  expect(reviewerOnlyFieldsIn(reviewerTrace).length).toBeGreaterThan(0)

  // -------------------------------------------------------------------------------------------
  // The notifications the scoring job sends (SYS-010, FR-130)
  // -------------------------------------------------------------------------------------------

  const mineNotifications = await readJson<{ items: NotificationRow[] }>(
    page.request,
    '/api/v1/notifications?limit=100',
  )
  const toStudent = mineNotifications.items.find((row) => row.link === `/runs/${runId}`)
  expect(toStudent, 'the student is told their run has been scored').toBeDefined()
  expect(toStudent?.type).toBe('run_scored')
  expect(toStudent?.title).toBe('Your run has been scored')
  saysNothingAboutTheAssessment(toStudent, 'the student’s notification', true)
  // It names the draft, which is the one thing about scoring the student is told (FR-140).
  expect(toStudent?.body).toContain('Your instructor reviews and confirms them')

  const reviewerNotifications = await readJson<{ items: NotificationRow[] }>(
    request,
    '/api/v1/notifications?limit=100',
  )
  const toReviewer = reviewerNotifications.items.find((row) => row.link === `/review/runs/${runId}`)
  expect(toReviewer, 'the section’s instructors are told there is a run to review').toBeDefined()
  expect(toReviewer?.type).toBe('run_scored')
  expect(toReviewer?.title).toBe('A run is ready to review')

  await signOut(page)
})
