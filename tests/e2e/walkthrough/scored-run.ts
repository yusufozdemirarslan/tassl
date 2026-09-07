// A run driven to `scored` through the documented endpoints — setup the faculty specs need and do
// not prove.
//
// Steps 2 to 11 of the walkthrough are proved, through the screens, by `02-05`, `06`, `07`, `08`,
// `09`, `10` and `11`. Steps 1, 12 and 15 are about what a *faculty seat* does with a run that is
// already scored, and each of them needs one: repeating fourteen endpoint calls in three specs
// would give them three chances to drift and would say nothing about the replay. So the drive lives
// here once, exactly as `../instructor/api.ts` holds the course and assignment setup the student
// specs need.
//
// The run is **assistant-free**, for the reason `11-scoring-debrief.spec.ts` gives at length: with
// no delegation in the log the Delegation read falls back to the defense answers and the band is
// marked `defense_only` (D-406, FR-064), and the run stays clear of D-026's ten delegations a
// minute that three browser projects on one seat would otherwise share.
//
// Every call is rate-limit aware. Three browser projects take the same run at once on one seat, and
// six endpoint-driven runs of fourteen writes each is over D-026's sixty a minute; the limiter is
// proven on its own in `tests/integration/rate-limit`, so a refusal here is waited out rather than
// failed on and the lane degrades to slow instead of red.
import { expect, type APIRequestContext } from '@playwright/test'

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
export const WRITE_HEADERS = {
  'content-type': 'application/json',
  'X-Requested-With': 'tassl',
} as const

/** Past the longest Turn delay a run can draw (FR-110: 60 to 120 seconds after the lock). */
export const PAST_THE_TURN_MS = 130_000

/** Far past NFR-001's five seconds: a run that misses this has gone wrong rather than slow. */
export const SCORING_TIMEOUT_MS = 20_000

/** At most this many refusals are waited out before a 429 is reported as the failure it is. */
const RATE_LIMIT_WAITS = 4

export const FRAME = {
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

export const BRIEF = {
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

export const TURN_RESPONSE = {
  response: 'revise',
  justification:
    'The retention number the payback was priced on has been corrected by the person who was quoting it, so the share I set on the old figure no longer follows from anything I can point at.',
  confidence: 48,
} as const

/** Each carries a digit and a reason marker, so none earns the follow-up (FR-123, D-031). */
const ANSWERS = [
  'I priced this on the payback figure of 11 months because it is the only number in front of me that speaks to the premium tier at all, and I said in the brief that it wanted rechecking.',
  'I did not settle it, because the 1 document that would have dated the figure after the board deck is not in the room, so I filed the decision that survives either answer.',
  'I moved my confidence down to 48 because the person who quoted the retention number corrected it, and the share I had set was priced on the old one.',
] as const

export type StudentAssignment = {
  assignmentId: string
  label: string
  latestRun: { id: string } | null
}
type ClaimRow = { id: string; key: string; inTurnWindow: boolean }
type DefenseQuestionRow = { runQuestionId: string; seq: number; answered: boolean }

export async function readJson<T>(api: APIRequestContext, path: string): Promise<T> {
  const response = await api.get(path)
  expect(response.status(), `GET ${path}: ${await response.text()}`).toBe(200)
  return (await response.json()) as T
}

/** One documented write, checked — and waited out when the limiter refuses it (D-026). */
async function write(
  api: APIRequestContext,
  method: 'post' | 'put',
  path: string,
  data: unknown,
  expected: number,
): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await api[method](path, { data, headers: WRITE_HEADERS })
    if (response.status() !== 429 || attempt >= RATE_LIMIT_WAITS) {
      expect(response.status(), `${method.toUpperCase()} ${path}: ${await response.text()}`).toBe(
        expected,
      )
      return await response.json().catch(() => null)
    }
    const refusal = (await response.json().catch(() => null)) as {
      error?: { details?: { retryAfterSeconds?: number } }
    } | null
    const seconds = Math.min(Math.max(refusal?.error?.details?.retryAfterSeconds ?? 5, 1), 60)
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 500))
  }
}

export async function post<T>(
  api: APIRequestContext,
  path: string,
  data: unknown = {},
  expected = 200,
): Promise<T> {
  return (await write(api, 'post', path, data, expected)) as T
}

