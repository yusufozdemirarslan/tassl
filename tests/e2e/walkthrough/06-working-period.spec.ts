// Step 6 of the walkthrough (PRD §12 "The walkthrough"), part 1: the working period, taken in the
// student seat, from the instant `02-05-start-to-frame.spec.ts` leaves off — the frame is locked,
// the clock is running, and the panel that carried one sentence through the framing period now
// carries a request box.
//
// What part 1 covers is what Phase 7 built (FR-050 to FR-056, FR-060 to FR-062, UI-023):
//
//   * a delegation that matches an authored trigger phrase surfaces that claim as its own card,
//     once, and the reply is prose with a claim object in it rather than one wall of text;
//   * the Delegation Log fills with what was asked and what came back;
//   * a claim is marked used, and the mark is one-way — there is no control that takes it back
//     (D-270), on the screen or after a reload;
//   * the why line saves and survives a reload, and does not rewrite the immutable event the
//     delegation already wrote (D-272);
//   * outside-tool use is declared, the no-penalty sentence is beside the control rather than
//     behind it (FR-061, FR-062), and the declaration is recorded and does nothing else;
//   * the unverified-number marker (FR-052, D-068, D-281) — see "The marker" below;
//   * the trace holds exactly the events those acts wrote, in the order they happened, and withholds
//     from the run's own owner the two fields of a `delegation` that are the reviewer's (D-269).
//
// **Part 2 is Phase 8's half of the same step** (FR-070 to FR-073, FR-080, FR-085, FR-090 to
// FR-092), appended to the same test because the same run has to carry it: D-041 allows one run per
// student per assignment, so a second test would need a second assignment and a second five-minute
// setup for a working period that is one continuous thing. What it adds is what a student actually
// does with a claim once they have one:
//
//   * a Source Trace on a claim the first request did not raise, returning the document, the
//     passage, the date and the author the package's author wrote, and charging one minute;
//   * a stance taken before that check and changed after it, with both kept and the second naming
//     the first (FR-085);
//   * Challenge on one low-stakes claim and Reject on another;
//   * one escalation, with a one-sentence statement, the colleague's reply, and five minutes off
//     the clock — and nothing on screen saying which reply answered or whether it counted (D-116).
//
// The Sycophancy Probe is Phase 9's, and nothing here asserts its absence.
//
// **The run is set up through the documented endpoints and driven through the screen.** Steps 2 to 5
// are the sibling spec's subject and are proven there; repeating them through the browser here would
// add four minutes to every project for a starting position. So the run is started, acknowledged,
// answered, submitted and framed through `07-api-spec.md` §7 — the same endpoints the screens call,
// through `page.request`, which shares the browser's cookie jar — and every assertion below is made
// against the screen a student is looking at, the trace, or the reviewer's own read.
//
// **It runs on the seeded package version, on the defective variant, through an assignment of its
// own** — the same arrangement, and for the same reason, as the sibling: D-041 allows one run per
// student per assignment until it is voided, so three browser projects sharing one assignment would
// collide inside a single run of the suite. `tests/e2e/global-setup.ts` purges what it creates.
//
// THE MARKER (D-283)
//
// FR-052's acceptance criterion in `flag` mode is that a number the room does not source is marked
// in the reply and a number it does source is not (D-281). Only the second half is assertable end to
// end, and the reason is a property of the provider the E2E lane runs on rather than of the product:
// `LLM_PROVIDER=mock` (playwright.config.ts), and the mock's connective prose contains no digit at
// all by construction — 11 §1.4 requires it never to emit a number absent from the claims or the
// request, and the cheapest guarantee of that was templates with no digits in them, which
// `tests/unit/llm/mock.test.ts` pins. Every figure in a mock reply therefore arrives inside an
// authored claim segment, which no guard reads (D-264), and the guard's allowed set already
// contains the student's own request — so no request a student can type produces a marked figure on
// this lane. The marked half is covered where a reply can be written by hand:
// `tests/unit/llm/numeric-guard.test.ts`, `tests/unit/assistant/assemble-reply.test.ts` and the two
// component tests; Phase 14's provider is where it becomes assertable here. What is asserted below
// is the half that is real on this lane, and asserted so that it cannot pass vacuously: the claim's
// own figure is on the screen, the stored reply carries no marker, and the reviewer's audit of the
// same reply — the one view that says whether the guard fired — lists nothing.
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, seatEmail, signInAs, signOut, test } from '../fixtures'
import { addSectionMember, createStudentAssignment, signInAsInstructor } from '../instructor/api'

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
const WRITE_HEADERS = { 'content-type': 'application/json', 'X-Requested-With': 'tassl' } as const

