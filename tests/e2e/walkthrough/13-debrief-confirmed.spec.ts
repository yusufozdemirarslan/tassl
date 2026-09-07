// Step 13 of the walkthrough (PRD §12): **the student reads the confirmed debrief** (UI-028,
// FR-150 to FR-155, FR-004).
//
// Step 11's spec proves the draft half — a debrief inside ten minutes of the lock with every band
// marked draft and the provisional points labelled draft. This one is the same page after the
// instructor has read the run, and what it proves is what the second reading adds:
//
//   **The confirmed band replaces the draft in place**, with the note the instructor wrote. Not a
//   second page, not a second section, not the draft with a confirmation beside it: one document
//   read twice (FR-150). The amber Draft chip is gone from every dimension and the note is under
//   the dimension it belongs to.
//
//   **The twelve sections are in the order the run happened** (FR-151), and the four that this run
//   can only support because it delegated are in them: the missed defect with the document behind
//   it and the check that would have shown it, the confidence line, the Turn beside the frozen
//   frame, and the clock. A section a run cannot support is named with its reason rather than
//   dropped (FR-155), and the assertion below is against `DEBRIEF_SECTION_ORDER` itself, so a
//   reordering of the product rule fails here.
//
//   **At least one thing this run did is named** (FR-153). The service's ladder always returns a
//   sentence; the section that draws it has no empty state to fall into and this is where that is
//   checked against a real run rather than a fixture.
//
//   **Answering the two questions moves the run to `recorded`** (FR-152) — and the answers stay,
//   read back as prose with the date, with the form gone.
//
//   **Nothing on the page is the reviewer's.** No quote, no evidence sequence, no name of who
//   decided a band, and no word of the three vocabularies the catalogue is scanned for. The sweep
//   runs over the student's own API payload with real data in it, because a sweep whose fixture is
//   empty passes vacuously.
//
// WHAT THIS SPEC CANNOT YET ASSERT, AND WHY IT IS NOT ASSERTED AROUND
//
// FR-055's other half is that a marked exchange is left out of the Delegation read (10 §11.3), and
// that is where the mark stops today. `scoring/reads.ts` filters `delegation` **events** on
// `payload.flags`, and `assistant.flagDelegation` writes the mark to the `run_delegations` **row**
// — the event was written when the exchange happened and carries the guard's flags alone. So the
// filter is unreachable from the product: `tests/unit/scoring/reads.test.ts` proves it excludes a
// delegation whose event carries the flag, and nothing puts the flag there. This spec therefore
// asserts the half that is real — the control, its copy, the mark on the reviewer's record, and its
// absence from the student's — and does not assert the band's reason around a gap. The fix belongs
// where the read is built, not on this screen: `scoring` should take the flagged delegation ids from
// `run_delegations` alongside the events, the way it already takes the package and the variant
// states, and `facts.ts` and `reads.ts` should filter on that.
//
// **The run delegates once, on purpose.** Every other endpoint-driven run in this suite is
// assistant-free, for D-026's ten delegations a minute; this one has to have a defect its filed
// decision rested on, and reliance is recorded by a log mark on a delegation the student made
// (FR-060, FR-084). One request, one mark, one stance: `C3` is the seeded package's planted claim,
// "premium payback" is the first of its authored trigger phrases (D-030), and accepting it is
// exactly the walkthrough's own defective session.
import type { APIRequestContext } from '@playwright/test'
import { expect, seatEmail, signInAs, signOut, test, type Seat } from '../fixtures'
import { addSectionMember, createStudentAssignment, signInAsInstructor } from '../instructor/api'
import {
  answerEveryQuestion,
  BRIEF,
  confirmEveryBand,
  FRAME,
  myAssignment,
  PAST_THE_TURN_MS,
  post,
  put,
  readJson,
  SCORING_TIMEOUT_MS,
  TURN_RESPONSE,
  WRITE_HEADERS,
} from './scored-run'
import { findForbiddenKeys } from '@/server/auth/student-view'
import { DEBRIEF_SECTION_ORDER } from '@/server/modules/debrief/schema'

