// NFR-012: the five student screens of Phase 6 — the runs list, the policy display, the Readiness
// Check, its concept-map result, and the run workspace in `framing` — carry no WCAG 2.1 A/AA
// violation.
//
// Every screen is scanned with something in it rather than empty, because an empty one proves very
// little: a runs table with no rows has no cells to associate, a check with no items has no radio
// group to name, a room with no documents has no disclosure to expand, and a form nobody has
// submitted has no error to announce. So the run is driven through the states in order and each
// screen is scanned in the state a student meets it in — including the frame form with its
// refusals on screen and a document open in the Evidence Room, which are the two surfaces on
// `/work` that exist only after somebody has acted.
//
// It runs as `student2`, one seat away from `tests/e2e/walkthrough/02-05-start-to-frame.spec.ts`,
// on an assignment it makes for itself: an instructor creates a course, a section, the enrolment
// and an assignment on the **seeded** confirmed package version before the student signs in
// (`createStudentAssignment` in ../instructor/api.ts). The package is the seeded Meridian Roast one
// (06 §5 item 4), so the screens are scanned with the nine documents and sixteen items a real run
// carries; only the assignment is this spec's.
//
// It scanned the seeded walkthrough assignment ("Decision Run 1 (walkthrough)", 06 §5 item 5) until
// Step 6.5's review, and that made it a spec that only passed once. D-041 allows one run per
// student per assignment until it is voided, so the three browser projects collided with each other
// inside one run of the suite, and a second `pnpm test:e2e` against the same database met the
// attempt the first had left. Nothing in the product could take that attempt back out:
// `deleteWalkthroughRun` (D-104), the Delete control on UI-032, is the one thing meant to remove a
// run, and the database refused it — migration 0005 declared every run child table (`run_events`,
// `run_document_opens`, `run_readiness_answers`, `run_readiness_results`, `run_frames`) `ON DELETE
// no action`, so `DELETE FROM runs` raised 23503 for any run that had done anything at all.
// Migration `0012_run_delete_cascade` (D-255) closed that, and the delete now works on a run that
// has been taken. This scan does not depend on it either way: `purgeRuns` in
// `tests/e2e/global-setup.ts` takes its own run out.
import type { APIRequestContext, Page } from '@playwright/test'
import { axe, expect, seatEmail, signInAs, signOut, test } from '../fixtures'
import { createStudentAssignment, signInAsInstructor } from '../instructor/api'

/** Enough answers that the navigator is scanned with both of its states in it. */
const ANSWERED_ITEMS = 3

async function readJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path)
  expect(response.status(), `GET ${path}: ${await response.text()}`).toBe(200)
  return (await response.json()) as T
}

/**
 * The seat's row for this spec's own assignment, with no attempt on it.
 *
 * `/me/assignments` is keyed by the seat's section memberships (10 §3 `listMyAssignments`), so
 * finding the row is also the proof that the enrolment took — and a freshly created assignment
 * cannot carry an attempt, which is what makes the scan below repeatable.
 */
async function assignmentWithNoAttempt(page: Page, label: string): Promise<void> {
  const assignments = await readJson<{
    items: { assignmentId: string; label: string; latestRun: { id: string } | null }[]
  }>(page.request, '/api/v1/me/assignments')
  const assignment = assignments.items.find((item) => item.label === label)
  expect(assignment, `no assignment "${label}" for this seat`).toBeDefined()
  expect(assignment?.latestRun, `"${label}" already carries an attempt`).toBeNull()
}

test('the Phase 6 student run screens have no axe violations', async ({ page, request }) => {
  // Five full-page scans on top of a run driven from the list to the frame is more than the suite's
  // default patience allows on a loaded machine (D-188). The assertions are unchanged.
  test.setTimeout(240_000)

  // The course this scan is taken in, built through the instructor's own endpoints on a request
  // context with its own cookie jar, so the student session below is never disturbed.
  await signInAsInstructor(request)
  const { label } = await createStudentAssignment(request, {
    what: 'Student a11y',
    studentEmail: seatEmail('student2'),
    variant: 'defective',
  })

  await signInAs(page, 'student2')
  await assignmentWithNoAttempt(page, label)

  // UI-020, the runs list, with this seat's assignments in it and a Start on the row that has no
  // attempt yet.
  await page.goto('/runs')
  await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
  const assignmentRow = page.getByRole('row').filter({ hasText: label })
  await expect(assignmentRow).toBeVisible()
  await axe(page)

  // UI-021, the policy display: the counts statement, the policy, the mapping table and the clock.
  await assignmentRow.getByRole('button', { name: `Start ${label}` }).click()
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}\/start$/)
  const runId = new URL(page.url()).pathname.split('/')[2] as string

  await expect(page.getByRole('heading', { level: 1, name: 'Before you begin' })).toBeVisible()
  await expect(page.locator('#run-mapping').getByRole('table')).toBeVisible()
  await axe(page)

  // UI-022, the Readiness Check: the clock, the navigator of sixteen items, and one item's radio
  // group. Three items are answered before the scan so the navigator carries both of its states.
  await page.getByRole('button', { name: 'Begin the Readiness Check' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/readiness$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Readiness Check' })).toBeVisible()

  const navigator = page.getByRole('toolbar', { name: 'Items' })
  await expect(navigator.getByRole('button')).toHaveCount(16)
  for (let position = 1; position <= ANSWERED_ITEMS; position += 1) {
    await page.getByRole('radiogroup').getByRole('radio').first().click()
    await expect(
      navigator.getByRole('button', { name: `Item ${String(position)}, answered` }),
    ).toBeVisible()
    if (position < ANSWERED_ITEMS) await page.getByRole('button', { name: 'Next item' }).click()
  }
  await axe(page)

  // UI-022's result: the concept map, with a row for every idea the check asked about.
  await page.getByRole('button', { name: 'Submit the check' }).click()
  const submitConfirm = page.getByRole('alertdialog')
  await expect(submitConfirm).toContainText('Submit the Readiness Check?')
  await submitConfirm.getByRole('button', { name: 'Submit', exact: true }).click()

  await page.waitForURL(new RegExp(`/runs/${runId}/readiness/result$`))
  await expect(page.getByRole('heading', { level: 1, name: 'What the check read' })).toBeVisible()
  const conceptRows = page.locator('#readiness-concepts').getByRole('listitem')
  expect(await conceptRows.count()).toBeGreaterThanOrEqual(6)
  await axe(page)

  // UI-023 in `framing`: the brief, the Evidence Room with a document open, and the frame form with
  // its refusals on screen.
  await page.getByRole('link', { name: 'Open the scenario' }).click()
  await page.waitForURL(new RegExp(`/runs/${runId}/work$`))
  await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()

  const room = page.locator('#evidence-room')
  const documents = room.getByRole('listitem')
  await expect(documents).toHaveCount(9)
  const firstTitle = (await documents.first().getByRole('heading', { level: 3 }).innerText()).trim()
  await room.getByRole('button', { name: `Open ${firstTitle}` }).click()
  await expect(page.getByRole('article', { name: firstTitle })).toBeVisible()

  await page.getByRole('button', { name: 'Lock the frame' }).click()
  await expect(page.getByText('This is part of the frame. Write something in it.')).toHaveCount(5)
  await axe(page)

  await signOut(page)
})
