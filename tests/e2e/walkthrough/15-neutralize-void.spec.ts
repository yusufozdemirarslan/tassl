// Step 15 of the walkthrough (PRD §12): **the two corrections a faculty seat can make** — the
// neutralization that admits Tassl was wrong about one claim (FR-003, FR-005, FR-232, D-092), and
// the void that takes a run out of the gradebook altogether (FR-002, FR-008, FR-183).
//
// Two runs, because the step is about two different states.
//
//   **The correction lands on a run that is already finished with.** It is confirmed, the student
//   has answered their debrief so it is recorded, and export v1 is filed — which is the only state
//   in which FR-005's floor and FR-184's re-export mean anything. The planted claim is neutralized
//   through UI-033's dialog and three things are asserted: the recompute is shown to the instructor
//   who pressed it, **no band anywhere is lower than it was**, and a second export version exists.
//   A correction that silently cost a student a band would pass every other test in this suite.
//
//   **The void lands on a run that ran out of clock.** The student framed and then stopped; the
//   working clock expired and the brief was auto-locked for them (FR-105). The instructor voids it
//   and offers another. Two things are asserted: the voided run carries **no partial result** — no
//   export names it, and nothing on its replay can be decided — and the student has a new run
//   waiting, on the other variant of the family, at attempt two.
//
// Both runs are driven through the documented endpoints by `./scored-run.ts` and by hand here; the
// screens that put a student through them are proved by the seven specs before this one.
import { seededPackage } from '../fixture-package'
import { expect, seatEmail, signInAs, signOut, test, type Seat } from '../fixtures'
import { addSectionMember, createStudentAssignment, signInAsInstructor } from '../instructor/api'
import { FRAME, driveRunToScored, myAssignment, post, put, readJson } from './scored-run'

/**
 * The seat these runs are taken in.
 *
 * `student1`, and deliberately: the four seats are spread across the walkthrough lane so that no
 * one of them spends another's D-026 budget in a burst — `editor` carries specs 11 and 14,
 * `student2` carries 12, and this spec's two runs are `student1`'s only endpoint-driven work.
 */
const STUDENT_SEAT: Seat = 'student1'

/** The seeded package's planted claim: the stale payback figure the defective variant carries. */
const PLANTED_CLAIM_KEY = 'C3'

/**
 * How long the correction may take to come back.
 *
 * One press writes the neutralization row, marks the run claim, rebuilds the stance matrix, re-reads
 * two dimensions, floors each against the band the run already stood on, reprices the run and files
 * an export version — one transaction, and the dialog holds the reader until it answers. Five
 * seconds is Playwright's default, not a measurement of that.
 */
const CORRECTION_TIMEOUT_MS = 20_000

const BAND_ORDER = ['novice', 'developing', 'proficient', 'professional'] as const

/** Where a band sits on the four-rung scale; an unassessed dimension is off it. */
const rung = (band: string | null): number =>
  band === null ? -1 : BAND_ORDER.indexOf(band as (typeof BAND_ORDER)[number])

type BandRow = { dimension: string; effectiveBand: string | null }
type ClaimRow = { id: string; key: string }
type ExportRow = { version: number; reason: string }
type ReplayView = {
  run: { state: string; latestExportVersion: number | null }
  bands: BandRow[]
  claims: ClaimRow[]
  exports: ExportRow[]
  points: { confirmed: number | null; effective: number | null }
}

