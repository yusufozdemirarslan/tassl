// UI-030 → Mapping, in the two steps FR-206 takes it in (PRD §7.19, D-095, D-446).
//
// A course may change what a band is worth after runs have been confirmed, and PRD §7.19's edge
// says what has to happen when it does. This spec drives all three halves of it through the screen:
//
//   **The preview writes nothing and prices every confirmed run twice.** Points now and points
//   after, on the same row, because FR-206's sentence is about which exported points will change and
//   a reader can only see that against the ones that will not. The two numbers are checked against
//   the export the run already holds, so "points now" is the gradebook's own figure and not a second
//   opinion about it.
//
//   **Apply is refused without the acknowledgement.** The box says what applying does — every
//   confirmed run in the course is re-exported — and the refusal is at the box rather than in a
//   toast, because the sentence is the point.
//
//   **Applying writes version 2 with the reason `mapping_change`**, and the bands do not move. A
//   mapping change is the course changing what a band is worth, not Tassl changing what the run
//   recorded, so the seven bands are the same seven afterwards and only the number moves.
//
// The run is driven to `scored` through the documented endpoints and confirmed through the
// endpoint UI-033's shortcut calls: the seven decisions are proved through the screen by
// `../walkthrough/12-faculty-replay.spec.ts`, and repeating them here would say nothing about the
// mapping.
import { expect, seatEmail, signInAs, signOut, test, type Seat } from '../fixtures'
import {
  confirmEveryBand,
  driveRunToScored,
  myAssignment,
  readJson,
  WRITE_HEADERS,
} from '../walkthrough/scored-run'
import { addSectionMember, createStudentAssignment, signInAsInstructor } from './api'

/**
 * The seat this run is taken in.
 *
 * `student1` is the seat nineteen browser-driven specs sign in as, and they spend their writes
 * slowly between interactions; this lane spends about fourteen in a few seconds. It is the only
 * seeded seat not already carrying an endpoint-driven run (`editor` has specs 11 and 14, `student2`
 * has 12 and 13), and `scored-run.ts`'s `write` waits a refusal out rather than failing on it, so
 * contention costs time and not a red run.
 */
const STUDENT_SEAT: Seat = 'student1'

/** The mapping this course is moved to; every value differs from the seeded default. */
const NEW_MAPPING = { novice: 2, developing: 4, proficient: 6, professional: 8 }

type ExportRow = { version: number; reason: string; runId: string }
type ReplayView = {
  bands: { dimension: string; effectiveBand: string | null }[]
  points: { confirmed: number | null; mapping: Record<string, number> }
  exports: ExportRow[]
}