/**
 * The request, and it is not this spec's invention: it is `07-api-spec.md` §7's own example body for
 * `POST /runs/{runId}/delegations`, and "premium payback" is the first of the three trigger phrases
 * the seeded package's claim C3 carries (`src/server/db/fixtures/meridian-roast.package.json`). It
 * matches C3 on D-030's phrase rule and matches no other claim in the package on either rule — C1's
 * "value tier payback" and C3's own "payback period" both need a token this request does not have —
 * which is what makes "one card" an assertion about surfacing rather than about wording.
 */
const REQUEST = 'What is the premium payback?'

/** The claim the request raises, by the key the author gave it. */
const CLAIM_KEY = 'C3'

/**
 * Part 2's one further request, and the three claims it raises (FR-051, D-030, D-260).
 *
 * One request rather than three, and it is a better test as well as a lighter one. A reply that
 * carries three claim objects is what a real question produces — a student asks about the thing
 * they are deciding, not about one claim at a time — and it is the only place in the suite where
 * the surfacing rule is exercised with more than one match and the panel's announcement has a count
 * in it. It is also three delegations fewer against D-026's ten a minute, which is the budget a seat
 * shared by three browser projects is actually spending.
 *
 * The sentence carries exactly three claims' authored trigger phrases — "price sensitivity" (C5),
 * "saturated" (C8), "survey" (C7) — and no other claim's whole token set, which is what makes
 * "three claims surfaced" an assertion about surfacing rather than about wording. C1's "what does
 * the value tier cost" wants `does` and `cost`, C3's "premium payback" wants both of its words, and
 * C8's own "is the value tier out of room" wants three tokens this request does not have.
 */
const SECOND_REQUEST =
  'What is the price sensitivity, is the value tier saturated, and what did the survey find?'

/** The claim a Source Trace is run on, and whose stance is set and then changed (FR-070, FR-085). */
const TRACED_CLAIM_KEY = 'C5'
/** C5's authored `source_trace` on the defective variant, verbatim (FR-070, FR-073). */
const TRACED_PASSAGE =
  'Premium subscribers are 40 percent less price sensitive than value subscribers.'
const TRACED_AUTHOR = 'Marisol Quintero, Founder and Chief Executive'

/** A low-stakes claim, and the one this run rejects. */
const REJECTED_CLAIM_KEY = 'C8'

/** The claim the author wrote a colleague's reply for (FR-090). */
const ESCALATED_CLAIM_KEY = 'C7'

/** The one sentence FR-090 asks for; inside D-089's three words and 280 characters. */
const STATEMENT =
  'I cannot tell from the room whether the survey margin covers the tier subgroups this recommendation would rest on.'

/**
 * The opening of the colleague's reply the author wrote for C7, asserted as a substring.
 *
 * It is the *authored* reply rather than the version's general one, which is what makes this the
 * escalation FR-090 describes — and nothing on screen says which of the two it was (D-116). The
 * assertion is on the words the student reads, because those are the whole of what they are given.
 */
const ESCALATION_REPLY = 'Rowan Adeyemi, research operations. Two things about that number.'

/** The student's own line about why they asked (FR-060); inside 10 §7's 200-character bound. */
const WHY =
  'I need the payback figure before I can size the premium share, and I want it on record.'

