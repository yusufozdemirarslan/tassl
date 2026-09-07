// Step 14 of the walkthrough (PRD §12): **the record as it leaves Tassl, and the two screens that
// hand it over**.
//
// Part 1 is the document underneath UI-029 — that the trace is reachable over HTTP once the run is
// scored, that what comes back is the shape the export schema publishes, and that the three keys
// FR-170 keeps out of the student's copy are kept out by the schema rather than by anybody's care.
// Part 2 is the pair of screens the confirmation opens: the assignment's export history (UI-035)
// listing version 1, and the Judgment Record itself (UI-029) with its four graphs, its confirmed
// bands, the mode and the variant, and a download that carries none of the course's arithmetic.
//
// Five things.
//
//   **The record is sealed until the run is scored, and then it opens** (D-279, D-117). The same
//   endpoint answers 403 during the defense and 200 afterwards, and the two answers are asserted
//   against one run rather than against two.
//
//   **What comes back is the export's own document, row for row** (FR-240, FR-241). Every event the
//   endpoint hands the student is rebuilt into the envelope `export-schema.ts` publishes and parsed
//   against the **record form's** schema for its type. That is a stronger statement than it looks:
//   every object in that schema is a `strictObject`, so a field the projection let through that the
//   record form does not carry fails as an unrecognized key, and a field the projection dropped that
//   the record form requires fails as a missing one. The student's live trace and the file they will
//   download are the same projection, and this is where that stops being an assumption.
//
//   **FR-170, through the endpoint.** `points` is at no depth of the student's trace. `weight` and
//   `mapping` are at exactly one — the payload of the policy screen they were shown (FR-201) — and
//   the published record-form schema rejects even that, naming both keys. The course form accepts
//   the same payload, so the assertion is about the difference between the two forms and not about a
//   run that had nothing to hide.
//
//   **The extension list is honest** (FR-241). Every event type this run recorded that PRD §12's
//   list does not name is in `x_tassl_extensions`, so a reader of the file can tell an extension
//   from a type they have missed.
//
//   **And the record file itself is refused, because the bands are drafts** (FR-170, PRD §7.13).
//   `GET /runs/{runId}/record/export` answers `RECORD_NOT_AVAILABLE` with the state the student's
//   own status screen is already showing them. A draft band does not leave Tassl.
//
// FR-170's own acceptance criterion is the whole record document, fetched from
// `GET /runs/{runId}/record/export` and swept for the three keys, and part 2 is where that runs: the
// instructor confirms the seven bands, the endpoint opens, and `findForbiddenKeys(document,
// { scored: true, form: 'record' })` is run over the file the student downloads. The one path it
// exempts is `confidence_line.points` — the three plotted readings of FR-132's line, which are the
// student's own numbers and which FR-170 puts *in* the record by name (D-439) — and the exemption is
// named here rather than assumed, exactly as the service names it.
//
// The run is set up through the documented endpoints and is assistant-free, for the reasons
// `11-scoring-debrief.spec.ts` gives at length: the Delegation read falls back to the defense
// answers (D-406), and three browser projects on one seat stay clear of D-026's ten delegations a
// minute. It runs on its own assignment because D-041 allows one run per student per assignment.
import type { APIRequestContext, APIResponse, Page } from '@playwright/test'
import { z } from 'zod'
import { expect, seatEmail, signInAs, signOut, test, type Seat } from '../fixtures'
import { addSectionMember, createStudentAssignment, signInAsInstructor } from '../instructor/api'
// The two instructor writes of part 2 go through the rate-limit-aware pair rather than the local
// `Page`-shaped one: they are made on the `request` context, and three browser projects share the
// one instructor seat against D-026's sixty writes a minute (`scored-run.ts`'s `write`).
import { post as apiPost, put as apiPut } from './scored-run'
import { findForbiddenKeys } from '@/server/auth/student-view'
import {
  CourseTraceExportSchema,
  RecordTraceExportSchema,
  X_TASSL_EXTENSIONS,
} from '@/server/modules/trace/export-schema'
import { RUN_EVENT_TYPES, TraceEventViewSchema } from '@/server/modules/trace/schema'

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
const WRITE_HEADERS = { 'content-type': 'application/json', 'X-Requested-With': 'tassl' } as const

/**
 * The seat this run is taken in, and it is deliberately not `student1` — the reasoning is
 * `11-scoring-debrief.spec.ts`'s, in full, and the two specs share the seat because they are the
 * only two that use it: D-026's `write` bucket is sixty a minute per user, an endpoint-driven run
 * spends about fourteen of them in a few seconds, and the nineteen specs that sign in as `student1`
 * spend theirs slowly between browser interactions. `editor` is a seeded institution member (06 §5)
 * that nothing else in this suite signs in as.
 */
