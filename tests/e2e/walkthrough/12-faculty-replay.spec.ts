// Step 12 of the walkthrough (PRD §12): **the instructor opens the replay** (UI-033, FR-180 to
// FR-185, FR-202, FR-253).
//
// The run this spec reviews is driven to `scored` through the documented endpoints by
// `./scored-run.ts` — steps 2 to 11 are proved through the screens by the seven specs before this
// one, and repeating them here would say nothing about the replay. What is proved here is
// everything a faculty seat does with a scored run, through the screen:
//
//   **The trace is in order and carries the clock.** Every row's sequence number is greater than
//   the one above it and the clock column holds `mm:ss` on the events written while a clock ran.
//   That is FR-240's ordering and D-042's "the clock is a server timestamp materialized on read",
//   read back off the page a reviewer actually sees.
//
//   **Four graphs, each with its description and its data table** (FR-212). The two recharts ones
//   arrive through `@/components/graphs`'s `next/dynamic` shim, so this is also the assertion that
//   the deferred chunk loads on this route.
//
//   **The defense transcript, with the expected-answer notes.** The notes are `reviewer_only` in
//   every state (12 §8.1), which is what makes their presence here — and only here — the point.
//
//   **The seven decisions, and the boundary at the seventh** (FR-181, FR-182). One band is
//   confirmed and one is overridden with a note through the control; the run is still `scored`. Four
//   more are confirmed; the run is *still* `scored` at six of seven. The seventh is landed with
//   "Confirm the remaining drafts" and the run becomes `confirmed`, `points_confirmed` is written
//   and export v1 exists. A run that moved earlier, or moved without an export, fails here.
//
//   **The points sentence shows the arithmetic** (FR-202, FR-131). Not a number asserted at the
//   reviewer but the sum and the division that produce it, checked against the mapping this course
//   holds and against the seven bands the API reports — so the screen and the exported file cannot
//   quietly disagree.
//
//   **One claim object, in full** (FR-253): evidence status, the source passage, the failure family,
//   the verification result, and how the claim was confirmed. `C3` is the seeded package's planted
//   claim and the only one carrying a failure family, which is why it is the one opened.
//
//   **And a student is refused the route outright.** The run's own student is a section member
//   holding `student`, which `requireRunReviewer` answers FORBIDDEN to; the page turns that into the
//   not-found page, so nothing on this screen — the warranted stances, the planted claim, the
//   expected-answer notes — is reachable from the address. The gate is asserted against the *page*
//   and not only against the service that backs it.
import { expect, seatEmail, signInAs, signOut, test, type Seat } from '../fixtures'
import { addSectionMember, createStudentAssignment, signInAsInstructor } from '../instructor/api'
import { driveRunToScored, readJson } from './scored-run'

/**
 * The seat this run is taken in.
 *
 * Not `student1`, which nineteen specs sign in as, and not `editor`, which specs 11 and 14 already
 * share: an endpoint-driven run spends about fourteen writes in a few seconds against D-026's sixty
 * a minute per user, and three browser projects run this lane at once. `student2` is a seeded
 * institution member (06 §5) that no other walkthrough spec signs in as.
 */
const STUDENT_SEAT: Seat = 'student2'

/** The seven dimensions in the order the rubric declares them, with the words the screen uses. */
const DIMENSION_LABELS = [
  ['framing', 'Framing'],
  ['delegation', 'Delegation'],
  ['verification', 'Verification'],
  ['calibration', 'Calibration'],
  ['decision_quality', 'Decision Quality'],
  ['adaptation', 'Adaptation'],
  ['ownership', 'Ownership'],
] as const

const BAND_LABELS: Record<string, string | undefined> = {
  novice: 'Novice',
  developing: 'Developing',
  proficient: 'Proficient',
  professional: 'Professional',
}

/**
 * How long a decision may take to appear in the progress counter.
 *
 * Each press is a Server Action followed by `router.refresh()`, which re-renders the whole screen
 * on the server; React holds the old counter until the new tree arrives. Four browser projects
 * sharing one machine push that past Playwright's five-second default, and a slow re-render is not
 * the defect this spec is looking for — the assertions are unchanged, only the patience (D-188).
 */