/** FR-061: what was used outside Tassl and what for. Nothing asks whether it was allowed. */
const PURPOSE = 'A spreadsheet, to recompute the payback from the contribution figures myself.'

// The frame this run locks, inside FR-040's limits. It is setup rather than subject — the frame is
// step 5, and `02-05-start-to-frame.spec.ts` is where it is proven — but it is the student's own
// words, so it is written as a student would write them rather than as filler.
const FRAME = {
  decision:
    'Hold the premium share where it is this quarter until the premium payback figure has been checked against something dated later than the board deck.',
  assumptions: [
    'The premium payback figure in the board deck has not been revised since it was published.',
    'Value tier acquisition keeps performing at the rate the last two quarters recorded.',
    'Roastery capacity absorbs the current premium volume without new equipment this quarter.',
  ],
  position:
    'I lean towards holding the split until the payback number is checked. Moving budget upmarket on a figure nobody has confirmed this quarter would put most of the acquisition budget behind an assumption rather than behind evidence.',
  confidence: 58,
} as const

// ---------------------------------------------------------------------------------------------
// Reads and writes
//
// The student's go through `page.request`, which shares the browser's cookie jar and is therefore
// the same session the screens are using. The instructor's go through the `request` fixture, which
// has a jar of its own — so signing an instructor in for the setup and for the reviewer's read of
// the same delegation never disturbs the student session the test is driving.
// ---------------------------------------------------------------------------------------------

type TraceEvent = { seq: number; type: string; payload: Record<string, unknown> }
type StudentAssignment = { assignmentId: string; label: string; latestRun: { id: string } | null }
type ClaimView = { id: string; key: string; text: string }
type DelegationView = {
  id: string
  seq: number
  requestText: string
  responseText: string
  why: string | null
  failed: boolean
  flags?: string[]
  unverifiedNumbers?: { value: string; context: string }[]
}

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

/** The run's trace as its own student reads it (`GET /runs/{runId}/trace`, FR-007). */
async function traceOf(page: Page, runId: string): Promise<TraceEvent[]> {
  return readJson<TraceEvent[]>(page.request, `/api/v1/runs/${runId}/trace`)
}

/** The one event of a type, asserted to be the only one of it. */
function onlyEvent(events: readonly TraceEvent[], type: string): TraceEvent {
  const found = events.filter((event) => event.type === type)
  expect(found, `expected exactly one ${type} event, got ${String(found.length)}`).toHaveLength(1)
  return found[0] as TraceEvent
}

/** The student's own assignment row, by the label the instructor gave it, carrying no attempt yet. */
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

/**
 * Steps 2 to 5, through the endpoints the screens call: start, acknowledge, answer the sixteen
 * items, submit, lock the frame. Returns the run, in `working`, with its clock running.
 *
 * Which option is chosen is arbitrary and must be: correctness is computed server-side and no
 * response carries it (FR-012), so this spec does not know which key is right and does not need to.
 */