test('walkthrough step 15a: neutralizing the planted claim on a recorded run recomputes, never lowers a band, and re-exports', async ({
  page,
  request,
}) => {
  test.setTimeout(600_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Neutralize',
    studentEmail: seatEmail(STUDENT_SEAT),
    variant: 'defective',
  })
  await addSectionMember(request, assignment.section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  // -------------------------------------------------------------------------------------------
  // A run that is confirmed, recorded, and exported
  // -------------------------------------------------------------------------------------------

  await signInAs(page, STUDENT_SEAT)
  const runId = await driveRunToScored(page.request, assignment.assignment.id)
  await signOut(page)

  await post(request, `/api/v1/review/runs/${runId}/confirm-remaining`)

  await signInAs(page, STUDENT_SEAT)
  await post(page.request, `/api/v1/runs/${runId}/debrief/answers`, {
    stanceToChange:
      'I would have challenged the payback figure rather than accepting it, because nothing in the room dated it after the board deck.',
    doDifferently:
      'I would run a Source Trace on the one number the recommendation rests on before writing the brief around it.',
  })
  await signOut(page)

  const before = await readJson<ReplayView>(request, `/api/v1/review/runs/${runId}`)
  expect(before.run.state, 'the debrief answers move a confirmed run to recorded (FR-152)').toBe(
    'recorded',
  )
  expect(before.run.latestExportVersion, 'confirmation filed export v1').toBe(1)
  expect(before.points.confirmed).not.toBeNull()
  const bandsBefore = new Map(before.bands.map((band) => [band.dimension, band.effectiveBand]))
  const planted = before.claims.find((claim) => claim.key === PLANTED_CLAIM_KEY)
  expect(planted, `the seeded package carries the planted claim ${PLANTED_CLAIM_KEY}`).toBeDefined()

  // -------------------------------------------------------------------------------------------
  // The correction, through UI-033's dialog
  // -------------------------------------------------------------------------------------------

  await signInAs(page, 'instructor')
  await page.goto(`/review/runs/${runId}?tab=actions`)
  await expect(page.getByRole('heading', { level: 2, name: 'Corrections' })).toBeVisible()
  await expect(page.getByText('No correction has been entered on this run.')).toBeVisible()

  await page.getByRole('button', { name: `Enter a correction on ${PLANTED_CLAIM_KEY}…` }).click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('heading', { name: `Enter a correction on claim ${PLANTED_CLAIM_KEY}?` }),
  ).toBeVisible()
  // D-092's checkbox: the instructor says whether the student was right, and nothing answers for
  // them. The PRD's own sentence sits under it.
  await dialog.getByRole('checkbox', { name: 'Credit the student’s challenge as correct' }).check()
  await dialog
    .getByLabel('Note (optional)')
    .fill('The board deck was in the room and the memo that supersedes it was not.')
  await dialog.getByRole('button', { name: 'Enter the correction' }).click()

  // The recompute is shown where it was pressed, not toasted away.
  await expect(dialog.getByRole('heading', { name: 'What the correction moved' })).toBeVisible({
    timeout: CORRECTION_TIMEOUT_MS,
  })
  await expect(
    dialog.getByText('A correction can raise a band and never lowers one.'),
    'FR-005 is stated where the instructor is standing when they wonder about it',
  ).toBeVisible()
  await expect(dialog.getByText(/Export version 2 was written\./)).toBeVisible()
  // `.first()`: the dialog primitive draws its own icon-only close beside the footer's (D-316).
  await dialog.getByRole('button', { name: 'Close' }).first().click()

  // -------------------------------------------------------------------------------------------
  // What the correction may and may not have done (FR-005, FR-184)
  // -------------------------------------------------------------------------------------------

  const after = await readJson<ReplayView>(request, `/api/v1/review/runs/${runId}`)
  for (const band of after.bands) {
    expect(
      rung(band.effectiveBand),
      `FR-005: a correction never lowers a band, and ${band.dimension} moved down`,
    ).toBeGreaterThanOrEqual(rung(bandsBefore.get(band.dimension) ?? null))
  }
  expect(after.run.latestExportVersion, 'FR-184: the correction re-exports the run').toBe(2)
  expect(
    after.exports.find((row) => row.version === 2)?.reason,
    'the second version says why it exists',
  ).toBe('neutralization')
  expect(
    after.exports.find((row) => row.version === 1),
    'the ledger is append-only: version 1 is still readable (D-087)',
  ).toBeDefined()

  // And the run's own screen says so, in the two places a reviewer would look.
  await page.reload()
  await expect(page.getByText('The student’s challenge was credited.')).toBeVisible()
  await page.goto(`/review/runs/${runId}?tab=bands`)
  const exportsPanel = page.locator('#replay-exports')
  await expect(exportsPanel.getByText('A correction was entered')).toBeVisible()
  await expect(exportsPanel.getByRole('link', { name: 'Download version 2' })).toBeVisible()
  await expect(exportsPanel.getByRole('link', { name: 'Download version 1' })).toBeVisible()

  await signOut(page)
})