test('an instructor previews a mapping change, applies it, and every confirmed run is re-exported', async ({
  page,
  request,
}) => {
  // A full run driven to a confirmed one, then two screens' worth of interaction, is well past
  // Playwright's default patience on a loaded machine (D-188).
  test.setTimeout(600_000)

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Mapping change',
    studentEmail: seatEmail(STUDENT_SEAT),
    variant: 'defective',
  })
  await addSectionMember(request, assignment.section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  // -------------------------------------------------------------------------------------------
  // One confirmed run in the course, so the preview has something to price
  // -------------------------------------------------------------------------------------------

  await signInAs(page, STUDENT_SEAT)
  const mine = await myAssignment(page.request, assignment.label)
  const runId = await driveRunToScored(page.request, mine.assignmentId)
  await signOut(page)

  await signInAsInstructor(request)
  await confirmEveryBand(request, runId)

  const before = await readJson<ReplayView>(request, `/api/v1/review/runs/${runId}`)
  expect(before.points.confirmed, 'the confirmation writes the course’s figure').not.toBe(null)
  expect(before.exports.map((row) => row.version)).toEqual([1])
  expect(before.exports[0]?.reason).toBe('initial')

  // -------------------------------------------------------------------------------------------
  // The preview (FR-206): what would change, and what would not
  // -------------------------------------------------------------------------------------------

  await signInAs(page, 'instructor')
  await page.goto(`/courses/${assignment.course.id}?tab=mapping`)
  await expect(page.getByRole('heading', { level: 1, name: assignment.course.name })).toBeVisible()

  for (const [band, value] of Object.entries(NEW_MAPPING)) {
    const label = band.charAt(0).toUpperCase() + band.slice(1)
    const field = page.getByLabel(label, { exact: true })
    await field.fill(String(value))
  }

  // Nothing has been applied yet: the Apply control does not exist until a preview has been taken.
  await expect(page.getByRole('button', { name: 'Apply the new mapping' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Preview changes' }).click()
  await expect(page.getByRole('heading', { name: 'What would change' })).toBeVisible({
    timeout: 20_000,
  })

  // The run's own row, priced twice. "Points now" is the figure the export already carries, so the
  // left-hand column is the gradebook's own number rather than a second opinion about it.
  const now = (before.points.confirmed ?? 0).toFixed(3)
  const expectedAfter = before.bands
    .map((band) =>
      band.effectiveBand === null
        ? null
        : NEW_MAPPING[band.effectiveBand as keyof typeof NEW_MAPPING],
    )
    .filter((value): value is number => value !== null && value !== undefined)
  const after = (
    expectedAfter.reduce((sum, value) => sum + value, 0) / expectedAfter.length
  ).toFixed(3)

  const row = page.locator('table tbody tr').filter({ hasText: assignment.label })
  await expect(row).toHaveCount(1)
  await expect(row.getByText(now, { exact: true })).toBeVisible()
  await expect(row.getByText(after, { exact: true })).toBeVisible()
  await expect(row.getByText('Moves', { exact: true })).toBeVisible()

  // Still nothing written: a preview is the question, not the act.
  const previewed = await readJson<ReplayView>(request, `/api/v1/review/runs/${runId}`)
  expect(previewed.exports.map((entry) => entry.version)).toEqual([1])

  // -------------------------------------------------------------------------------------------
  // Apply is refused until the acknowledgement is ticked (UI-030)
  // -------------------------------------------------------------------------------------------

  await page.getByRole('button', { name: 'Apply the new mapping' }).click()
  await expect(
    page.getByText(
      'Tick the box above before applying: every confirmed run in this course gets a new export version.',
    ),
  ).toBeVisible()
  const stillOne = await readJson<ReplayView>(request, `/api/v1/review/runs/${runId}`)
  expect(stillOne.exports.map((entry) => entry.version)).toEqual([1])

  // -------------------------------------------------------------------------------------------
  // Applied: version 2 with the reason `mapping_change`, and the bands where they were
  // -------------------------------------------------------------------------------------------

  await page
    .getByRole('checkbox', { name: 'I understand every confirmed run will be re-exported.' })
    .click()
  await page.getByRole('button', { name: 'Apply the new mapping' }).click()

  await expect
    .poll(
      async () => {
        const replay = await readJson<ReplayView>(request, `/api/v1/review/runs/${runId}`)
        return replay.exports.map((entry) => `${String(entry.version)}:${entry.reason}`)
      },
      {
        timeout: 30_000,
        message:
          'FR-206: applying a mapping re-exports every confirmed run in the course with reason `mapping_change`',
      },
    )
    .toEqual(['2:mapping_change', '1:initial'])

  const applied = await readJson<ReplayView>(request, `/api/v1/review/runs/${runId}`)
  expect(applied.points.mapping).toEqual(NEW_MAPPING)
  expect(
    applied.bands.map((band) => band.effectiveBand),
    'a mapping change is the course changing what a band is worth, never Tassl moving a band',
  ).toEqual(before.bands.map((band) => band.effectiveBand))
  expect((applied.points.confirmed ?? 0).toFixed(3)).toBe(after)

  // And the file behind version 2 is downloadable, so the ledger is a ledger rather than a row.
  const file = await request.get(`/api/v1/runs/${runId}/exports/2`, { headers: WRITE_HEADERS })
  expect(file.status(), await file.text()).toBe(200)

  await signOut(page)
})