async function reachWorking(page: Page, assignmentId: string): Promise<string> {
  const { id: runId } = await post<{ id: string; state: string }>(
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
  expect(check.items).toHaveLength(16)
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
  expect(run.state, 'the run should be in `working` before step 6 begins').toBe('working')
  return runId
}

test('walkthrough step 6: delegate, take stances, check a claim, escalate, and record it all', async ({
  page,
  request,
}) => {
  // Sixteen answered items and a full page build put this past Playwright's default; the assertions
  // are unchanged, only the patience (D-188).
  test.setTimeout(300_000)

  // The course this run is taken in, built before the student arrives. The instructor is put on the
  // section as well as the student, because the reviewer's read of the same delegation is what says
  // whether the numeric guard fired — `requireRunReviewer` wants a section membership (08 §5).
  await signInAsInstructor(request)
  const { section, label } = await createStudentAssignment(request, {
    what: 'Working period',
    studentEmail: seatEmail('student1'),
    variant: 'defective',
  })
  await addSectionMember(request, section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  await signInAs(page, 'student1')
  const assignment = await myAssignment(page, label)
  const runId = await reachWorking(page, assignment.assignmentId)

  // -------------------------------------------------------------------------------------------
  // The workspace in `working` — where step 5 left the student (UI-023)
  // -------------------------------------------------------------------------------------------

  await page.goto(`/runs/${runId}/work`)
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()
  await expect(page.locator('[data-state="working"]')).toBeVisible()

  const assistant = page.locator('#assistant-panel')
  const log = page.locator('#delegation-log')
  const declaration = page.locator('#declaration-control')
  // The panel's own live region, addressed by id: from Phase 8 every claim card carries a region of
  // its own — one per claim, empty until something happens to that claim — and the reply's
  // announcement is the one that speaks about the reply.
  const replyStatus = assistant.locator('#assistant-reply-status')

  await expect(assistant.getByRole('heading', { level: 2, name: 'AI assistant' })).toBeVisible()
  await expect(log.getByText('Nothing delegated yet')).toBeVisible()

  // FR-061, FR-062: the sentence that makes the control safe to use is on screen before the student
  // decides to use it, not behind the control.
  await expect(declaration).toContainText(
    'A declaration never lowers a band or a point. Tassl does not detect, infer, or estimate outside use, and nothing it records is treated as misconduct.',
  )

  // -------------------------------------------------------------------------------------------
  // The delegation: one request, one claim card (FR-051, DATA-033)
  // -------------------------------------------------------------------------------------------

  const requestBox = assistant.getByLabel('Your request')
  await requestBox.fill(REQUEST)
  // The live count is the panel's own state, so it is also the proof that React owns this field
  // before the submit — a click that lands ahead of hydration is a native form post carrying a
  // value the form never saw (the trap D-182 found in WebKit).
  await expect(assistant.getByText(`${String(REQUEST.length)} of 2000 characters`)).toBeVisible()

  await assistant.getByRole('button', { name: 'Ask the assistant' }).click()

  // UI-023's one announcement, made when the stream is over and never per segment. "One claim" is
  // the surfacing assertion said in the words a screen-reader user hears.
  await expect(replyStatus).toHaveText('Reply complete. One claim surfaced.')

  // The claim arrives as its own object — an `article` with a heading — and not as a sentence in the
  // prose. Exactly one, for exactly the claim the author's phrase raises.
  const card = assistant.getByRole('article', { name: `Claim ${CLAIM_KEY}` })
  await expect(assistant.getByRole('article')).toHaveCount(1)
  await expect(card).toBeVisible()

  // The run's claims, as their own student reads them: one row, and nothing authored about it.
  const claims = await readJson<ClaimView[]>(page.request, `/api/v1/runs/${runId}/claims`)
  expect(claims).toHaveLength(1)
  const claim = claims[0] as ClaimView
  expect(claim.key).toBe(CLAIM_KEY)
  for (const withheld of [
    'evidenceStatus',
    'failureFamily',
    'warrantedStance',
    'planted',
    'rationale',
    'triggerPhrases',
    'sourcePassage',
  ]) {
    expect(claim, `a student's claim must not carry ${withheld}`).not.toHaveProperty(withheld)
  }

  // The card carries the author's text character for character.
  await expect(card).toContainText(claim.text)

  // -------------------------------------------------------------------------------------------
  // The reply as it was stored, and the marker on a figure the room does not source (FR-052, D-281)
  // -------------------------------------------------------------------------------------------

  const afterDelegation = await traceOf(page, runId)
  const delegated = onlyEvent(afterDelegation, 'delegation')
  const responseText = delegated.payload.response_text as string

  // The claim is marked once, and the author's text follows its marker — which is what lets the log
  // and the faculty replay draw the same card from the same stored sentence.
  const placed = `[[claim:${claim.id}]] ${claim.text}`
  expect(responseText).toContain(placed)
  expect(responseText.split(placed)).toHaveLength(2)

  // The claim's own figure is on the screen, and it is not marked: a claim's figures are in the
  // claim's own text, which no guard reads (D-264), so a sourced number reaches the student plain.
  const figure = /\d[\d,.]*/.exec(claim.text)?.[0]
  expect(
    figure,
    `claim ${CLAIM_KEY} should carry a figure to check the marker against`,
  ).toBeTruthy()
  await expect(card).toContainText(figure as string)
  expect(responseText).not.toContain('[[figure:')
  await expect(assistant).not.toContainText('[[figure:')
  // The sr-only sentence the marker carries for a reader who never sees the tooltip.
  await expect(assistant).not.toContainText('this figure is not in a claim or a document')

  // And the guard did run: the reviewer's audit of the same reply — the one view that says so —
  // lists no unverified number and no flag. Without this the three assertions above could pass on a
  // guard that had been switched off.
  const reviewed = await readJson<DelegationView[]>(request, `/api/v1/runs/${runId}/delegations`)
  expect(reviewed).toHaveLength(1)
  expect(reviewed[0]?.unverifiedNumbers).toEqual([])
  expect(reviewed[0]?.flags).toEqual([])

  // -------------------------------------------------------------------------------------------
  // The Delegation Log fills (FR-060)
  // -------------------------------------------------------------------------------------------

  const entry = log.getByRole('article', { name: 'Delegation 1', exact: true })
  await expect(entry).toBeVisible()
  await expect(log.getByText('Nothing delegated yet')).toHaveCount(0)

  // What was asked, and what came back. The reply is read off the stored text rather than retyped,
  // so this is "the log shows the reply the student saw" rather than "the log shows a reply".
  await expect(entry).toContainText(REQUEST)
  const leadIn = responseText.slice(0, responseText.indexOf('[[claim:')).trim()
  const closing = responseText.slice(responseText.indexOf(placed) + placed.length).trim()
  expect(leadIn, 'the reply should open with the assistant’s own prose').not.toBe('')
  expect(closing, 'the reply should close with the assistant’s own prose').not.toBe('')
  await expect(entry).toContainText(leadIn)
  await expect(entry).toContainText(closing)
  await expect(assistant).toContainText(leadIn)
  await expect(assistant).toContainText(closing)

  // The claims the reply raised, listed for marking rather than for re-reading.
  await expect(entry).toContainText(`Claim ${CLAIM_KEY}`)
  await expect(entry).toContainText(claim.text)

  // -------------------------------------------------------------------------------------------
  // The why line, and the used mark that cannot be taken back (FR-060, FR-084, D-270, D-272)
  // -------------------------------------------------------------------------------------------

  await entry.getByLabel('Why you asked, delegation 1').fill(WHY)
  await entry.getByRole('button', { name: 'Save' }).click()
  await expect(entry.locator('p[role="status"][id$="-status"]')).toHaveText('Saved.')

  // D-270 is said before the control is pressed, because the mark is permanent.
  await expect(entry).toContainText(
    'Marking a claim used records that you leaned on it. A mark stays on the record.',
  )

  const markUsed = entry.getByRole('button', { name: `Mark claim ${CLAIM_KEY} as used` })
  await expect(markUsed).toBeVisible()
  await markUsed.click()

  // The press leaves a badge where the button was, and the log offers nothing that undoes it: a
  // reversible mark would be a way past FR-084's gate rather than through it.
  await expect(entry).toContainText('You marked this claim used in the Delegation Log.')
  await expect(markUsed).toHaveCount(0)
  await expect(log.getByRole('button', { name: /used/i })).toHaveCount(0)

  // Both survive the page being asked for again — the mark because it was recorded, the why line
  // because it was saved, and neither because this browser is remembering them.
  await page.reload()
  const reloaded = log.getByRole('article', { name: 'Delegation 1', exact: true })
  await expect(reloaded.getByLabel('Why you asked, delegation 1')).toHaveValue(WHY)
  await expect(reloaded).toContainText('You marked this claim used in the Delegation Log.')
  await expect(log.getByRole('button', { name: /used/i })).toHaveCount(0)

  // -------------------------------------------------------------------------------------------
  // The outside-tool declaration (FR-061, FR-062, FR-006)
  // -------------------------------------------------------------------------------------------

  await declaration.getByRole('button', { name: 'Declare outside-tool use' }).click()
  await declaration.getByLabel('What you used, and what for').fill(PURPOSE)
  await declaration.getByRole('button', { name: 'Record it' }).click()

  await expect(declaration.getByRole('status')).toHaveText(
    'Recorded. It sits with the run and changes nothing about it.',
  )
  // Nothing about the run changed, and the sentence that said so is still there afterwards.
  await expect(declaration).toContainText('A declaration never lowers a band or a point.')
  const stillWorking = await readJson<{ state: string; clock: { remainingMs: number } | null }>(
    page.request,
    `/api/v1/runs/${runId}`,
  )
  expect(stillWorking.state).toBe('working')
  expect(stillWorking.clock).not.toBeNull()

  // -------------------------------------------------------------------------------------------
  // What the trace recorded (FR-007, 10 §10, D-269, D-272)
  // -------------------------------------------------------------------------------------------

  const trace = await traceOf(page, runId)
  const delegation = onlyEvent(trace, 'delegation')
  const used = onlyEvent(trace, 'claim_used')
  const declared = onlyEvent(trace, 'outside_tool_declared')

  expect(delegation.payload).toMatchObject({
    seq: 1,
    request_text: REQUEST,
    response_text: responseText,
    claim_ids: [claim.id],
    in_turn_window: false,
    failed: false,
    // D-272: the event was written when the reply landed and is immutable, so the why line saved
    // afterwards edits the log's row and not this.
    why: null,
  })
  // 12 §8.1 and D-269: the guard's flags and its list of unverified numbers are the reviewer's, and
  // the run's own owner does not read them from here — the reviewer's copy above carried both.
  expect(delegation.payload).not.toHaveProperty('flags')
  expect(delegation.payload).not.toHaveProperty('unverified_numbers')

  expect(used.payload).toMatchObject({
    claim_id: claim.id,
    via: 'log_mark',
    delegation_id: delegation.payload.delegation_id,
  })
  expect(declared.payload).toEqual({ purpose: PURPOSE })

  // The order is the trace's own: the reply, then the mark on one of its claims, then the
  // declaration that was made after both.
  expect(delegation.seq).toBeLessThan(used.seq)
  expect(used.seq).toBeLessThan(declared.seq)

  // -------------------------------------------------------------------------------------------
  // Step 6, part 2: stances, a Source Trace, and one escalation (FR-070 to FR-073, FR-080, FR-085,
  // FR-090 to FR-092)
  //
  // Everything below is done on the *log's* copy of a claim rather than on the reply's, and that is
  // the point rather than a convenience: the assistant panel holds one reply at a time, so the
  // cards in it are gone the moment the next request is sent, while the Delegation Log is rendered
  // from the server on every load and carries every claim the run has surfaced. It is the copy a
  // student comes back to, the copy that survives a reload, and the copy the Decision Lock's "Go to
  // the claim" reaches.
  //
  // The clock is asserted through `clock.chargedMs`, which is the sum of what the run has been
  // charged and nothing else. `remainingMs` also moves with the wall clock, so a test that asserted
  // on it would be asserting on how long the browser took.
  // -------------------------------------------------------------------------------------------

  /**
   * One request, asked the way a student asks it — and not sent until React owns the box.
   *
   * The live character count is the panel's own state, so waiting for it is the proof that the
   * field this browser is about to submit is the field the component is holding. It is the trap
   * D-182 found in WebKit, in a longer form: a click that lands while a `router.refresh()` from the
   * previous act is still settling can be a press against a control whose state has just been
   * re-rendered under it, and the reply then never starts.
   */
  async function ask(request: string, announced: string): Promise<void> {
    await requestBox.fill(request)
    await expect(assistant.getByText(`${String(request.length)} of 2000 characters`)).toBeVisible()
    await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
    await expect(replyStatus).toHaveText(announced)
  }

  /** The claim card as the Delegation Log draws it, with its controls. */
  const logCard = (key: string) => log.getByRole('article', { name: `Claim ${key}` })

  /** The run's charged clock, in milliseconds: exactly what the checks and escalations took. */
  async function chargedMs(): Promise<number> {
    const run = await readJson<{ clock: { chargedMs: number } | null }>(
      page.request,
      `/api/v1/runs/${runId}`,
    )
    expect(run.clock, 'the working clock should still be running').not.toBeNull()
    return run.clock?.chargedMs ?? -1
  }

  // One further request, raising three claims that are not C3. The announcement carries the count,
  // which is the same live region that said "One claim surfaced" a moment ago — the panel says how
  // many a reply produced, and never anything about which of them is worth looking at.
  await ask(SECOND_REQUEST, 'Reply complete. 3 claims surfaced.')
  for (const key of [TRACED_CLAIM_KEY, REJECTED_CLAIM_KEY, ESCALATED_CLAIM_KEY]) {
    await expect(logCard(key)).toBeVisible()
  }

  const beforeTrace = await chargedMs()

  // A stance, taken *before* the check, so that changing it afterwards is a change and not a first
  // answer. The control is a radio group with the five stances and no default (FR-080).
  const traced = logCard(TRACED_CLAIM_KEY)
  const stances = traced.getByRole('radiogroup', {
    name: `Your stance on claim ${TRACED_CLAIM_KEY}`,
  })
  await expect(stances.getByRole('radio')).toHaveCount(5)
  await stances.getByRole('radio', { name: 'Accept' }).click()
  await expect(stances.getByRole('radio', { name: 'Accept' })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  // The Source Trace: one minute of the clock, and the document, passage, date and author the
  // author wrote for it (FR-070, FR-071). The menu offers what the claim's verification paths
  // answer and nothing else, with the cost in front of the press.
  await traced.getByRole('button', { name: `Check claim ${TRACED_CLAIM_KEY}` }).click()
  const menuItem = page.getByRole('menuitem', { name: /Source Trace/ })
  await expect(menuItem).toContainText('1 min')
  await menuItem.click()

  const result = page.getByRole('dialog')
  await expect(result).toBeVisible()
  await expect(result).toContainText(`Source Trace on claim ${TRACED_CLAIM_KEY}`)
  for (const label of ['Document', 'Passage', 'Date', 'Author']) {
    await expect(result).toContainText(label)
  }
  // The passage is the author's, character for character, and nothing is added to it (FR-073).
  await expect(result).toContainText(TRACED_PASSAGE)
  await expect(result).toContainText(TRACED_AUTHOR)
  await expect(result).toContainText('This check cost one minute of your working clock.')
  await page.keyboard.press('Escape')
  await expect(result).toBeHidden()

  await expect
    .poll(chargedMs, { message: 'a Source Trace charges one minute (FR-070)' })
    .toBe(beforeTrace + 60_000)

  // The stance changes after the check, which is the move FR-085 exists to record. Both are kept.
  await stances.getByRole('radio', { name: 'Challenge' }).click()
  await expect(stances.getByRole('radio', { name: 'Challenge' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(traced).toContainText('Changed from Accept.')

  // Reject, on the low-stakes claim the same reply raised.
  const rejected = logCard(REJECTED_CLAIM_KEY)
  const rejectedStances = rejected.getByRole('radiogroup', {
    name: `Your stance on claim ${REJECTED_CLAIM_KEY}`,
  })
  await rejectedStances.getByRole('radio', { name: 'Reject' }).click()
  await expect(rejectedStances.getByRole('radio', { name: 'Reject' })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  // The escalation: one sentence, five minutes, and the colleague's reply verbatim (FR-090).
  const escalated = logCard(ESCALATED_CLAIM_KEY)
  const beforeEscalation = await chargedMs()

  await escalated.getByRole('button', { name: `Escalate claim ${ESCALATED_CLAIM_KEY}` }).click()
  const escalation = page.getByRole('dialog')
  await expect(escalation).toContainText('Escalate to a colleague')
  // The count is a fact about the run and is the same on every claim, which is what keeps it from
  // saying anything about this one (D-244).
  await expect(escalation).toContainText('You have 2 escalations left in this run.')
  await escalation.getByLabel('What you cannot settle').fill(STATEMENT)
  await escalation.getByRole('button', { name: 'Send it' }).click()
  await expect(escalation).toBeHidden()

  await expect(escalated).toContainText('They answered')
  await expect(escalated).toContainText(ESCALATION_REPLY)
  await expect(escalated).toContainText('This escalation cost 5 minutes of your working clock.')

  await expect
    .poll(chargedMs, { message: 'an escalation charges five minutes (FR-090)' })
    .toBe(beforeEscalation + 300_000)

  // Nothing on screen says whether the reply was the one the author wrote for this claim or the
  // version's general one, and nothing says whether it counted (D-116). The student's own read of
  // the claim carries neither field.
  const escalatedClaims = await readJson<Record<string, unknown>[]>(
    page.request,
    `/api/v1/runs/${runId}/claims`,
  )
  const escalatedClaim = escalatedClaims.find((entry) => entry.key === ESCALATED_CLAIM_KEY)
  expect(escalatedClaim?.escalation).toMatchObject({ clockCostMs: 300_000 })
  const reply = escalatedClaim?.escalation as Record<string, unknown>
  expect(reply).not.toHaveProperty('responseId')
  expect(reply).not.toHaveProperty('countsAgainstLimit')

  // -------------------------------------------------------------------------------------------
  // What part 2 recorded (FR-007, 10 §10)
  // -------------------------------------------------------------------------------------------

  const afterWork = await traceOf(page, runId)

  // Both stances on the traced claim are on the record, in order, and the second names the first:
  // "traced it, then changed my mind" is a thing this trace can show (FR-085).
  const tracedClaimId = (
    escalatedClaims.find((entry) => entry.key === TRACED_CLAIM_KEY) as { id: string }
  ).id
  const stanceEvents = afterWork.filter(
    (event) => event.type === 'stance_set' && event.payload.claim_id === tracedClaimId,
  )
  expect(stanceEvents).toHaveLength(2)
  expect(stanceEvents[0]?.payload).toMatchObject({ stance: 'accept', previous_stance: null })
  expect(stanceEvents[1]?.payload).toMatchObject({
    stance: 'challenge',
    previous_stance: 'accept',
  })
  // The check ran before the change, and the change knows it did: `action_ids` is every action run
  // on the claim before the stance, which is what makes the two rows different in the debrief.
  const action = onlyEvent(afterWork, 'action')
  expect(action.payload).toMatchObject({
    claim_id: tracedClaimId,
    type: 'source_trace',
    clock_cost_ms: 60_000,
  })
  expect(stanceEvents[1]?.payload.action_ids).toEqual([action.payload.action_id])
  expect(action.seq).toBeGreaterThan(stanceEvents[0]?.seq ?? 0)
  expect(action.seq).toBeLessThan(stanceEvents[1]?.seq ?? 0)

  // The escalation, its statement, and its five minutes.
  const escalationEvent = onlyEvent(afterWork, 'escalation')
  expect(escalationEvent.payload).toMatchObject({
    statement: STATEMENT,
    clock_cost_ms: 300_000,
    in_turn_window: false,
  })

  // And the two stances step 6 asks for by name, on two different claims.
  const stanceValues = afterWork
    .filter((event) => event.type === 'stance_set')
    .map((event) => event.payload.stance)
  expect(stanceValues).toContain('challenge')
  expect(stanceValues).toContain('reject')

  await signOut(page)
})