/**
 * The seat this run is taken in.
 *
 * `student2` is spec 12's seat as well, and the two share it for the reason specs 11 and 14 share
 * `editor`: there are five seeded seats, four of them already spoken for, and an endpoint-driven
 * run spends about fifteen writes in a few seconds against D-026's sixty a minute per user. Both
 * lanes wait a refusal out rather than failing on it (`scored-run.ts`'s `write`), so contention
 * costs time and not a red run.
 */
const STUDENT_SEAT: Seat = 'student2'

/** `07-api-spec.md` §7's own example body; "premium payback" is claim C3's first trigger phrase. */
const DELEGATION_REQUEST = 'What is the premium payback?'

/** The seeded package's planted claim, by the key the author gave it. */
const PLANTED_CLAIM_KEY = 'C3'

/** The one line a student writes about why they asked (FR-060). */
const WHY = 'I needed the payback figure the upmarket case rests on.'

/** The note the instructor writes on the band the student then reads (FR-182). */
const OVERRIDE_NOTE = 'Read against the Source Trace on the payback figure.'

const ANSWERS = {
  stanceToChange:
    'I would verify the premium payback figure instead of accepting it, because nothing dated after the board deck confirms it.',
  doDifferently:
    'I would run a Source Trace on every figure the recommendation rests on before I write the brief.',
}

/**
 * Words the debrief may not use about a person or a comparison (FR-131, FR-153, PRD §7).
 *
 * Phrases where a bare word would collide with the scenario's own language: the Meridian Roast
 * package is about subscriber retention and says "cohort" thirty times in its documents and claims,
 * and the debrief quotes those documents. The catalogue itself is scanned word by word, on word
 * boundaries and with no allowlist, by `tests/unit/debrief/assembly.test.ts` and
 * `tests/unit/lib/review-voice.test.ts`; what this list is for is the *rendered page*, where the
 * authored material and the generated sentences are side by side. It is the same list
 * `12-faculty-replay.spec.ts` uses on the replay, for the same reason.
 */
const FORBIDDEN_WORDS = ['percentile', 'rank', 'cohort average', 'composite score']

type ClaimRow = { id: string; key: string; inTurnWindow: boolean }
type DelegationRow = { id: string; claims: { id: string; key: string }[] }
type DebriefSectionRow = { key: string; available: boolean; reason: string | null }
type DebriefBandRow = {
  dimension: string
  band: string | null
  decision: string | null
  note: string | null
  rationale: string
}
type DebriefRow = {
  sections: DebriefSectionRow[]
  bands: DebriefBandRow[]
  points: { draft: number | null; confirmed: number | null }
  questions: { answered: boolean; canAnswer: boolean }
  doneWell: string
  labels: { version: string }
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
 * The run of the defective session: framed, one delegation, the planted claim accepted and leaned
 * on, locked, answered, scored.
 */
async function driveDefectiveRun(api: APIRequestContext, assignmentId: string): Promise<string> {
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

  // One delegation. The answer is a stream and its body is not this spec's subject — what the
  // delegation is here for is the claim it surfaces and the mark that records reliance on it — so
  // it is consumed and dropped, and the log is read back through the documented list endpoint.
  const streamed = await api.post(`/api/v1/runs/${runId}/delegations`, {
    data: { request: DELEGATION_REQUEST },
    headers: WRITE_HEADERS,
  })
  expect(streamed.status(), await streamed.text()).toBe(200)

  const log = await readJson<DelegationRow[]>(api, `/api/v1/runs/${runId}/delegations`)
  expect(log, 'the request should have been logged').toHaveLength(1)
  const delegation = log[0] as DelegationRow
  const planted = delegation.claims.find((claim) => claim.key === PLANTED_CLAIM_KEY)
  expect(
    planted,
    `"${DELEGATION_REQUEST}" should surface ${PLANTED_CLAIM_KEY} on D-030's phrase rule`,
  ).toBeDefined()

  // Accept it, then mark it used: the stance first, because the Decision Lock refuses a relied-on
  // claim that carries none (FR-084) and this spec is not about that gate.
  await put(api, `/api/v1/runs/${runId}/claims/${(planted as { id: string }).id}/stance`, {
    stance: 'accept',
  })
  const marked = await api.patch(`/api/v1/runs/${runId}/delegations/${delegation.id}`, {
    data: { why: WHY, usedClaimIds: [(planted as { id: string }).id] },
    headers: WRITE_HEADERS,
  })
  expect(marked.status(), await marked.text()).toBe(200)

  await post(api, `/api/v1/runs/${runId}/lock`, BRIEF)
  await post(api, `/api/v1/test/runs/${runId}/advance-clock`, { ms: PAST_THE_TURN_MS })

  const claims = await readJson<ClaimRow[]>(api, `/api/v1/runs/${runId}/claims`)
  for (const claim of claims.filter((row) => row.inTurnWindow)) {
    await put(api, `/api/v1/runs/${runId}/claims/${claim.id}/stance`, { stance: 'verify' })
  }
  await post(api, `/api/v1/runs/${runId}/turn/response`, TURN_RESPONSE)

  await answerEveryQuestion(api, runId)
  return runId
}

/** The defense filed, and the run followed to `scored`. */
async function completeAndScore(api: APIRequestContext, runId: string): Promise<void> {
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
      { timeout: SCORING_TIMEOUT_MS, message: 'the finished defense hands the run to scoring' },
    )
    .toBe('scored/done')
}