test('walkthrough step 15b: voiding the run that ran out of clock leaves no partial result and offers another', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Void',
    studentEmail: seatEmail(STUDENT_SEAT),
    variant: 'defective',
  })
  await addSectionMember(request, assignment.section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  // -------------------------------------------------------------------------------------------
  // A run that framed and then ran out of working clock (FR-105's auto-lock)
  // -------------------------------------------------------------------------------------------

  await signInAs(page, STUDENT_SEAT)
  const mine = await myAssignment(page.request, assignment.label)
  const { id: runId } = await post<{ id: string }>(
    page.request,
    `/api/v1/assignments/${mine.assignmentId}/runs`,
    {},
    201,
  )
  await post(page.request, `/api/v1/runs/${runId}/policy-ack`)
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
  await post(page.request, `/api/v1/runs/${runId}/frame`, FRAME)

  // Past the whole working clock: the lock is materialized on the next read (D-042, FR-105).
  await post(page.request, `/api/v1/test/runs/${runId}/advance-clock`, {
    ms: seededPackage().workingClockSeconds * 1000 + 5_000,
  })
  const expired = await readJson<{ state: string }>(page.request, `/api/v1/runs/${runId}`)
  expect(
    expired.state,
    'a working clock that runs out locks the brief for the student (FR-105)',
  ).toBe('decision_locked')
  await signOut(page)

  // -------------------------------------------------------------------------------------------
  // The void, through UI-033's dialog, with a re-offer
  // -------------------------------------------------------------------------------------------

  await signInAs(page, 'instructor')
  await page.goto(`/review/runs/${runId}?tab=actions`)
  await page.getByRole('button', { name: 'Void this run…' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Void this run?' })).toBeVisible()
  // The enum an analytics query groups by, and the sentence the instructor actually wants to write
  // (D-120): the note is kept on the run's own record and in no column anything counts.
  await dialog.getByRole('radio', { name: 'The run cannot be banded at all' }).check()
  await dialog
    .getByLabel('Note (optional)')
    .fill('The clock ran out before the student reached the Decision Brief.')
  await dialog.getByRole('checkbox', { name: 'Offer the student another run' }).check()
  await dialog.getByRole('button', { name: 'Void the run' }).click()

  await expect(
    page.getByText(
      'This run is voided. It carries no partial result, and no export written afterwards names it.',
    ),
  ).toBeVisible()

  // -------------------------------------------------------------------------------------------
  // No partial result, and a new run waiting (FR-002, FR-008, FR-183)
  // -------------------------------------------------------------------------------------------

  const voided = await readJson<ReplayView>(request, `/api/v1/review/runs/${runId}`)
  expect(voided.run.state).toBe('voided')
  expect(voided.exports, 'a voided run appears in no export').toEqual([])
  expect(voided.run.latestExportVersion).toBeNull()
  expect(
    voided.bands.filter((band) => band.effectiveBand !== null),
    'no band survives a void: there is no partial result to keep',
  ).toEqual([])

  await page.goto(`/review/runs/${runId}?tab=bands`)
  await expect(page.getByRole('heading', { level: 3, name: 'No draft bands yet' })).toBeVisible()
  await expect(page.locator('#replay-exports').getByText('No export yet')).toBeVisible()
  await signOut(page)

  // The student has another run, on the other variant, at attempt two.
  await signInAs(page, STUDENT_SEAT)
  const now = await myAssignment(page.request, assignment.label)
  expect(now.latestRun?.id, 'a re-offer is a new run, not the voided one').not.toBe(runId)
  const offered = await readJson<{ state: string; attemptNo: number }>(
    page.request,
    `/api/v1/runs/${String(now.latestRun?.id)}`,
  )
  expect(offered.state, 'the run offered in its place has not been started').toBe('assigned')
  expect(offered.attemptNo, 'FR-008: the replacement is the next attempt').toBe(2)
  await signOut(page)
})