const DECIDED_TIMEOUT_MS = 20_000

/**
 * How long the two recharts graphs may take to appear.
 *
 * `@/components/graphs` loads the confidence line and the clock timeline through `next/dynamic` so
 * the library is not in the route's entry bundle (16 §3.2, D-282, D-074), which means they arrive
 * in a chunk fetched *after* the page — by design. Waiting for the chunk is the assertion; five
 * seconds is not the budget it was ever measured against, and on WebKit under three browser
 * projects it is not enough to fetch and mount one.
 */
const GRAPH_TIMEOUT_MS = 20_000

const OVERRIDE_NOTE =
  'Read against the Source Trace on the payback figure rather than the count of actions.'

type BandRow = {
  dimension: string
  band: string | null
  decision: string | null
  effectiveBand: string | null
}
type ReplayView = {
  run: { state: string; latestExportVersion: number | null }
  bands: BandRow[]
  points: { mapping: Record<string, number>; confirmed: number | null; draft: number | null }
}

test('walkthrough step 12: the instructor reads the replay and the seventh decision confirms the run', async ({
  page,
  request,
}) => {
  // A full run driven to a scored one, then six decisions taken through the screen, is well past
  // Playwright's default patience on a loaded machine (D-188). The assertions are unchanged.
  test.setTimeout(600_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Replay',
    studentEmail: seatEmail(STUDENT_SEAT),
    variant: 'defective',
  })
  await addSectionMember(request, assignment.section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  // ---------------------------------------------------------------------------------------------
  // A scored run, taken by the student through the endpoints the screens call
  // ---------------------------------------------------------------------------------------------

  await signInAs(page, STUDENT_SEAT)
  const runId = await driveRunToScored(page.request, assignment.assignment.id)

  // The run's own student is refused the replay, and the page — not the service — is what refuses.
  await page.goto(`/review/runs/${runId}`)
  await expect(
    page.getByRole('heading', { level: 1, name: /not found/i }),
    'a student who types the replay address must reach the not-found page (12 §8.1)',
  ).toBeVisible()
  await signOut(page)

  // ---------------------------------------------------------------------------------------------
  // The instructor's replay: the trace, the graphs, the interview
  // ---------------------------------------------------------------------------------------------

  await signInAs(page, 'instructor')

  await page.goto(`/review/runs/${runId}?tab=trace`)
  await expect(page.getByRole('heading', { level: 2, name: 'The run’s trace' })).toBeVisible()

  const rows = page.locator('#replay-trace tbody tr')
  await expect.poll(async () => rows.count()).toBeGreaterThan(10)
  const sequences: number[] = []
  const clocks: string[] = []
  for (const row of await rows.all()) {
    const cells = row.locator('td')
    sequences.push(Number((await cells.nth(0).innerText()).trim()))
    clocks.push((await cells.nth(1).innerText()).trim())
  }
  expect(sequences, 'FR-240: the trace is read in the order it was written').toEqual(
    [...sequences].sort((left, right) => left - right),
  )
  expect(new Set(sequences).size, 'no sequence number appears twice').toBe(sequences.length)
  expect(
    clocks.some((value) => /^\d{2}:\d{2}$/.test(value)),
    'the clock column holds mm:ss on the events written while a clock ran (D-042)',
  ).toBe(true)

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

  await expect(page.getByRole('heading', { level: 2, name: 'Defense transcript' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3, name: 'Question 1' })).toBeVisible()
  await expect(
    page.locator('#replay-defense').getByText('Expected-answer notes').first(),
    'the notes the author wrote are the reviewer’s alone (12 §8.1) and belong on this screen',
  ).toBeVisible()

  // ---------------------------------------------------------------------------------------------
  // The seven decisions (FR-181, FR-182), and the boundary at the seventh
  // ---------------------------------------------------------------------------------------------

  const replayBefore = await readJson<ReplayView>(request, `/api/v1/review/runs/${runId}`)
  expect(replayBefore.run.state).toBe('scored')
  expect(replayBefore.bands).toHaveLength(7)
  expect(replayBefore.bands.every((band) => band.decision === null)).toBe(true)

  await page.goto(`/review/runs/${runId}?tab=bands`)
  await expect(page.getByRole('heading', { level: 2, name: 'The seven bands' })).toBeVisible()
  await expect(page.getByText('0 of 7 decided')).toBeVisible()

  /** One dimension's card; every control on the tab is scoped through it. */
  const card = (dimension: string) => page.locator(`#band-${dimension}`)

  // 1. Confirm one band with its own control.
  await card('framing')
    .getByRole('button', { name: /^Confirm the draft: / })
    .click()
  await expect(page.getByText('1 of 7 decided')).toBeVisible({ timeout: DECIDED_TIMEOUT_MS })

  // 2. Override one with a note. The note is optional everywhere and written here because FR-182
  //    makes it the one thing the student reads about the decision.
  const verification = card('verification')
  const draftBand = replayBefore.bands.find((band) => band.dimension === 'verification')?.band
  const overrideTo = draftBand === 'professional' ? 'proficient' : 'professional'
  await verification.getByRole('radio', { name: BAND_LABELS[overrideTo] ?? overrideTo }).check()
  await verification.getByLabel('Note for the student (optional)').fill(OVERRIDE_NOTE)
  // The primary control states the act the current selection performs, so the label is the
  // assertion: a button reading "Record Professional instead" cannot be confirming a draft.
  await verification
    .getByRole('button', { name: `Record ${BAND_LABELS[overrideTo] ?? overrideTo} instead` })
    .click()
  await expect(page.getByText('2 of 7 decided')).toBeVisible({ timeout: DECIDED_TIMEOUT_MS })

  const afterTwo = await readJson<ReplayView>(request, `/api/v1/review/runs/${runId}`)
  expect(afterTwo.run.state, 'two decisions do not confirm a run').toBe('scored')
  const overridden = afterTwo.bands.find((band) => band.dimension === 'verification')
  expect(overridden?.decision).toBe('overridden')
  expect(overridden?.effectiveBand).toBe(overrideTo)

  // 3. Four more, one at a time, so the boundary below is a claim about the *seventh* decision and
  //    not about a control that decides five at once.
  let count = 2
  for (const [dimension] of DIMENSION_LABELS.slice(1, 6)) {
    if (dimension === 'verification') continue
    await card(dimension)
      .getByRole('button', { name: /^Confirm the draft: / })
      .click()
    count += 1
    await expect(page.getByText(`${String(count)} of 7 decided`)).toBeVisible({
      timeout: DECIDED_TIMEOUT_MS,
    })
  }
  expect(count, 'six of the seven are decided before the boundary is asserted').toBe(6)

  const afterSix = await readJson<ReplayView>(request, `/api/v1/review/runs/${runId}`)
  expect(
    afterSix.run.state,
    'FR-181: the run leaves `scored` on the seventh decision and not before',
  ).toBe('scored')
  expect(afterSix.points.confirmed, 'no confirmed figure before the seventh decision').toBeNull()
  expect(afterSix.run.latestExportVersion, 'no export before the seventh decision').toBeNull()

  // 4. The seventh, through UI-033's own shortcut — which asks first, because one press decides
  //    every open dimension, confirms the run and files an export version.
  await page.getByRole('button', { name: 'Confirm the remaining drafts' }).click()
  const shortcut = page.getByRole('alertdialog')
  await expect(
    shortcut.getByRole('heading', { name: 'Confirm the remaining drafts?' }),
  ).toBeVisible()
  await expect(
    shortcut.getByText('Ownership'),
    'the dialog names every dimension it is about to decide, with the draft each would take',
  ).toBeVisible()
  await expect(shortcut.getByText('Confirming these writes course export version 1.')).toBeVisible()
  await shortcut.getByRole('button', { name: 'Put the remaining drafts on the record' }).click()
  await expect(page.getByText('7 of 7 decided')).toBeVisible({ timeout: DECIDED_TIMEOUT_MS })

  const confirmed = await readJson<ReplayView>(request, `/api/v1/review/runs/${runId}`)
  expect(confirmed.run.state, 'the seventh decision confirms the run').toBe('confirmed')
  expect(confirmed.bands.every((band) => band.decision !== null)).toBe(true)
  expect(confirmed.points.confirmed, 'the course’s arithmetic is written on confirmation').not.toBe(
    null,
  )
  expect(confirmed.run.latestExportVersion, 'confirmation writes export v1 (FR-184)').toBe(1)

  // ---------------------------------------------------------------------------------------------
  // The arithmetic, on the page, term by term (FR-202, FR-131)
  // ---------------------------------------------------------------------------------------------

  await page.reload()
  const mapping = confirmed.points.mapping
  const expectedTerms = confirmed.bands
    .map((band) => (band.effectiveBand === null ? null : mapping[band.effectiveBand]))
    .filter((value): value is number => value !== null && value !== undefined)
  const sentence = `(${expectedTerms.join(' + ')}) / ${String(expectedTerms.length)} = ${(
    confirmed.points.confirmed ?? 0
  ).toFixed(3)}`

  const pointsPanel = page.locator('#replay-points')
  await expect(
    pointsPanel.getByText(sentence),
    'the points sentence shows the arithmetic rather than asserting a number',
  ).toBeVisible()
  for (const band of ['Novice', 'Developing', 'Proficient', 'Professional']) {
    await expect(pointsPanel.getByText(`${band} = `, { exact: false }).first()).toBeVisible()
  }
  await expect(
    pointsPanel.getByText(
      'Enter the bands, the mapping and the points in the gradebook of record. Tassl holds no grade.',
    ),
  ).toBeVisible()

  // Nothing on this screen is a composite, a rank or a percentile (FR-131).
  const bandsText = ((await page.locator('main').textContent()) ?? '').toLowerCase()
  for (const word of ['percentile', 'rank', 'cohort average', 'composite score']) {
    expect(bandsText, `the replay must not say "${word}"`).not.toContain(word)
  }

  // The note is on the record and beside the band it belongs to. The prefix is what tells it from
  // the same words sitting in the control's own field, where an edit would start from.
  await expect(
    card('verification').getByText(`Note to the student: ${OVERRIDE_NOTE}`),
  ).toBeVisible()

  // The export written by the confirmation is listed with its reason and its download.
  const exportsPanel = page.locator('#replay-exports')
  await expect(exportsPanel.getByText('The bands were confirmed')).toBeVisible()
  await expect(exportsPanel.getByRole('link', { name: 'Download version 1' })).toBeVisible()

  // ---------------------------------------------------------------------------------------------
  // One claim object, in full (FR-253)
  // ---------------------------------------------------------------------------------------------

  await page.goto(`/review/runs/${runId}?tab=package&claim=C3`)
  await expect(page.getByRole('heading', { level: 2, name: 'Claim C3' })).toBeVisible()

  const claim = page.locator('#replay-claims')
  // Both variants, side by side, with the one this run drew marked.
  await expect(claim.getByRole('heading', { name: 'Defective variant' })).toBeVisible()
  await expect(claim.getByRole('heading', { name: 'Sound variant' })).toBeVisible()
  await expect(claim.getByText('This run’s variant')).toBeVisible()

  await expect(claim.getByText('Defective').first(), 'the evidence status').toBeVisible()
  await expect(claim.getByText('Stale evidence').first(), 'the failure family').toBeVisible()
  await expect(
    claim.getByText('310 divided by 28.20 is 11.0.', { exact: false }).first(),
    'the source passage the Source Trace returns',
  ).toBeVisible()
  await expect(
    claim.getByText('15.98 months', { exact: false }).first(),
    'the verification result a decomposition check returns',
  ).toBeVisible()
  await expect(
    claim.getByRole('heading', { name: 'How this claim was confirmed' }),
    'FR-253: the claim object carries the author’s confirmation',
  ).toBeVisible()
  await expect(
    claim.getByText('Planted').first(),
    'the defect an author placed for the student to find',
  ).toBeVisible()

  await signOut(page)
})
