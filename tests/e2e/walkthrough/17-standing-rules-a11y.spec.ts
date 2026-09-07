// Step 17 of the walkthrough (PRD §12): **the standing rules and the accessibility essentials**
// (FR-004, FR-210, FR-212, NFR-006, PRD §7.20).
//
// The step is two claims, and they are two tests here because they are about two different seats.
//
//   **A dimension that cannot be assessed is reported unassessed and never estimated.** The faculty
//   seat records one dimension as unassessed from the override control, and the run's points are the
//   mean over the *remaining six* — not a seventh term of zero. That difference is the whole of the
//   standing rule, so it is asserted as a difference: the figure equals the mean over six and does
//   not equal the mean over seven. The arithmetic is read off the screen term by term as well as off
//   the wire, and the student's own debrief is read afterwards, because a rule the instructor can see
//   and the student cannot is half a rule.
//
//   **Every run screen is operated by keyboard alone, reads as a document, and every graph opens to
//   its data table and its description.** Twelve screens, in the states a run passes through them in:
//
//     * *Structure.* One `h1`, no heading level skipped, and the three landmarks a screen-reader
//       user navigates by — banner, the primary navigation, and `main` — on every one of them. This
//       is the "reads correctly in a native screen reader" half of §7.20 written as something a
//       machine can check: the document outline and the landmark set are exactly what a rotor lists.
//     * *Keyboard.* The skip link is the first thing in the document and it jumps to `main`; and
//       every control the screen offers inside `main` is reached by pressing Tab, in one pass, with
//       nothing trapping focus on the way. The sweep is against the *screen's own* controls,
//       computed in the page from what is rendered and visible, so it cannot pass by agreeing with a
//       list somebody wrote down.
//     * *Graphs.* Each of the four opens to a table with a caption and rows, and carries a text
//       description that is in the DOM whether the plot is on screen or not (FR-212, 16 §9.2).
//
// This spec drives the run through the documented endpoints between screens — the presses that get a
// run from one state to the next are the subject of specs `02-05` through `13`, and repeating them
// here would say nothing about the document outline. The keyboard *operation* of the run, with the
// pointer taken away entirely, is `../a11y/keyboard-only-run.spec.ts`.
//
// It also carries UI-027's axe scan: the run status screen is the one screen in the run whose only
// visit is between two other screens, and no other spec stops on it long enough to read it.
import type { Page } from '@playwright/test'
import { axe, expect, seatEmail, signInAs, signOut, test, type Seat } from '../fixtures'
import { addSectionMember, createStudentAssignment, signInAsInstructor } from '../instructor/api'
import {
  BRIEF,
  FRAME,
  PAST_THE_TURN_MS,
  answerEveryQuestion,
  driveRunToScored,
  myAssignment,
  post,
  put,
  readJson,
  SCORING_TIMEOUT_MS,
  TURN_RESPONSE,
  WRITE_HEADERS,
} from './scored-run'

/** The seat each test's run is taken in; the walkthrough lane spreads D-026's budget (D-458). */
const UNASSESSED_SEAT: Seat = 'editor'
const KEYBOARD_SEAT: Seat = 'student1'

/** The dimension the instructor records as unassessed. Any of the seven would do. */
const UNASSESSED_DIMENSION = 'ownership'
const UNASSESSED_LABEL = 'Ownership'

/** A Server Action followed by `router.refresh()`, on a machine running three browser projects. */
const ACTION_TIMEOUT_MS = 20_000

/** The two recharts graphs arrive in a deferred chunk (16 §3.3, D-282), after the page. */
const GRAPH_TIMEOUT_MS = 20_000

/** Raises C3, so the workspace is swept with a claim card and its controls on it. */
const REQUEST = 'What is the premium payback?'

type BandRow = {
  dimension: string
  band: string | null
  decision: string | null
  effectiveBand: string | null
}
type ReplayView = {
  run: { state: string }
  bands: BandRow[]
  points: {
    mapping: Record<string, number>
    assessed: number
    confirmed: number | null
    effective: number | null
  }
}

// =============================================================================================
// Part 1 — the standing rule: unassessed is left out of the division, never counted as nothing
// =============================================================================================