export async function put(
  api: APIRequestContext,
  path: string,
  data: unknown,
  expected = 200,
): Promise<void> {
  await write(api, 'put', path, data, expected)
}

/** The student's own row for an assignment, found by the label the fixture gave it. */
export async function myAssignment(
  api: APIRequestContext,
  label: string,
): Promise<StudentAssignment> {
  const { items } = await readJson<{ items: StudentAssignment[] }>(api, '/api/v1/me/assignments')
  const found = items.find((item) => item.label === label)
  expect(found, `no assignment "${label}"`).toBeDefined()
  return found as StudentAssignment
}

/** Steps 2 to 9 through the endpoints the screens call; returns the run, in `defense_pending`. */
export async function reachDefense(api: APIRequestContext, assignmentId: string): Promise<string> {
  const { id: runId } = await post<{ id: string }>(
    api,
    `/api/v1/assignments/${assignmentId}/runs`,
    {},
    201,
  )
  await post(api, `/api/v1/runs/${runId}/policy-ack`)

  const check = await readJson<{ items: { id: string; options: { key: string }[] }[] }>(
    api,
    `/api/v1/runs/${runId}/readiness`,
  )
  for (const item of check.items) {
    await put(
      api,
      `/api/v1/runs/${runId}/readiness/answers/${item.id}`,
      { answerKey: item.options[0]?.key },
      204,
    )
  }
  await post(api, `/api/v1/runs/${runId}/readiness/submit`)
  await post(api, `/api/v1/runs/${runId}/frame`, FRAME)
  await post(api, `/api/v1/runs/${runId}/lock`, BRIEF)

  // The Turn falls due on the run's own clock; the shift is the only honest way to reach it (D-109).
  await post(api, `/api/v1/test/runs/${runId}/advance-clock`, { ms: PAST_THE_TURN_MS })

  // FR-111: every claim the window raised needs a stance before the response can lock.
  const claims = await readJson<ClaimRow[]>(api, `/api/v1/runs/${runId}/claims`)
  const windowClaims = claims.filter((claim) => claim.inTurnWindow)
  expect(windowClaims.length, 'the Turn should have raised claims').toBeGreaterThan(0)
  for (const claim of windowClaims) {
    await put(api, `/api/v1/runs/${runId}/claims/${claim.id}/stance`, { stance: 'verify' })
  }

  await post(api, `/api/v1/runs/${runId}/turn/response`, TURN_RESPONSE)
  return runId
}

/** The interview, answered to the last question (FR-121 to FR-126). */
export async function answerEveryQuestion(api: APIRequestContext, runId: string): Promise<number> {
  let answered = 0
  for (let pass = 0; pass < 3; pass += 1) {
    const defense = await readJson<{ questions: DefenseQuestionRow[] }>(
      api,
      `/api/v1/runs/${runId}/defense`,
    )
    const outstanding = defense.questions.filter((question) => !question.answered)
    if (outstanding.length === 0) return answered
    for (const question of outstanding) {
      await post(api, `/api/v1/runs/${runId}/defense/questions/${question.runQuestionId}/answer`, {
        text: ANSWERS[answered % ANSWERS.length],
        durationMs: 45_000,
      })
      answered += 1
    }
  }
  throw new Error('the defense still had unanswered questions after three passes')
}

/**
 * The whole of steps 2 to 11 on one assignment: a run in `scored`, with a drafted band on every
 * dimension and nothing decided.
 *
 * The wait is on the run's own two server timestamps rather than on the browser's clock, and its
 * ceiling is far past NFR-001's budget: a run that misses it is *held* (FR-140) rather than slow,
 * and this says so instead of hanging.
 */
export async function driveRunToScored(
  api: APIRequestContext,
  assignmentId: string,
): Promise<string> {
  const runId = await reachDefense(api, assignmentId)
  await answerEveryQuestion(api, runId)
  await post(api, `/api/v1/runs/${runId}/defense/complete`)

  await expect
    .poll(
      async () => {
        const run = await readJson<{ state: string; scoringStatus: string }>(
          api,
          `/api/v1/runs/${runId}`,
        )
        return `${run.state}/${run.scoringStatus}`
      },
      {
        timeout: SCORING_TIMEOUT_MS,
        message:
          'the finished defense hands the run to scoring (FR-130); `defense_complete/held` means a band read did not come back',
      },
    )
    .toBe('scored/done')

  return runId
}
