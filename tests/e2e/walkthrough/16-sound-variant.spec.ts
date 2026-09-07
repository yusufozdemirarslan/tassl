// Step 16 of the walkthrough (PRD §12): **steps 2 to 14 again, on the sound variant, with the seats
// swapped** (FR-251, FR-004, FR-134).
//
// The other twelve walkthrough specs take the defective variant, in `student1`'s seat for the run
// screens and the instructor's for the replay. This one is the second live session PRD §12's
// "Definition of done" asks for: the other variant, and the other pair of seats — `student2` takes
// the run and the instructor reads it. Step 7 is not repeated here; the PRD exercises the forced
// failure, the package view, the corrections and the standing rules once each, and `07`, `01`, `15`
// and `17` own them.
//
// What the sound variant changes, and what this spec is therefore for:
//
//   **A sound consequential claim, accepted without checking, is scored as the stance the material
//   warranted.** PRD §12 is precise about which claim may carry that: §7.8 gives a *sound* claim a
//   warranted stance of Verify when it is load-bearing, high-consequence or cheap to check, so the
//   confirmed package must carry at least one sound consequential claim warranting **Accept**, and
//   that is the claim this step uses. In the seeded Meridian Roast version that is `C1`, the value
//   tier payback: load-bearing, sound in both variants, warranted `accept`
//   (`validatePackage`'s `NO_ACCEPT_WARRANTED_SOUND` rule is what keeps it that way). The student
//   asks for it, accepts it, runs no interrogation action on it, and leans the filed decision on it.
//   The debrief then says, in the student's own words: your stance Accept, warranted Accept, the two
//   are the same — which is the demonstration that Tassl teaches calibration and not distrust.
//
//   Accepting it is *not* the same act as accepting the re-skinned planted claim, and the spec
//   asserts that separation: `C3` on this variant is authored sound and warrants Verify, the Turn
//   raises it, and this run stances it Verify. It is a match too, and it is not the one step 16 is
//   about.
//
//   **A variant with no planted defect has nothing to name in the missed-defect section**, so the
//   section is drawn with its reason rather than dropped (FR-155). That is the one section of the
//   twelve whose availability differs between the two variants, and it is the sound variant that can
//   prove the named absence with real data behind it.
//
// **What is driven through the screen, and what is not.** Every step below is taken in the browser
// where the browser is what the step is about: the policy display, the Evidence Room, the frame, the
// delegation and the stance, the brief and its lock, the Turn, the finish of the defense, both
// readings of the debrief, the faculty confirmation, the export history and the record. The two
// places this spec calls the documented endpoints instead are the sixteen readiness answers and the
// defense answers after the first — sixteen radio presses and eight typed paragraphs the sibling
// specs already prove on screen (`02-05`, `10`), which here would add minutes per browser project
// for a starting position rather than an assertion. Nothing is done behind the screen that a student
// could not do from it.
import { expect, seatEmail, signInAs, signOut, test, type Seat } from '../fixtures'
import { addSectionMember, createStudentAssignment, signInAsInstructor } from '../instructor/api'
import { PAST_THE_TURN_MS, post, put, readJson, SCORING_TIMEOUT_MS } from './scored-run'
import { findForbiddenKeys } from '@/server/auth/student-view'

/** PRD §12 step 16: seats swapped. `student2` takes the run; the instructor reads it. */
const STUDENT_SEAT: Seat = 'student2'

/**
 * The sound consequential claim whose authored warranted stance is Accept, and the request that
 * raises it.
 *
 * "value tier payback" is `C1`'s first authored trigger phrase and matches no other claim in the
 * package under D-030's two rules: `C3`'s "payback period" wants a token this request does not
 * carry, `C8`'s phrases want "growth" or "out of room", and `C1`'s other two phrases want
 * "acquisition" or "cost". So "one claim surfaced" below is an assertion about surfacing rather
 * than about wording.
 */
const SOUND_CLAIM_KEY = 'C1'
const SOUND_REQUEST = 'What is the value tier payback?'

/** The claim the Turn raises on both variants; sound here, and warranting Verify. */
const RESKINNED_CLAIM_KEY = 'C3'