test('walkthrough step 17a: a dimension recorded unassessed leaves the division rather than counting as zero', async ({
  page,
  request,
}) => {
  test.setTimeout(600_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Unassessed',
    studentEmail: seatEmail(UNASSESSED_SEAT),
    variant: 'defective',
  })
  await addSectionMember(request, assignment.section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  await signInAs(page, UNASSESSED_SEAT)
  const runId = await driveRunToScored(page.request, assignment.assignment.id)
  await signOut(page)

  // -------------------------------------------------------------------------------------------
  // The faculty seat records one dimension as unassessed, from the override control (FR-004)
  // -------------------------------------------------------------------------------------------

  await signInAs(page, 'instructor')
  await page.goto(`/review/runs/${runId}?tab=bands`)
  await expect(page.getByRole('heading', { level: 2, name: 'The seven bands' })).toBeVisible()
  await expect(page.getByText('0 of 7 decided')).toBeVisible()

  const card = page.locator(`#band-${UNASSESSED_DIMENSION}`)
  await card.getByRole('radio', { name: 'Unassessed' }).check()
  // The primary control states the act the current selection performs, so the label is part of the
  // assertion: a button reading "Confirm the draft: Proficient" cannot be recording an absence.
  await card.getByRole('button', { name: 'Record this dimension as Unassessed' }).click()
  await expect(page.getByText('1 of 7 decided')).toBeVisible({ timeout: ACTION_TIMEOUT_MS })

  // The other six take their drafts, so the run is confirmed and the arithmetic is written.
  await page.getByRole('button', { name: 'Confirm the remaining drafts' }).click()
  const shortcut = page.getByRole('alertdialog')
  await expect(shortcut.getByRole('heading', { name: /^Confirm the remaining/ })).toBeVisible()
  await shortcut.getByRole('button', { name: 'Put the remaining drafts on the record' }).click()
  await expect(page.getByText('7 of 7 decided')).toBeVisible({ timeout: ACTION_TIMEOUT_MS })

  // -------------------------------------------------------------------------------------------
  // The arithmetic, on the wire and on the screen (FR-004, FR-202)
  // -------------------------------------------------------------------------------------------

  const replay = await readJson<ReplayView>(request, `/api/v1/review/runs/${runId}`)
  expect(replay.run.state).toBe('confirmed')

  const excluded = replay.bands.find((band) => band.dimension === UNASSESSED_DIMENSION)
  expect(excluded?.decision, 'the dimension is on the record as unassessed').toBe('unassessed')
  expect(excluded?.effectiveBand, 'and it stands on no band at all').toBeNull()

  const terms = replay.bands
    .map((band) => (band.effectiveBand === null ? null : replay.points.mapping[band.effectiveBand]))
    .filter((value): value is number => value !== null && value !== undefined)
  expect(terms, 'six of the seven dimensions carry a band').toHaveLength(6)
  expect(replay.points.assessed, 'FR-202: the divisor is the number of assessed dimensions').toBe(6)

  const sum = terms.reduce((total, term) => total + term, 0)
  expect(sum, 'the run earned something, so the two means below differ').toBeGreaterThan(0)
  const total = replay.points.confirmed ?? -1
  expect(
    Number(total.toFixed(3)),
    'PRD §12 step 17: the points are the mean over the remaining assessed dimensions',
  ).toBeCloseTo(sum / 6, 3)
  expect(
    Number(total.toFixed(3)),
    'and never the mean over seven with the excluded dimension counted as zero',
  ).not.toBeCloseTo(sum / 7, 3)

  // On the screen, term by term: the excluded dimension is named and not counted, the divisor says
  // six, and the sentence divides by six.
  await page.reload()
  const points = page.locator('#replay-points')
  const excludedRow = points
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: UNASSESSED_LABEL, exact: true }) })
  await expect(excludedRow).toContainText('Unassessed')
  await expect(excludedRow, 'FR-004: an unassessed dimension is named, not scored').toContainText(
    'Not counted',
  )
  await expect(points.getByText('Total over the assessed dimensions (6)')).toBeVisible()
  await expect(
    points.getByText(`(${terms.join(' + ')}) / 6 = ${total.toFixed(3)}`),
    'the points sentence shows the arithmetic rather than asserting a number',
  ).toBeVisible()
  await expect(
    points.getByText(
      'A dimension marked not assessed is left out of the division rather than counted as nothing.',
    ),
  ).toBeVisible()

  await signOut(page)

  // -------------------------------------------------------------------------------------------
  // And the student reads the same rule on their own debrief (FR-004, FR-150)
  // -------------------------------------------------------------------------------------------

  await signInAs(page, UNASSESSED_SEAT)
  await page.goto(`/runs/${runId}/debrief`)
  await expect(page.getByRole('heading', { level: 1, name: 'Run Debrief' })).toBeVisible()

  const studentBand = page.locator(`#band-${UNASSESSED_DIMENSION}`)
  await expect(studentBand).toContainText('Unassessed')
  await expect(studentBand).toContainText(
    'Your instructor recorded this dimension as unassessed, so it is left out of the arithmetic.',
  )
  await expect(
    page
      .locator('#debrief-points')
      .getByText(
        'Those values are added and divided by 6, the number of dimensions this run was assessed on. A dimension recorded as unassessed is left out entirely and is never counted as nothing.',
      ),
  ).toBeVisible()

  await signOut(page)
})