const STUDENT_SEAT: Seat = 'editor'

/** Past the longest Turn delay a run can draw (FR-110: 60 to 120 seconds after the lock). */
const PAST_THE_TURN_MS = 130_000

/** Far past NFR-001's five seconds: a run that misses this has gone wrong rather than slow. */
const SCORING_TIMEOUT_MS = 20_000

/** The three keys the record form of the export omits at every depth (FR-170, FR-243). */
const COURSE_ONLY_KEYS = ['weight', 'mapping', 'points'] as const

/**
 * The one legitimate collision with the containment rule, named rather than assumed (D-439).
 *
 * `confidence_line.points` are the three plotted readings of FR-132's line — the student's own
 * confidence at the frame, at the lock and after the Turn — and FR-170 puts that graph *in* the
 * record by name. The pattern matches that path and the readings inside it, so a `points_confirmed`
 * nested anywhere else, including inside a reading, is still a finding.
 */
const CONFIDENCE_LINE_POINTS = /(^|\.)confidence_line\.points(\[\d+\])?$/

/**
 * The one survivor of the always-set in a record-form export (D-370).
 *
 * `readiness_item.answer_key` is the option the *student* chose, which is a different field from the
 * item's answer key and the reason `owner-view.ts` exists at all. `student-view.ts` forbids the name
 * outright, and `tests/integration/trace/export.test.ts` audits the export key by key; here the one
 * path is exempted by shape so that a second `answer_key` anywhere else would still be a finding.
 */
const STUDENT_ANSWER_KEY = /^events\[\d+\]\.payload\.answer_key$/

/** The note the instructor writes on the band, which the record then carries (FR-170, FR-182). */
const RECORD_NOTE = 'Read against the Source Trace on the payback figure.'

/**
 * How long the two recharts graphs may take to appear.
 *
 * `@/components/graphs` loads the confidence line and the clock timeline through `next/dynamic` so
 * the library is not in the route's entry bundle (16 §3.2, D-282, D-074), which means they arrive
 * in a chunk fetched *after* the page — by design.
 */
const GRAPH_TIMEOUT_MS = 20_000

/**
 * The event types PRD §12's "exportable event trace" names, in its order.
 *
 * Restated here rather than imported because `export-schema.ts` keeps it private and derives the
 * extension list from it. Restating it is the point: if the two ever disagree, the extension
 * assertion below fails, which is exactly the check FR-241 asks for.
 */
const PRD_EVENT_TYPES: readonly string[] = [
  'readiness_item',
  'document_open',
  'document_close',
  'frame_locked',
  'delegation',
  'claim_used',
  'stance_set',
  'action',
  'escalation',
  'outside_tool_declared',
  'pause',
  'resume',
  'lock_refused',
  'decision_locked',
  'brief_opened',
  'brief_closed',
  'addendum',
  'turn_delivered',
  'turn_response_locked',
  'defense_question',
  'defense_answer',
  'draft_band',
  'band_decision',
  'claim_neutralized',
  'run_voided',
  'debrief_opened',
  'debrief_answer',
]

/** The events this run must have recorded by the time it is scored, whatever else it did. */
const EXPECTED_TYPES = [
  'policy_displayed',
  'readiness_item',
  'frame_locked',
  'decision_locked',
  'turn_delivered',
  'turn_response_locked',
  'defense_question',
  'defense_answer',
  'draft_band',
  'lifecycle',
] as const

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

/** Each carries a digit and a reason marker, so none earns the follow-up (FR-123, D-031). */
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
 * Three browser projects take this run at once on one seat, and six endpoint-driven runs of
 * fourteen writes each is over D-026's sixty a minute. That is a fact about a lane that shares a
 * seat rather than a defect in the product — the limiter is proven on its own in
 * `tests/integration/rate-limit` — so a refusal is waited out rather than failed on, exactly as
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

// ---------------------------------------------------------------------------------------------
// The published schema, one event type at a time
//
// `export-schema.ts` builds the events array as a discriminated union over the thirty-two payload
// schemas, and does not export the per-type members. They are taken out of the document schema
// here rather than rebuilt from `EVENT_PAYLOAD_SCHEMAS` and `owner-view.ts`, because rebuilding
// them would be this spec re-deriving the very rule it is checking: what is wanted is the schema
// the API contract publishes, exactly as `openapi.yaml` names it.
// ---------------------------------------------------------------------------------------------