/** The one line a student writes about why they asked (FR-060). */
const WHY = 'I need the value tier payback before I can compare the two tiers at all.'

const FRAME = {
  decision:
    'Hold the current split between the value and premium tiers this quarter and fund the upmarket case only where the tier economics already carry it.',
  assumptions: [
    'The value tier keeps returning its acquisition cost at the rate the last three cohorts recorded.',
    'Roastery capacity absorbs the current premium volume without new equipment this quarter.',
    'No competitor repositions against the value tier inside the quarter.',
  ],
  position:
    'I lean towards holding the split. The value tier is the one whose economics the room actually dates, and moving budget away from it would put the acquisition plan behind the tier with the thinner evidence.',
  confidence: '54',
} as const

const BRIEF = {
  recommendation:
    'Hold the value tier at its current share of acquisition spend for one more quarter and fund the premium push only from the margin it earns.',
  rationale:
    'The value tier returns its acquisition cost inside a quarter and the figure is dated after the freight change, so it is the part of the plan the room can stand behind. The premium case rests on numbers that are still moving.',
  assumptions: [
    'Value acquisition holds at its current blended cost.',
    'Roastery capacity absorbs current premium volume.',
    'No competitor repositions inside the quarter.',
  ],
  changeMyMind:
    'A premium contribution figure, dated after the freight change, that beats the value tier on payback.',
  confidence: '58',
} as const

const TURN_JUSTIFICATION =
  'The retention figure the premium case was priced on has been corrected by the person who was quoting it, so I am moving the share down and keeping the direction of the decision.'
const TURN_CONFIDENCE = '46'

/** Each carries a digit and a reason marker, so none earns the follow-up (FR-123, D-031). */
const DEFENSE_ANSWERS = [
  'I priced this on the value tier returning 96 dollars of acquisition cost in about 4 months, because that is the figure in the room that is dated after the freight change.',
  'I did not settle the premium side, because the 1 number it rests on has been revised twice and nothing dates the current one, so I filed the decision that survives either answer.',
  'I moved my confidence to 46 because the person who quoted the retention figure corrected it, and the share I had sized was priced on the old one.',
] as const

const DEBRIEF_ANSWERS = {
  stanceToChange:
    'I would verify the premium retention figure rather than leaving it, because the whole upmarket case is priced on it.',
  doDifferently:
    'I would run a Source Trace on every figure the recommendation rests on before I write the brief around it.',
}

/**
 * The two exemptions FR-170 itself names, verbatim from `14-export-record.spec.ts`, which is where
 * the whole record document is swept: the three plotted readings of FR-132's confidence line (D-439)
 * and the option the *student* chose on a readiness item, which is not the item's answer key (D-370).
 */
const CONFIDENCE_LINE_POINTS = /(^|\.)confidence_line\.points(\[\d+\])?$/
const STUDENT_ANSWER_KEY = /^events\[\d+\]\.payload\.answer_key$/

/** The two recharts graphs arrive in a deferred chunk (16 §3.3, D-282), after the page. */
const GRAPH_TIMEOUT_MS = 20_000

/** A Server Action followed by `router.refresh()` on a machine running three browser projects. */
const ACTION_TIMEOUT_MS = 20_000

type ClaimRow = { id: string; key: string; text: string; inTurnWindow: boolean }
type TraceEvent = { seq: number; type: string; payload: Record<string, unknown> }
type DefenseQuestionRow = { runQuestionId: string; seq: number; text: string; answered: boolean }
type DebriefSectionRow = { key: string; available: boolean; reason: string | null }
type DebriefRow = {
  sections: DebriefSectionRow[]
  bands: { dimension: string; decision: string | null; note: string | null }[]
  points: { draft: number | null; confirmed: number | null }
  labels: { version: string }
}