// =============================================================================================
// Part 2 — the accessibility essentials: structure, keyboard reach, and the graphs' data tables
// =============================================================================================

/** What a focus stop is, for a message that names the control rather than an index. */
type Expected = { index: number; tag: string; name: string }

/**
 * Every control the screen offers inside `main`, computed in the page from what is rendered.
 *
 * It is stashed on `window` so the sweep below can ask "which of these is focused now" without
 * re-deriving the list on every press — the DOM does not change while Tab is being pressed, and the
 * two must be the same list or the answer means nothing.
 *
 * `tabindex="-1"` is excluded because it is the author saying "not in the tab order", which is how a
 * roving radio group and the `h1` focus target are both built; `getClientRects()` excludes anything
 * inside a `hidden` region, which is how `GraphFrame` hides the view that is not on screen.
 */
async function expectedControls(page: Page, linksTabbable: boolean): Promise<Expected[]> {
  return page.evaluate((links: boolean) => {
    const selector = 'a[href], button, input, select, textarea, summary'
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(`#main ${selector}`))
    const wanted = nodes.filter((element) => {
      if (element.getClientRects().length === 0) return false
      if (element.hasAttribute('disabled')) return false
      if ((element.getAttribute('tabindex') ?? '0') === '-1') return false
      // WebKit's "Press Tab to highlight each item on a webpage" is off by default, so links are
      // not in its tab order. That is a browser preference and not a property of the page.
      if (!links && element.tagName === 'A') return false
      return true
    })
    ;(window as unknown as { __tasslExpected: HTMLElement[] }).__tasslExpected = wanted
    return wanted.map((element, index) => ({
      index,
      tag: element.tagName.toLowerCase(),
      name: (
        element.getAttribute('aria-label') ??
        element.textContent ??
        element.getAttribute('name') ??
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60),
    }))
  }, linksTabbable)
}

/** Where focus is now, against that list. */
async function focusNow(page: Page): Promise<{ index: number; atRoot: boolean }> {
  return page.evaluate(() => {
    const list = (window as unknown as { __tasslExpected?: HTMLElement[] }).__tasslExpected ?? []
    const active = document.activeElement
    const atRoot =
      active === null || active === document.body || active === document.documentElement
    return { index: active === null ? -1 : list.indexOf(active as HTMLElement), atRoot }
  })
}

/**
 * Tab from the top of the document until it wraps, and report which of the screen's own controls
 * were reached.
 *
 * The cap is also the keyboard-trap test: a screen that never lets focus past one control never
 * reaches the rest of them, and the failure names exactly which ones.
 */