type PublishedEventSchema = z.ZodObject<{
  seq: z.ZodType
  type: z.ZodLiteral<string>
  occurred_at: z.ZodType
  clock_remaining_ms: z.ZodType
  payload: z.ZodObject
}>

function eventSchemaOf(document: z.ZodObject, type: string): PublishedEventSchema {
  const events = document.shape.events as z.ZodArray<
    z.ZodDiscriminatedUnion<PublishedEventSchema[]>
  >
  const option = events.element.options.find((candidate) => candidate.shape.type.value === type)
  expect(option, `the export schema publishes no event of type ${type}`).toBeDefined()
  return option as PublishedEventSchema
}

/** One event as the export document carries it, rebuilt from the row the trace endpoint served. */
function asExportRow(event: TraceEvent): Record<string, unknown> {
  return {
    seq: event.seq,
    type: event.type,
    occurred_at: event.occurredAt,
    clock_remaining_ms: event.clockRemainingMs,
    payload: event.payload,
  }
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
  return runId
}

/** The interview, answered to the last question; a follow-up never earns another (FR-123). */
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

test('walkthrough step 14: the scored run’s trace is served over the API in the shape the export publishes, and the record file is still refused', async ({
  page,
  request,
}) => {
  // A full run driven to a scored one is past Playwright's default patience on a loaded machine
  // (D-188). The assertions are unchanged, only the wait.
  test.setTimeout(420_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Export record',
    studentEmail: seatEmail(STUDENT_SEAT),
    variant: 'defective',
  })
  // The instructor is on the section as well: part 2 needs a seat that may decide the seven bands
  // and read the assignment's export history (`requireRunReviewer`, `requireSectionRole`).
  await addSectionMember(request, assignment.section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  await signInAs(page, STUDENT_SEAT)
  const mine = await myAssignment(page, assignment.label)
  const runId = await reachDefense(page, mine.assignmentId)
  await answerEveryQuestion(page, runId)

  // -------------------------------------------------------------------------------------------
  // Sealed, then open (D-279, D-117)
  // -------------------------------------------------------------------------------------------

  const sealed = await page.request.get(`/api/v1/runs/${runId}/trace`)
  expect(sealed.status(), await sealed.text()).toBe(403)

  await post(page, `/api/v1/runs/${runId}/defense/complete`)
  await expect
    .poll(
      async () => {
        const run = await readJson<{ state: string; scoringStatus: string }>(
          page.request,
          `/api/v1/runs/${runId}`,
        )
        return `${run.state}/${run.scoringStatus}`
      },
      {
        timeout: SCORING_TIMEOUT_MS,
        message:
          'the trace opens to its own student once the run is scored; `defense_complete/held` means a band read did not come back',
      },
    )
    .toBe('scored/done')

  const events = await readJson<TraceEvent[]>(page.request, `/api/v1/runs/${runId}/trace`)
  expect(events.length).toBeGreaterThan(20)

  // -------------------------------------------------------------------------------------------
  // The envelope, and the dense renumbering the owner's view is built on (FR-053, 07 §7)
  // -------------------------------------------------------------------------------------------

  for (const event of events) {
    const parsed = TraceEventViewSchema.safeParse(event)
    expect(
      parsed.success,
      `event ${String(event.seq)} (${event.type}): ${parsed.error?.message}`,
    ).toBe(true)
  }
  expect(
    events.map((event) => event.seq),
    'the owner’s trace is renumbered densely, 1..N, so a hidden event leaves no hole',
  ).toEqual(events.map((_, index) => index + 1))

  const types = new Set(events.map((event) => event.type))
  for (const type of EXPECTED_TYPES) {
    expect(types.has(type), `the run should have recorded a ${type} event`).toBe(true)
  }
  expect(events.filter((event) => event.type === 'readiness_item')).toHaveLength(16)
  expect(events.filter((event) => event.type === 'draft_band')).toHaveLength(7)

  // -------------------------------------------------------------------------------------------
  // The export schema: every row the endpoint served is a row the record form accepts (FR-240,
  // FR-241, FR-243)
  //
  // `policy_displayed` is the one exception and it is the subject of the next block: the trace
  // carries the weight and the mapping because the student was shown them on the run start screen
  // (FR-201), and the record form is the document that leaves Tassl without them (FR-170).
  // -------------------------------------------------------------------------------------------

  for (const event of events) {
    if (event.type === 'policy_displayed') continue
    const schema = eventSchemaOf(RecordTraceExportSchema, event.type)
    const parsed = schema.safeParse(asExportRow(event))
    expect(
      parsed.success,
      `${event.type} at seq ${String(event.seq)} is not a record-form event: ${parsed.error?.message}`,
    ).toBe(true)
  }

  // -------------------------------------------------------------------------------------------
  // FR-170: `weight`, `mapping` and `points`, through the endpoint
  // -------------------------------------------------------------------------------------------

  const displayed = events.find((event) => event.type === 'policy_displayed')
  expect(displayed, 'the run start screen records what it displayed (FR-201)').toBeDefined()
  const policyRow = asExportRow(displayed as TraceEvent)

  // The course form takes it as it stands: the instructor's copy is where the arithmetic lives.
  const asCourse = eventSchemaOf(CourseTraceExportSchema, 'policy_displayed').safeParse(policyRow)
  expect(asCourse.success, `the course form should accept it: ${asCourse.error?.message}`).toBe(
    true,
  )

  // The record form refuses it, and names both keys. Every object in the export schema is a
  // `strictObject`, so this is FR-170 enforced by the document rather than by a delete.
  const asRecord = eventSchemaOf(RecordTraceExportSchema, 'policy_displayed').safeParse(policyRow)
  expect(asRecord.success, 'the record form must not carry the course’s arithmetic').toBe(false)
  const unrecognized = (asRecord.error?.issues ?? []).flatMap((issue) =>
    issue.code === 'unrecognized_keys' ? issue.keys : [],
  )
  expect([...unrecognized].sort()).toEqual(['mapping', 'weight'])

  // And in the live payload: `points` is nowhere at all, and the other two are only where the
  // student was shown them.
  const courseOnly = keysAtAnyDepth(events).filter((entry) =>
    (COURSE_ONLY_KEYS as readonly string[]).includes(entry.key),
  )
  expect(
    courseOnly.filter((entry) => entry.key === 'points'),
    'a student’s run never carries the points their bands would map to (FR-131, FR-170)',
  ).toEqual([])
  const policyIndex = events.indexOf(displayed as TraceEvent)
  for (const entry of courseOnly) {
    expect(entry.path, 'weight and mapping belong to the policy the student was shown').toBe(
      `[${String(policyIndex)}].payload.${entry.key}`,
    )
  }

  // -------------------------------------------------------------------------------------------
  // FR-241: everything this build records that PRD §12 does not list is declared as an extension
  // -------------------------------------------------------------------------------------------

  const extensions = new Set<string>(X_TASSL_EXTENSIONS.map(String))
  for (const type of types) {
    if (PRD_EVENT_TYPES.includes(type)) continue
    expect(
      extensions.has(type),
      `${type} is not in PRD §12's list, so the export header must declare it`,
    ).toBe(true)
  }
  // The list is derived from the vocabulary rather than written beside it, so nothing in it is a
  // type the build does not record.
  for (const type of extensions) {
    expect((RUN_EVENT_TYPES as readonly string[]).includes(type)).toBe(true)
    expect(PRD_EVENT_TYPES.includes(type)).toBe(false)
  }

  // -------------------------------------------------------------------------------------------
  // The record file: refused, because the bands are drafts (FR-170, PRD §7.13, 10 §14)
  // -------------------------------------------------------------------------------------------

  const refused = await page.request.get(`/api/v1/runs/${runId}/record/export`)
  expect(refused.status(), await refused.text()).toBe(409)
  const envelope = (await refused.json()) as {
    error: { code: string; message: string; details?: { state?: string }; requestId: string }
  }
  expect(envelope.error.code).toBe('RECORD_NOT_AVAILABLE')
  // The state the student's own status screen is already showing them, so a screen can say what
  // they are waiting for rather than only that they cannot have it.
  expect(envelope.error.details?.state).toBe('scored')
  expect(envelope.error.requestId).toBeTruthy()
  // Nothing of the document came back with the refusal.
  const body = await refused.text()
  for (const key of COURSE_ONLY_KEYS) expect(body).not.toContain(`"${key}"`)

  // -------------------------------------------------------------------------------------------
  // Part 2: the confirmation opens the record (UI-029, UI-035, FR-170 to FR-172, FR-204)
  // -------------------------------------------------------------------------------------------

  await signInAsInstructor(request)
  const bands = await readJson<{ bands: { dimension: string; band: string | null }[] }>(
    request,
    `/api/v1/review/runs/${runId}`,
  )
  const verification = bands.bands.find((band) => band.dimension === 'verification')
  const overrideTo = verification?.band === 'professional' ? 'proficient' : 'professional'
  await apiPut(request, `/api/v1/review/runs/${runId}/bands/verification`, {
    decision: 'overridden',
    band: overrideTo,
    note: RECORD_NOTE,
  })
  await apiPost(request, `/api/v1/review/runs/${runId}/confirm-remaining`)

  // UI-035: the assignment's export history lists version 1, with the reason it was written and a
  // download beside it, and carries the sentence about the gradebook of record.
  // The browser drives both screens, one seat at a time: the export history is the instructor's and
  // the record is the student's, and reading each in the seat it belongs to is half the assertion.
  await signOut(page)
  await signInAs(page, 'instructor')
  await page.goto(`/assignments/${mine.assignmentId}/exports`)
  await expect(page.getByRole('heading', { level: 1, name: 'Course exports' })).toBeVisible()
  const table = page.locator('#assignment-exports')
  await expect(table.getByText('The bands were confirmed')).toBeVisible()
  await expect(table.getByRole('link', { name: 'Download version 1' })).toBeVisible()
  await expect(
    table.getByText(
      'Enter bands, mapping, and points in the gradebook of record; Tassl holds no grade.',
    ),
  ).toBeVisible()
  await signOut(page)

  // UI-029: the student's own Judgment Record.
  await signInAs(page, STUDENT_SEAT)
  await page.goto(`/records/${runId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Judgment Record' })).toBeVisible()

  for (const title of [
    'Confidence line',
    'Clock timeline',
    'Stance matrix',
    'Frame beside decision',
  ]) {
    await expect(
      page.locator('#record-graphs').getByRole('heading', { name: title }),
      `UI-029 draws all four graphs; "${title}" is missing`,
    ).toBeVisible({ timeout: GRAPH_TIMEOUT_MS })
  }

  const recordBands = page.locator('#record-bands')
  await expect(recordBands.getByText('Confirmed band')).toHaveCount(7)
  await expect(recordBands.getByText('Draft band')).toHaveCount(0)
  await expect(recordBands.locator('#band-verification').getByText(RECORD_NOTE)).toBeVisible()

  // FR-170's "mode and variant". The variant is the one this spec chose, so it is asserted by name;
  // the mode is the assignment's and is asserted as one of the three rather than as a guess.
  // The two terms, exactly: the panel's own description sentence names both words as well, and a
  // substring match would resolve to it too.
  const context = page.locator('#record-context')
  await expect(context.getByText('Mode', { exact: true })).toBeVisible()
  await expect(context.getByText('Variant', { exact: true })).toBeVisible()
  await expect(context.getByText('Defective', { exact: true })).toBeVisible()
  await expect(context.getByText(/^(Guided|Standard|Open)$/)).toBeVisible()

  // FR-172, through the file the student actually downloads: no key whose name contains `weight`,
  // `mapping` or `points` at any depth — with the one path FR-170 puts in the record by name.
  const file = await page.request.get(`/api/v1/runs/${runId}/record/export`)
  expect(file.status(), await file.text()).toBe(200)
  const document = (await file.json()) as unknown
  // Two exemptions, both named rather than assumed, and both the ones the service itself names.
  // `readiness_item.answer_key` is the key the *student themselves* chose — a different thing from
  // the item's answer key, which is why `owner-view.ts` exists — and it is the one survivor of the
  // always-set that `tests/integration/trace/export.test.ts` audits key by key (D-370).
  // `confidence_line.points` are the three plotted readings of FR-132's line (D-439).
  const findings = findForbiddenKeys(document, { scored: true, form: 'record' }).filter(
    (finding) =>
      !CONFIDENCE_LINE_POINTS.test(finding.path) && !STUDENT_ANSWER_KEY.test(finding.path),
  )
  expect(findings, 'FR-170: the record form carries none of the course’s arithmetic').toEqual([])
  // And the exemption is not a hole: the record-form terms alone, over the whole document, find
  // nothing at all. That is FR-172's rule — no key whose name contains `weight`, `mapping` or
  // `points`, at any depth — asserted without any exemption but the graph field FR-170 names.
  const arithmetic = findForbiddenKeys(document, { scored: true, form: 'record' }).filter(
    (finding) => finding.set === 'record_form' && !CONFIDENCE_LINE_POINTS.test(finding.path),
  )
  expect(arithmetic, 'FR-172: no course arithmetic at any depth of the record').toEqual([])
  const downloaded = JSON.stringify(document)
  expect(downloaded.length, 'the download is the record, not an empty envelope').toBeGreaterThan(
    1000,
  )

  await signOut(page)
})