test('walkthrough step 16: the sound variant, seats swapped — a sound claim accepted without checking is scored as the stance it warranted', async ({
  page,
  request,
}) => {
  // Steps 2 to 14 in one browser, then a faculty confirmation and two more screens. Long rather
  // than slow; the assertions are unchanged, only the patience (D-188).
  test.setTimeout(900_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Sound variant',
    studentEmail: seatEmail(STUDENT_SEAT),
    variant: 'sound',
  })
  await addSectionMember(request, assignment.section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  // The walkthrough's own condition for this session, read on the instructor's side and asserted
  // nowhere the student can see it: this run is the **other** variant.
  const configured = await readJson<{ variantKey: string }>(
    request,
    `/api/v1/assignments/${assignment.assignment.id}`,
  )
  expect(configured.variantKey, 'PRD §12 step 16 runs on the sound variant').toBe('sound')

  await signInAs(page, STUDENT_SEAT)

  // ===========================================================================================
  // Step 2 — Run start: the policy display (FR-201, UI-021)
  // ===========================================================================================

  await page.goto('/runs')
  await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
  const row = page.getByRole('row').filter({ hasText: assignment.label })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: `Start ${assignment.label}` }).click()

  await page.waitForURL(/\/runs\/[0-9a-f-]{36}\/start$/)
  const runId = new URL(page.url()).pathname.split('/')[2] as string

  await expect(page.getByRole('heading', { level: 1, name: 'Before you begin' })).toBeVisible()
  await expect(
    page.getByRole('heading', {
      level: 2,
      name: 'This run counts toward the course grade. Run one counts.',
    }),
  ).toBeVisible()
  await expect(page.locator('#run-mapping').getByRole('table')).toBeVisible()
  await expect(page.locator('#run-policy')).toContainText(
    'A declaration never lowers a band or a point.',
  )

  await page.getByRole('button', { name: 'Begin the Readiness Check' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/readiness$`))

  // ===========================================================================================
  // Step 3 — Readiness Check: the concept map, with no score and no rank (FR-010 to FR-018)
  //
  // The sixteen answers go through the endpoints the screen calls: which option is chosen is
  // arbitrary and must be — correctness is computed server-side and no response carries it
  // (FR-012) — and pressing sixteen radio groups is `02-05-start-to-frame.spec.ts`'s subject.
  // What is read on screen is the result, which is the step's own observable outcome.
  // ===========================================================================================

  await expect(page.getByRole('heading', { level: 1, name: 'Readiness Check' })).toBeVisible()
  const check = await readJson<{ items: { id: string; options: { key: string }[] }[] }>(
    page.request,
    `/api/v1/runs/${runId}/readiness`,
  )
  expect(check.items, 'FR-010: sixteen generated items').toHaveLength(16)
  for (const item of check.items) {
    await put(
      page.request,
      `/api/v1/runs/${runId}/readiness/answers/${item.id}`,
      { answerKey: item.options[0]?.key },
      204,
    )
  }
  await post(page.request, `/api/v1/runs/${runId}/readiness/submit`)

  await page.goto(`/runs/${runId}/readiness/result`)
  await expect(page.getByRole('heading', { level: 1, name: 'What the check read' })).toBeVisible()
  const concepts = page.locator('#readiness-concepts')
  expect(await concepts.getByRole('listitem').count()).toBeGreaterThanOrEqual(6)
  // No score, no total, no percentage, no rank — as the absence of any number at all (FR-012).
  expect(await concepts.innerText()).not.toMatch(/[0-9]/)

  // ===========================================================================================
  // Step 4 — Brief and Evidence Room, with the assistant locked (FR-020 to FR-024)
  // ===========================================================================================

  await page.getByRole('link', { name: 'Open the scenario' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/work$`))
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()

  const room = page.locator('#evidence-room')
  const documents = room.getByRole('listitem')
  await expect(documents).toHaveCount(9)
  const firstTitle = (await documents.first().getByRole('heading', { level: 3 }).innerText()).trim()
  await room.getByRole('button', { name: `Open ${firstTitle}` }).click()
  await expect(page.getByRole('article', { name: firstTitle })).toBeVisible()
  await room.getByRole('button', { name: `Close ${firstTitle}` }).click()

  await expect(page.locator('#assistant-panel')).toContainText(
    'The assistant unlocks the moment you lock your frame.',
  )

  // ===========================================================================================
  // Step 5 — the frame, locked irreversibly (FR-040 to FR-043)
  // ===========================================================================================

  await page.getByLabel('The decision').fill(FRAME.decision)
  for (const [index, assumption] of FRAME.assumptions.entries()) {
    await page.getByLabel(`Assumption ${String(index + 1)}`).fill(assumption)
  }
  await page.getByLabel('Your position now').fill(FRAME.position)
  await page.getByRole('spinbutton', { name: 'Confidence as a number' }).fill(FRAME.confidence)

  await page.getByRole('button', { name: 'Lock the frame' }).click()
  const frameConfirm = page.getByRole('alertdialog')
  await expect(frameConfirm).toContainText('Lock the frame permanently?')
  await frameConfirm.getByRole('button', { name: 'Lock it' }).click()

  await expect(page.locator('#locked-frame')).toContainText(FRAME.decision)
  await expect(page.locator('[data-state="working"]')).toBeVisible()

  // ===========================================================================================
  // Step 6 — the working period: the sound claim asked for, accepted, and leaned on, with no
  // interrogation action run on it (FR-051, FR-060, FR-080, FR-084)
  // ===========================================================================================

  const assistant = page.locator('#assistant-panel')
  const log = page.locator('#delegation-log')

  await assistant.getByLabel('Your request').fill(SOUND_REQUEST)
  // The live count is the panel's own state, so waiting for it is the proof that React owns the
  // field before the submit (the trap D-182 found in WebKit).
  await expect(
    assistant.getByText(`${String(SOUND_REQUEST.length)} of 2000 characters`),
  ).toBeVisible()
  await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
  await expect(assistant.locator('#assistant-reply-status')).toHaveText(
    'Reply complete. One claim surfaced.',
  )

  const soundCard = assistant.getByRole('article', { name: `Claim ${SOUND_CLAIM_KEY}` })
  await expect(soundCard).toBeVisible()

  // Accept, and nothing else: no Source Trace, no Replication Check, no Decomposition Check. The
  // menu that would run one is on the card and is deliberately not opened.
  const stances = soundCard.getByRole('radiogroup', {
    name: `Your stance on claim ${SOUND_CLAIM_KEY}`,
  })
  await expect(stances.getByRole('radio')).toHaveCount(5)
  await stances.getByRole('radio', { name: 'Accept' }).click()
  await expect(stances.getByRole('radio', { name: 'Accept' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  // The chip fills optimistically, so the announcement is what says the stance is on the record.
  await expect(page.locator('#run-announcer')).toHaveText(
    `Stance on claim ${SOUND_CLAIM_KEY}: Accept.`,
    { timeout: ACTION_TIMEOUT_MS },
  )

  // The filed decision rests on it, which is what makes the acceptance consequential (FR-084).
  // The why line is saved and *waited for* before the mark: the save ends in a `router.refresh()`,
  // and a press that lands inside it is a press against a control being re-rendered under it.
  const entry = log.getByRole('article', { name: 'Delegation 1', exact: true })
  await entry.getByLabel('Why you asked, delegation 1').fill(WHY)
  await entry.getByRole('button', { name: 'Save' }).click()
  await expect(entry.locator('p[id$="-status"]')).toHaveText('Saved.', {
    timeout: ACTION_TIMEOUT_MS,
  })
  await entry.getByRole('button', { name: `Mark claim ${SOUND_CLAIM_KEY} as used` }).click()
  await expect(entry).toContainText('You marked this claim used in the Delegation Log.', {
    timeout: ACTION_TIMEOUT_MS,
  })

  // ===========================================================================================
  // Step 8 — the Decision Brief and the lock (FR-100 to FR-102)
  // ===========================================================================================

  const editor = page.locator('#brief-editor-panel')
  await editor.getByLabel('Your recommendation').fill(BRIEF.recommendation)
  await editor.getByLabel('Why', { exact: true }).fill(BRIEF.rationale)
  for (const [index, assumption] of BRIEF.assumptions.entries()) {
    await editor.getByLabel(`Assumption ${String(index + 1)}`).fill(assumption)
  }
  await editor.getByLabel('What would change your mind').fill(BRIEF.changeMyMind)
  await editor.getByLabel('Confidence as a number').fill(BRIEF.confidence)

  await editor.getByRole('button', { name: 'Lock the decision' }).click()
  const lockConfirm = page.getByRole('alertdialog')
  await expect(lockConfirm).toContainText('File this decision?')
  await lockConfirm.getByRole('button', { name: 'File it' }).click()

  await page.waitForURL(new RegExp(`/runs/${runId}/locked$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Decision locked' })).toBeVisible()
  await expect(page.locator('#locked-brief')).toContainText(BRIEF.recommendation)

  // ===========================================================================================
  // Step 9 — the Turn (FR-110 to FR-115)
  //
  // `advance-clock` is the only honest way to reach a timer without waiting for it (D-109); nothing
  // in the browser decides that the Turn arrived, the next server render materializes it (D-042).
  // ===========================================================================================

  await post(page.request, `/api/v1/test/runs/${runId}/advance-clock`, { ms: PAST_THE_TURN_MS })
  await page.goto(`/runs/${runId}/locked`)
  await page.waitForURL(new RegExp(`/runs/${runId}/turn$`))
  await expect(page.getByRole('heading', { level: 1, name: 'The Turn' })).toBeVisible()

  // FR-111: every claim the window raised needs a stance. The re-skinned claim is one of them, and
  // it is stanced Verify — its own warranted stance on this variant, and a different act from the
  // acceptance step 16 is about.
  const windowClaims = (
    await readJson<ClaimRow[]>(page.request, `/api/v1/runs/${runId}/claims`)
  ).filter((claim) => claim.inTurnWindow)
  expect(windowClaims.length, 'the Turn should have raised claims').toBeGreaterThan(0)
  expect(
    windowClaims.some((claim) => claim.key === SOUND_CLAIM_KEY),
    'the Turn must not raise the claim this step accepts, or the blanket stance below would overwrite it',
  ).toBe(false)
  expect(
    windowClaims.some((claim) => claim.key === RESKINNED_CLAIM_KEY),
    'the Turn raises the re-skinned claim, which is the acceptance step 16 is **not** about',
  ).toBe(true)

  const turnCards = page.locator('#turn-claims')
  for (const claim of windowClaims) {
    const card = turnCards.getByRole('article', { name: `Claim ${claim.key}` })
    await card
      .getByRole('radiogroup', { name: `Your stance on claim ${claim.key}` })
      .getByRole('radio', { name: 'Verify' })
      .click()
    await expect(
      card.getByRole('radiogroup').getByRole('radio', { name: 'Verify' }),
    ).toHaveAttribute('aria-checked', 'true')
  }

  const form = page.locator('#turn-response')
  await form.getByRole('radio', { name: 'Revise' }).click()
  await form.getByLabel('Why', { exact: true }).fill(TURN_JUSTIFICATION)
  await form.getByLabel('Confidence as a number').fill(TURN_CONFIDENCE)
  await form.getByRole('button', { name: 'File the response' }).click()

  await page.waitForURL(new RegExp(`/runs/${runId}/defense$`))

  // ===========================================================================================
  // Step 10 — the defense (FR-120 to FR-126)
  //
  // The first answer is typed on screen; the rest go through the endpoint the screen calls, for the
  // reason the header gives. Finishing is a press, because the confirmation is what the step names.
  // ===========================================================================================

  await expect(page.getByRole('heading', { level: 1, name: 'The defense' })).toBeVisible()
  const artifacts = page.locator('#defense-artifacts')
  await expect(artifacts).toContainText(FRAME.decision)
  await expect(artifacts).toContainText(BRIEF.recommendation)
  await expect(page.locator('#assistant-panel'), 'FR-120: no assistant in the defense').toHaveCount(
    0,
  )
  await expect(page.locator('#evidence-room')).toHaveCount(0)

  const questions = page.locator('#defense-questions')

  // The first question, answered on screen — and then *waited for on the run* before the rest go
  // through the endpoint. The screen renders the answer as soon as the action resolves, which is a
  // render sooner than the list this spec is about to read: without the poll the endpoint loop below
  // met a question the browser had already answered and was refused `QUESTION_ALREADY_ANSWERED`.
  const opened = await readJson<{ questions: DefenseQuestionRow[] }>(
    page.request,
    `/api/v1/runs/${runId}/defense`,
  )
  const first = opened.questions.find((question) => !question.answered)
  expect(first, 'the interview opens with a question to answer').toBeDefined()
  const firstItem = questions
    .getByRole('listitem')
    .filter({ hasText: (first as DefenseQuestionRow).text })
    .last()
  await firstItem.getByLabel('Your answer').fill(DEFENSE_ANSWERS[0])
  await firstItem.getByRole('button', { name: 'Submit answer' }).click()
  await expect(questions).toContainText(DEFENSE_ANSWERS[0], { timeout: ACTION_TIMEOUT_MS })
  await expect
    .poll(
      async () =>
        (
          await readJson<{ questions: DefenseQuestionRow[] }>(
            page.request,
            `/api/v1/runs/${runId}/defense`,
          )
        ).questions.find(
          (question) => question.runQuestionId === (first as DefenseQuestionRow).runQuestionId,
        )?.answered,
      { timeout: ACTION_TIMEOUT_MS, message: 'the answer typed on screen reaches the record' },
    )
    .toBe(true)

  let answered = 1
  for (let pass = 0; pass < 3; pass += 1) {
    const defense = await readJson<{ questions: DefenseQuestionRow[] }>(
      page.request,
      `/api/v1/runs/${runId}/defense`,
    )
    const outstanding = defense.questions.filter((question) => !question.answered)
    if (outstanding.length === 0) break
    for (const question of outstanding) {
      await post(
        page.request,
        `/api/v1/runs/${runId}/defense/questions/${question.runQuestionId}/answer`,
        { text: DEFENSE_ANSWERS[answered % DEFENSE_ANSWERS.length], durationMs: 45_000 },
      )
      answered += 1
    }
  }
  expect(answered, 'FR-121: six to nine questions, plus any follow-up').toBeGreaterThanOrEqual(6)

  await page.reload()
  await questions.getByRole('button', { name: 'Finish the defense' }).click()
  const finish = page.getByRole('alertdialog')
  await expect(finish).toContainText('Finish the defense?')
  await finish.getByRole('button', { name: 'Finish it' }).click()

  // ===========================================================================================
  // Step 11 — scoring and the draft debrief (FR-130 to FR-140, FR-150)
  // ===========================================================================================

  await page.waitForURL(new RegExp(`/runs/${runId}$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Run status' })).toBeVisible()
  await expect(
    page.locator('#run-status').getByRole('heading', { level: 2, name: 'Your debrief is ready' }),
  ).toBeVisible({ timeout: SCORING_TIMEOUT_MS })

  // The run did what step 16 asked of it: the sound claim was accepted and nothing was run on it.
  const trace = await readJson<TraceEvent[]>(page.request, `/api/v1/runs/${runId}/trace`)
  const soundClaim = (
    await readJson<ClaimRow[]>(page.request, `/api/v1/runs/${runId}/claims`)
  ).find((claim) => claim.key === SOUND_CLAIM_KEY)
  expect(soundClaim, `${SOUND_CLAIM_KEY} should have been surfaced`).toBeDefined()
  const stanceEvents = trace.filter(
    (event) => event.type === 'stance_set' && event.payload.claim_id === soundClaim?.id,
  )
  expect(stanceEvents, 'one stance, taken once').toHaveLength(1)
  expect(stanceEvents[0]?.payload).toMatchObject({ stance: 'accept', previous_stance: null })
  expect(
    trace.filter((event) => event.type === 'action'),
    'PRD §12 step 16: the sound claim is accepted **without checking**, and this run checks nothing',
  ).toEqual([])

  const draft = await readJson<DebriefRow>(page.request, `/api/v1/runs/${runId}/debrief`)
  expect(draft.labels.version).toBe('draft')
  expect(draft.bands.every((band) => band.decision === null)).toBe(true)
  expect(draft.points.confirmed).toBeNull()

  await page.getByRole('link', { name: 'Read the debrief' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/debrief$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Run Debrief' })).toBeVisible()
  await expect(page.locator('#debrief-bands').getByText('Draft band')).toHaveCount(7)
  await expect(page.locator('#debrief-points').getByText('Provisional points, draft')).toBeVisible()

  await signOut(page)

  // ===========================================================================================
  // Step 12 — the faculty replay, in the other seat (FR-180 to FR-184)
  // ===========================================================================================

  await signInAs(page, 'instructor')
  await page.goto(`/review/runs/${runId}?tab=overview`)
  for (const title of [
    'Confidence line',
    'Clock timeline',
    'Stance matrix',
    'Frame beside decision',
  ]) {
    await expect(
      page.getByRole('heading', { name: title }),
      `UI-033 draws all four graphs; "${title}" is missing`,
    ).toBeVisible({ timeout: GRAPH_TIMEOUT_MS })
  }

  await page.goto(`/review/runs/${runId}?tab=bands`)
  await expect(page.getByText('0 of 7 decided')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm the remaining drafts' }).click()
  const shortcut = page.getByRole('alertdialog')
  await expect(shortcut.getByRole('heading', { name: /^Confirm the remaining/ })).toBeVisible()
  await shortcut.getByRole('button', { name: 'Put the remaining drafts on the record' }).click()
  await expect(page.getByText('7 of 7 decided')).toBeVisible({ timeout: ACTION_TIMEOUT_MS })

  const confirmed = await readJson<{
    run: { state: string; latestExportVersion: number | null }
    points: { confirmed: number | null }
  }>(request, `/api/v1/review/runs/${runId}`)
  expect(confirmed.run.state, 'the seventh decision confirms the run (FR-181)').toBe('confirmed')
  expect(confirmed.points.confirmed, 'the course’s arithmetic is written on confirmation').not.toBe(
    null,
  )
  expect(confirmed.run.latestExportVersion, 'confirmation writes export v1 (FR-184)').toBe(1)

  // ===========================================================================================
  // Step 14, part 1 — the assignment's export history, read in the seat that owns it (UI-035)
  // ===========================================================================================

  await page.goto(`/assignments/${assignment.assignment.id}/exports`)
  await expect(page.getByRole('heading', { level: 1, name: 'Course exports' })).toBeVisible()
  const exports = page.locator('#assignment-exports')
  await expect(exports.getByText('The bands were confirmed')).toBeVisible()
  await expect(exports.getByRole('link', { name: 'Download version 1' })).toBeVisible()

  await signOut(page)

  // ===========================================================================================
  // Step 13 — the confirmed debrief, and the claim this whole step exists for (FR-150 to FR-155)
  // ===========================================================================================

  await signInAs(page, STUDENT_SEAT)
  await page.goto(`/runs/${runId}/debrief`)
  await expect(page.getByRole('heading', { level: 1, name: 'Run Debrief' })).toBeVisible()
  await expect(page.locator('#debrief-bands').getByText('Confirmed band')).toHaveCount(7)
  await expect(page.locator('#debrief-bands').getByText('Draft band')).toHaveCount(0)

  // ------- the sound claim, in the student's own words -------
  const matrix = page.locator('#debrief-stance-matrix')
  const soundRow = matrix.getByRole('article', { name: `Claim ${SOUND_CLAIM_KEY}` })
  await expect(soundRow).toBeVisible()
  // The two chips, each of which names its own column in an sr-only span for a reader who meets it
  // alone (DESIGN.md's Labelled-Stance Rule). Asserted as text the row contains rather than as a
  // located element: the visible label and the spoken one nest, so a text locator would resolve to
  // the chip, its wrapper and the row all at once.
  await expect(soundRow).toContainText('Your stance Accept')
  await expect(soundRow).toContainText('Warranted Accept')
  await expect(soundRow.getByText('Same', { exact: true })).toBeVisible()
  await expect(soundRow).toContainText('This variant authored the claim as sound.')
  await expect(soundRow).toContainText('You took the stance Accept.')
  await expect(soundRow).toContainText('The material warranted Accept.')
  await expect(soundRow).toContainText('The two are the same.')
  await expect(soundRow).toContainText('Your filed decision rested on this claim.')
  await expect(
    soundRow,
    'PRD §12 step 16: it was accepted without checking, and the debrief says so',
  ).toContainText('No interrogation action was run on this claim.')

  // ------- and the same fact in the graph the band is read from (FR-134) -------
  await matrix.getByRole('button', { name: 'Show data table' }).click()
  const table = matrix.getByRole('table')
  await expect(table).toBeVisible()
  const cells = await table
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: SOUND_CLAIM_KEY, exact: true }) })
    .first()
    .getByRole('cell')
    .allInnerTexts()
  expect(cells[0]?.trim(), 'the row this run’s sound claim stands on').toBe(SOUND_CLAIM_KEY)
  expect(cells[3]?.trim(), 'stance taken').toBe('Accept')
  expect(cells[7]?.trim(), 'stance warranted').toBe('Accept')
  expect(cells[13]?.trim(), 'and the matrix scores the two as a match').toBe('Yes')

  // ------- the section a variant with no planted defect cannot draw is named, not dropped -------
  const confirmedDebrief = await readJson<DebriefRow>(page.request, `/api/v1/runs/${runId}/debrief`)
  expect(confirmedDebrief.labels.version).toBe('confirmed')
  const defects = confirmedDebrief.sections.find((section) => section.key === 'missed_defects')
  expect(defects?.available, 'the sound variant plants no defect').toBe(false)
  await expect(page.locator('#debrief-missed-defects')).toContainText(
    'Your filed decision rested on no claim this variant authored as defective.',
  )
  await expect(page.locator('#debrief-missed-defects')).toContainText('Not drawn for this run')

  // Nothing on the page is the reviewer's, over a payload with seven decided bands in it.
  expect(findForbiddenKeys(confirmedDebrief, { scored: true })).toEqual([])

  // ------- the two questions record the run (FR-152) -------
  const debriefQuestions = page.locator('#debrief-questions')
  await debriefQuestions
    .getByLabel('Which single stance would you change, and to what?')
    .fill(DEBRIEF_ANSWERS.stanceToChange)
  await debriefQuestions
    .getByLabel('What will you do differently in the next run like this?')
    .fill(DEBRIEF_ANSWERS.doDifferently)
  await debriefQuestions.getByRole('button', { name: 'File both answers' }).click()
  await expect(debriefQuestions.getByText(DEBRIEF_ANSWERS.stanceToChange)).toBeVisible({
    timeout: ACTION_TIMEOUT_MS,
  })

  await expect
    .poll(
      async () => (await readJson<{ state: string }>(page.request, `/api/v1/runs/${runId}`)).state,
      {
        timeout: ACTION_TIMEOUT_MS,
        message: 'FR-152: answering the two questions records the run',
      },
    )
    .toBe('recorded')

  // ===========================================================================================
  // Step 14, part 2 — the Judgment Record (UI-029, FR-170 to FR-172)
  // ===========================================================================================

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
  await expect(page.locator('#record-bands').getByText('Confirmed band')).toHaveCount(7)

  // FR-170's "mode and variant" — and on this record the variant is the other one.
  const context = page.locator('#record-context')
  await expect(context.getByText('Variant', { exact: true })).toBeVisible()
  await expect(context.getByText('Sound', { exact: true })).toBeVisible()

  // FR-172, through the file the student downloads: the record carries no course arithmetic. The
  // two exemptions are the ones the service itself names — the three plotted readings of FR-132's
  // line (D-439) and the answer key the student themselves chose (D-370).
  const file = await page.request.get(`/api/v1/runs/${runId}/record/export`)
  expect(file.status(), await file.text()).toBe(200)
  const document = (await file.json()) as unknown
  const findings = findForbiddenKeys(document, { scored: true, form: 'record' }).filter(
    (finding) =>
      !CONFIDENCE_LINE_POINTS.test(finding.path) && !STUDENT_ANSWER_KEY.test(finding.path),
  )
  expect(findings, 'FR-170: the record form carries none of the course’s arithmetic').toEqual([])

  await signOut(page)
})