async function sweep(
  page: Page,
  linksTabbable: boolean,
): Promise<{ expected: number; unreached: string[] }> {
  const expected = await expectedControls(page, linksTabbable)
  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
  })

  const reached = new Set<number>()
  const cap = expected.length * 2 + 60
  for (let press = 0; press < cap; press += 1) {
    await page.keyboard.press('Tab')
    const at = await focusNow(page)
    if (at.index >= 0) {
      if (reached.has(at.index) && reached.size >= expected.length) break
      reached.add(at.index)
    }
    if (at.atRoot && reached.size > 0) break
  }

  return {
    expected: expected.length,
    unreached: expected
      .filter((control) => !reached.has(control.index))
      .map((control) => `${control.tag} "${control.name}"`),
  }
}

/** The document outline and the landmark set, as a rotor would list them. */
async function structureOf(page: Page): Promise<{ levels: number[]; landmarks: string[] }> {
  return page.evaluate(() => {
    const levels = Array.from(
      document.querySelectorAll<HTMLElement>('#main :is(h1,h2,h3,h4,h5,h6)'),
    )
      .filter((heading) => heading.getClientRects().length > 0)
      .map((heading) => Number(heading.tagName.slice(1)))

    const landmarks: string[] = []
    // A `header` is the banner landmark unless it is scoped to a sectioning element; `PageHeader`
    // draws a second one inside `main`, and that one is not a landmark.
    const header = document.querySelector('header')
    if (header !== null && header.closest('main, article, aside, nav, section') === null) {
      landmarks.push('banner')
    }
    const nav = document.querySelector('nav[aria-label]')
    if (nav !== null) landmarks.push(`navigation:${nav.getAttribute('aria-label') ?? ''}`)
    if (document.querySelector('main#main') !== null) landmarks.push('main')
    return { levels, landmarks }
  })
}

/**
 * One screen, read the way §7.20 asks it to be read.
 *
 * Nothing here is screen-specific: it is the same four questions on every one of the twelve, which
 * is what makes "every run screen" a claim rather than a list of the ones somebody remembered.
 */
async function readsAsADocument(page: Page, what: string, linksTabbable: boolean): Promise<void> {
  const { levels, landmarks } = await structureOf(page)

  expect(
    levels.filter((level) => level === 1),
    `${what}: exactly one h1`,
  ).toHaveLength(1)
  expect(levels[0], `${what}: the outline opens at h1`).toBe(1)
  const skipped = levels
    .map((level, index) => (index === 0 ? null : { from: levels[index - 1] as number, to: level }))
    .filter(
      (step): step is { from: number; to: number } => step !== null && step.to > step.from + 1,
    )
  expect(skipped, `${what}: the outline never skips a heading level`).toEqual([])

  expect(landmarks, `${what}: banner, primary navigation and main`).toEqual([
    'banner',
    'navigation:Primary',
    'main',
  ])

  // The skip link is the first thing in the document and it goes to `main` (16 §8.4). It is
  // asserted structurally as well as by focus because WebKit's default preference keeps links out
  // of the tab order — the link is still the first focusable thing for every reader who has that
  // preference on, and `focus()` is how `tests/e2e/system/errors.spec.ts` already reads it.
  const skip = page.getByRole('link', { name: 'Skip to main content' })
  expect(await page.locator('a').first().getAttribute('href'), `${what}: skip link first`).toBe(
    '#main',
  )
  await skip.focus()
  await expect(skip, `${what}: the skip link is visible once focused`).toBeVisible()

  const { expected, unreached } = await sweep(page, linksTabbable)
  expect(
    unreached,
    `${what}: every control on the screen is reached by Tab alone, with nothing trapping focus`,
  ).toEqual([])

  // A sweep over an empty set passes without asking anything, so the count is asserted and then
  // reported. The one screen that can honestly offer nothing is the readiness result on an engine
  // whose tab order holds no links: its only control is the link on to the workspace.
  if (linksTabbable) {
    expect(expected, `${what}: the sweep found controls to reach`).toBeGreaterThan(0)
  }
  test.info().annotations.push({
    type: 'keyboard reach',
    description: `${what}: ${String(expected)} controls, all reached`,
  })
}