test('walkthrough step 13: the confirmed debrief replaces the drafts in place, and answering the two questions records the run', async ({
  page,
  request,
}) => {
  // A full run driven to scored, confirmed, and then read through the screen is well past
  // Playwright's default patience on a loaded machine (D-188). The assertions are unchanged.
  test.setTimeout(600_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Confirmed debrief',
    studentEmail: seatEmail(STUDENT_SEAT),
    variant: 'defective',
  })
  await addSectionMember(request, assignment.section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  // -------------------------------------------------------------------------------------------
  // A scored run whose filed decision rested on the planted defect
  // -------------------------------------------------------------------------------------------

  await signInAs(page, STUDENT_SEAT)
  const mine = await myAssignment(page.request, assignment.label)
  const runId = await driveDefectiveRun(page.request, mine.assignmentId)

  await signOut(page)

  // -------------------------------------------------------------------------------------------
  // FR-055: a reviewer marks the exchange out of scenario, from the log where they read it
  //
  // Before the defense is filed, so the exclusion is observable: `scoring/reads.ts` reads the
  // Delegation band over the exchanges that remain (10 §11.3), and the band's own recorded reason
  // then says so. The mark is one act, it is a note about the material, and the copy beside it says
  // nothing about the student — which is asserted here as the absence of a whole vocabulary rather
  // than as the presence of a sentence.
  // -------------------------------------------------------------------------------------------

  await signInAs(page, 'instructor')
  await page.goto(`/review/runs/${runId}?tab=overview`)
  const log = page.locator('#replay-log')
  await expect(log.getByRole('heading', { level: 3, name: 'Delegation 1' })).toBeVisible()

  // The copy beside the control, in full. The whole `review.` catalogue is scanned word by word for
  // the three vocabularies, on word boundaries and with no allowlist, by
  // `tests/unit/lib/review-voice.test.ts`; what belongs here is that the sentence a reviewer
  // actually reads before pressing is the one that says the mark is about the material.
  await expect(
    log.getByText(
      'It is a note about the material. The student is not told, and nothing is taken away from them.',
    ),
  ).toBeVisible()

  await log.getByRole('button', { name: 'Mark as outside the scenario' }).click()
  await expect(
    log.getByText('A reviewer marked this request as outside the scenario.'),
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    log.getByText('This exchange is already marked, and a mark is recorded once.'),
  ).toBeVisible()
  await expect(log.getByRole('button', { name: 'Mark as outside the scenario' })).toHaveCount(0)

  // And it is on the record the reviewer reads it from: `run_delegations.flags` carries the mark,
  // and the replay is the one payload in the product that shows it.
  const replay = await readJson<{ delegations: { id: string; flags?: string[] }[] }>(
    request,
    `/api/v1/review/runs/${runId}`,
  )
  expect(replay.delegations[0]?.flags).toContain('out_of_scenario')

  await signOut(page)

  // -------------------------------------------------------------------------------------------
  // The run is scored with the mark in place
  // -------------------------------------------------------------------------------------------

  await signInAs(page, STUDENT_SEAT)
  await completeAndScore(page.request, runId)

  // The draft half, from the student's own payload: every band a draft, no confirmed figure.
  const draft = await readJson<DebriefRow>(page.request, `/api/v1/runs/${runId}/debrief`)
  expect(draft.labels.version).toBe('draft')
  expect(draft.bands.every((band) => band.decision === null)).toBe(true)
  expect(draft.points.confirmed).toBeNull()

  // And the student's own copy of the log carries no `flags` key: the mark changed the Delegation
  // band's recorded reason and nothing else about what they can read. It is read here rather than
  // before the mark because the run's record is sealed to its own student until it is scored
  // (D-279) — which is itself the first half of the same rule.
  const ownLog = await readJson<DelegationRow[]>(page.request, `/api/v1/runs/${runId}/delegations`)
  expect(ownLog, 'the one delegation this run made').toHaveLength(1)
  expect(Object.keys(ownLog[0] as object)).not.toContain('flags')
  expect(ownLog[0]?.claims.some((claim) => claim.key === PLANTED_CLAIM_KEY)).toBe(true)

  await signOut(page)

  // -------------------------------------------------------------------------------------------
  // The instructor decides one band with a note, then confirms the rest (FR-181, FR-182)
  // -------------------------------------------------------------------------------------------

  await signInAsInstructor(request)
  const draftVerification = draft.bands.find((band) => band.dimension === 'verification')
  const overrideTo = draftVerification?.band === 'professional' ? 'proficient' : 'professional'
  await put(request, `/api/v1/review/runs/${runId}/bands/verification`, {
    decision: 'overridden',
    band: overrideTo,
    note: OVERRIDE_NOTE,
  })
  await confirmEveryBand(request, runId)

  // -------------------------------------------------------------------------------------------
  // The student reads the same page again (FR-150, FR-154)
  // -------------------------------------------------------------------------------------------

  await signInAs(page, STUDENT_SEAT)
  const confirmed = await readJson<DebriefRow>(page.request, `/api/v1/runs/${runId}/debrief`)
  expect(confirmed.labels.version).toBe('confirmed')
  expect(confirmed.bands.every((band) => band.decision !== null)).toBe(true)
  expect(
    confirmed.points.confirmed,
    'the confirmed figure exists once every band is decided',
  ).not.toBe(null)

  // The twelve sections, in the order the module fixes; each one either drawn or named with a
  // reason (FR-151, FR-155).
  expect(confirmed.sections.map((section) => section.key)).toEqual([...DEBRIEF_SECTION_ORDER])
  for (const section of confirmed.sections) {
    if (!section.available) {
      expect(section.reason, `${section.key} is not drawn and must say why`).toBeTruthy()
    }
  }

  // The four sections this run has to be able to support, because it delegated and locked and
  // answered the Turn.
  for (const key of ['missed_defects', 'confidence_line', 'turn_beside_frame', 'clock_timeline']) {
    const section = confirmed.sections.find((row) => row.key === key)
    expect(section?.available, `${key} should be drawn on this run`).toBe(true)
  }

  // Nothing on this page is the reviewer's, and the sweep runs over a payload with real content in
  // it rather than an empty one.
  expect(confirmed.bands.length).toBe(7)
  expect(findForbiddenKeys(confirmed, { scored: true })).toEqual([])
  const keys = keysAtAnyDepth(confirmed).map((entry) => entry.key)
  for (const key of ['quotes', 'evidenceEventSeqs', 'evidence_event_seqs', 'decidedBy']) {
    expect(keys, `the student's debrief must not carry ${key}`).not.toContain(key)
  }

  // -------------------------------------------------------------------------------------------
  // On the screen (UI-028)
  // -------------------------------------------------------------------------------------------

  await page.goto(`/runs/${runId}/debrief`)
  await expect(page.getByRole('heading', { level: 1, name: 'Run Debrief' })).toBeVisible()

  // The confirmed band is in place of the draft: the amber chip is gone from every dimension and
  // the instructor's note is under the dimension it belongs to.
  const verification = page.locator('#band-verification')
  await expect(verification.getByText('Confirmed band')).toBeVisible()
  await expect(page.locator('#debrief-bands').getByText('Draft band')).toHaveCount(0)
  await expect(verification.getByText(OVERRIDE_NOTE)).toBeVisible()
  await expect(
    verification.getByText('Your instructor decided this dimension differently.'),
  ).toBeVisible()

  // The sections that carry the run, in the order the API listed them.
  const rendered = await page
    .locator('section[id^="debrief-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.id))
  expect(rendered).toEqual(
    DEBRIEF_SECTION_ORDER.map((key) => `debrief-${key.replaceAll('_', '-')}`),
  )

  // The missed defect, with the document behind it and the check that would have shown it.
  const defects = page.locator('#debrief-missed-defects')
  await expect(defects.getByRole('heading', { name: `Claim ${PLANTED_CLAIM_KEY}` })).toBeVisible()
  // By role, not by text: the section's own description sentence names the check as well, and a
  // substring match resolves to both.
  await expect(defects.getByRole('heading', { name: 'Where it came from' })).toBeVisible()
  await expect(
    defects.getByRole('heading', { name: 'The check that would have shown it' }),
  ).toBeVisible()

  // The confidence line, the Turn beside the frozen frame, the clock, the counterfactual.
  await expect(
    page.locator('#debrief-confidence-line').getByRole('heading', { name: 'Confidence line' }),
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    page.locator('#debrief-turn-beside-frame').getByText(TURN_RESPONSE.justification),
  ).toBeVisible()
  await expect(
    page.locator('#debrief-clock-timeline').getByRole('heading', { name: 'Clock timeline' }),
  ).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('#debrief-counterfactual')).toContainText(
    'Written by the scenario’s author',
  )

  // At least one thing this run did (FR-153).
  await expect(page.locator('#debrief-done-well')).toContainText(confirmed.doneWell)

  // The course's arithmetic, labelled confirmed rather than draft.
  const points = page.locator('#debrief-points')
  await expect(points.getByText('Confirmed points')).toBeVisible()
  await expect(points.getByText('Provisional points, draft')).toHaveCount(0)

  // No word about the person or the cohort, anywhere on the page (FR-131, FR-153).
  const pageText = ((await page.locator('main').textContent()) ?? '').toLowerCase()
  for (const word of FORBIDDEN_WORDS) {
    expect(pageText, `the debrief must not say "${word}"`).not.toContain(word)
  }

  // -------------------------------------------------------------------------------------------
  // The two questions close the run (FR-152)
  // -------------------------------------------------------------------------------------------

  const questions = page.locator('#debrief-questions')
  await questions
    .getByLabel('Which single stance would you change, and to what?')
    .fill(ANSWERS.stanceToChange)
  await questions
    .getByLabel('What will you do differently in the next run like this?')
    .fill(ANSWERS.doDifferently)
  await questions.getByRole('button', { name: 'File both answers' }).click()

  await expect(questions.getByText(ANSWERS.stanceToChange)).toBeVisible({ timeout: 20_000 })
  await expect(questions.getByText(ANSWERS.doDifferently)).toBeVisible()
  await expect(questions.getByRole('button', { name: 'File both answers' })).toHaveCount(0)

  await expect
    .poll(
      async () => {
        const run = await readJson<{ state: string }>(page.request, `/api/v1/runs/${runId}`)
        return run.state
      },
      { timeout: 20_000, message: 'FR-152: answering the two questions records the run' },
    )
    .toBe('recorded')

  await signOut(page)
})