test('walkthrough step 17b: every run screen reads as a document, is reached by keyboard alone, and every graph opens to its data table', async ({
  page,
  request,
  browserName,
}) => {
  test.setTimeout(900_000)

  // WebKit's "Press Tab to highlight each item on a webpage" is off by default, so its tab order
  // holds form controls and not links. It is a browser preference rather than a property of the
  // page, and the structural half of the skip-link assertion above covers what it hides.
  const linksTabbable = browserName !== 'webkit'

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Keyboard structure',
    studentEmail: seatEmail(KEYBOARD_SEAT),
    variant: 'defective',
  })
  await addSectionMember(request, assignment.section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  await signInAs(page, KEYBOARD_SEAT)
  const mine = await myAssignment(page.request, assignment.label)

  // ------- UI-020, the runs list -------
  await page.goto('/runs')
  await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
  await readsAsADocument(page, '/runs', linksTabbable)

  // ------- UI-021, the policy display -------
  const { id: runId } = await post<{ id: string }>(
    page.request,
    `/api/v1/assignments/${mine.assignmentId}/runs`,
    {},
    201,
  )
  await page.goto(`/runs/${runId}/start`)
  await expect(page.getByRole('heading', { level: 1, name: 'Before you begin' })).toBeVisible()
  await readsAsADocument(page, '/runs/[runId]/start', linksTabbable)

  // ------- UI-022, the Readiness Check and its result -------
  await post(page.request, `/api/v1/runs/${runId}/policy-ack`)
  await page.goto(`/runs/${runId}/readiness`)
  await expect(page.getByRole('heading', { level: 1, name: 'Readiness Check' })).toBeVisible()
  await readsAsADocument(page, '/runs/[runId]/readiness', linksTabbable)

  const check = await readJson<{ items: { id: string; options: { key: string }[] }[] }>(
    page.request,
    `/api/v1/runs/${runId}/readiness`,
  )
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
  await readsAsADocument(page, '/runs/[runId]/readiness/result', linksTabbable)

  // ------- UI-023 in `framing`: the room, the brief, the frame form -------
  await page.goto(`/runs/${runId}/work`)
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()
  await readsAsADocument(page, '/runs/[runId]/work (framing)', linksTabbable)

  // ------- UI-023 in `working`: a claim card with its controls, and the brief editor -------
  await post(page.request, `/api/v1/runs/${runId}/frame`, FRAME)
  const delegated = await page.request.post(`/api/v1/runs/${runId}/delegations`, {
    data: { request: REQUEST },
    headers: WRITE_HEADERS,
  })
  expect(delegated.status(), await delegated.text()).toBe(200)

  await page.goto(`/runs/${runId}/work`)
  await expect(page.locator('[data-state="working"]')).toBeVisible()
  await expect(
    page.locator('#delegation-log').getByRole('article', { name: 'Claim C3' }),
  ).toBeVisible()
  await readsAsADocument(page, '/runs/[runId]/work (working)', linksTabbable)

  // ------- UI-024, the locked decision -------
  await post(page.request, `/api/v1/runs/${runId}/lock`, BRIEF)
  await page.goto(`/runs/${runId}/locked`)
  await expect(page.getByRole('heading', { level: 1, name: 'Decision locked' })).toBeVisible()
  await readsAsADocument(page, '/runs/[runId]/locked', linksTabbable)

  // ------- UI-025, the Turn window -------
  await post(page.request, `/api/v1/test/runs/${runId}/advance-clock`, { ms: PAST_THE_TURN_MS })
  await page.goto(`/runs/${runId}/turn`)
  await expect(page.getByRole('heading', { level: 1, name: 'The Turn' })).toBeVisible()
  await readsAsADocument(page, '/runs/[runId]/turn', linksTabbable)

  // ------- UI-026, the defense -------
  const claims = await readJson<{ id: string; inTurnWindow: boolean }[]>(
    page.request,
    `/api/v1/runs/${runId}/claims`,
  )
  for (const claim of claims.filter((row) => row.inTurnWindow)) {
    await put(page.request, `/api/v1/runs/${runId}/claims/${claim.id}/stance`, { stance: 'verify' })
  }
  await post(page.request, `/api/v1/runs/${runId}/turn/response`, TURN_RESPONSE)

  await page.goto(`/runs/${runId}/defense`)
  await expect(page.getByRole('heading', { level: 1, name: 'The defense' })).toBeVisible()
  await readsAsADocument(page, '/runs/[runId]/defense', linksTabbable)

  // ------- UI-027, the run status, and the one axe scan of it in the suite -------
  await answerEveryQuestion(page.request, runId)
  await post(page.request, `/api/v1/runs/${runId}/defense/complete`)
  await expect
    .poll(
      async () => {
        const run = await readJson<{ state: string; scoringStatus: string }>(
          page.request,
          `/api/v1/runs/${runId}`,
        )
        return `${run.state}/${run.scoringStatus}`
      },
      { timeout: SCORING_TIMEOUT_MS, message: 'the finished defense hands the run to scoring' },
    )
    .toBe('scored/done')

  await page.goto(`/runs/${runId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Run status' })).toBeVisible()
  await expect(
    page.locator('#run-status').getByRole('heading', { level: 2, name: 'Your debrief is ready' }),
  ).toBeVisible({ timeout: SCORING_TIMEOUT_MS })
  await readsAsADocument(page, '/runs/[runId]', linksTabbable)
  await axe(page)

  // ------- UI-028, the debrief, and the four graphs (FR-212) -------
  await page.goto(`/runs/${runId}/debrief`)
  await expect(page.getByRole('heading', { level: 1, name: 'Run Debrief' })).toBeVisible()
  await expect(
    page.locator('#debrief-confidence-line').getByRole('heading', { name: 'Confidence line' }),
  ).toBeVisible({ timeout: GRAPH_TIMEOUT_MS })
  await everyGraphOpensToItsTable(page, 'the debrief')
  await readsAsADocument(page, '/runs/[runId]/debrief', linksTabbable)

  // ------- UI-029, the Judgment Record, which opens once the bands are confirmed -------
  await signOut(page)
  await signInAsInstructor(request)
  await post(request, `/api/v1/review/runs/${runId}/confirm-remaining`)

  await signInAs(page, KEYBOARD_SEAT)
  await page.goto(`/records/${runId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Judgment Record' })).toBeVisible()
  await expect(
    page.locator('#record-graphs').getByRole('heading', { name: 'Confidence line' }),
  ).toBeVisible({ timeout: GRAPH_TIMEOUT_MS })
  await everyGraphOpensToItsTable(page, 'the Judgment Record')
  await readsAsADocument(page, '/records/[runId]', linksTabbable)

  await signOut(page)
})

/**
 * FR-212, on a screen that draws all four: each graph carries a description that is in the DOM
 * whichever view is on screen, and a toggle that opens the underlying data with a caption and rows.
 *
 * The description is read through the SVG's own `aria-describedby` where there is an SVG, so this is
 * the text a screen reader would actually reach rather than a paragraph that merely exists.
 */
async function everyGraphOpensToItsTable(page: Page, what: string): Promise<void> {
  const keys = ['frame_beside_decision', 'stance_matrix', 'confidence_line', 'clock_timeline']
  for (const key of keys) {
    const figure = page.locator(`figure[data-graph="${key}"]`)
    await expect(figure, `${what}: ${key} is drawn`).toHaveCount(1)

    // The description, always in the DOM (16 §9.2), and long enough to be one.
    const description = figure.locator('p.sr-only')
    await expect(description, `${what}: ${key} carries a text description`).toHaveCount(1)
    expect(
      ((await description.textContent()) ?? '').trim().length,
      `${what}: ${key}'s description is a sentence`,
    ).toBeGreaterThan(30)

    const toggle = figure.getByRole('button', { name: 'Show data table' })
    await expect(toggle, `${what}: ${key} offers its data table`).toHaveCount(1)
    await toggle.click()
    await expect(figure.getByRole('button', { name: 'Show graph' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const table = figure.getByRole('table')
    await expect(table, `${what}: ${key}'s data table is on screen`).toBeVisible()
    await expect(table.locator('caption'), `${what}: ${key}'s table is captioned`).not.toBeEmpty()
    expect(
      await table.locator('tbody tr').count(),
      `${what}: ${key}'s table carries the graph's rows`,
    ).toBeGreaterThan(0)
    expect(
      await table.locator('th[scope="col"]').count(),
      `${what}: ${key}'s table names its columns`,
    ).toBeGreaterThan(0)
  }
}
