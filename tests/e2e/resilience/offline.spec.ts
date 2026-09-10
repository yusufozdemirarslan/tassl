// C7: the network drops in the middle of an act. The promise is two sentences long — the student
// sees that it failed, and nothing they typed is lost — and this is where it is kept.
//
// The frame is the right screen to prove it on. It is the longest thing a student types before
// anything is saved (a decision, three assumptions, a position and a number), the save is
// irreversible, and it happens behind a confirmation dialog — so a failure that closed the dialog,
// cleared the form, or left the button saying "Locking…" would cost a student the whole of their
// framing period with the clock still running.
//
// The drop is modelled by refusing the request rather than by `context.setOffline`, because that is
// what the student's half of it actually is: the browser has the page, the form and every keystroke
// in it, and the one thing that does not arrive is the response. It is also the same failure for
// every engine, where offline emulation is not.
import type { APIRequestContext } from '@playwright/test'
import { expect, seatEmail, signInAs, test } from '../fixtures'
import { createStudentAssignment, signInAsInstructor } from '../instructor/api'
import { FRAME, post, put, readJson } from '../walkthrough/scored-run'

/** The run in `framing`, its frame not yet filled: steps 2 to 4 through the endpoints. */
async function reachFraming(api: APIRequestContext, assignmentId: string): Promise<string> {
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
      {
        answerKey: item.options[0]?.key,
      },
      204,
    )
  }
  await post(api, `/api/v1/runs/${runId}/readiness/submit`)
  return runId
}

test('the network drops as the frame is locked: the student is told, and their words are still there', async ({
  page,
  request,
}) => {
  await signInAsInstructor(request)
  const { assignment } = await createStudentAssignment(request, {
    what: 'Offline frame',
    studentEmail: seatEmail('student1'),
  })

  await signInAs(page, 'student1')
  const runId = await reachFraming(page.request, assignment.id)
  await page.goto(`/runs/${runId}/work`)

  const decisionBox = page.getByLabel('The decision')
  await decisionBox.fill(FRAME.decision)
  for (const [index, assumption] of FRAME.assumptions.entries()) {
    await page.getByLabel(`Assumption ${String(index + 1)}`).fill(assumption)
  }
  await page.getByLabel('Your position now').fill(FRAME.position)
  await page
    .getByRole('spinbutton', { name: 'Confidence as a number' })
    .fill(String(FRAME.confidence))

  // From here the browser can reach nothing it writes to. A Server Action posts to the page's own
  // address, so the refusal is by method rather than by path; every read the page still makes —
  // the poll in the band, a prefetch — goes through untouched, which is what a dropped connection
  // looks like to a page that is already loaded.
  const dropWrites = async (): Promise<void> => {
    await page.route('**/*', async (route) => {
      if (route.request().method() === 'POST') return route.abort('internetdisconnected')
      return route.continue()
    })
  }
  await dropWrites()

  await page.getByRole('button', { name: 'Lock the frame' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Lock the frame permanently?')
  await confirm.getByRole('button', { name: 'Lock it' }).click()

  // Told: the failure is a sentence on the screen, not a button that stays busy for ever.
  await expect(page.getByText('The frame was not locked. Try again.')).toBeVisible()
  const lockButton = page.getByRole('button', { name: 'Lock the frame' })
  await expect(lockButton).toBeEnabled()
  await expect(confirm).toHaveCount(0)

  // Not lost: every field still holds what was typed into it, and the server was never told
  // anything — the run is still in `framing`, so the student can press again rather than having
  // half a frame recorded against them.
  await expect(decisionBox).toHaveValue(FRAME.decision)
  for (const [index, assumption] of FRAME.assumptions.entries()) {
    await expect(page.getByLabel(`Assumption ${String(index + 1)}`)).toHaveValue(assumption)
  }
  await expect(page.getByLabel('Your position now')).toHaveValue(FRAME.position)
  await expect(page.getByRole('spinbutton', { name: 'Confidence as a number' })).toHaveValue(
    String(FRAME.confidence),
  )
  const stillFraming = await readJson<{ state: string }>(page.request, `/api/v1/runs/${runId}`)
  expect(stillFraming.state).toBe('framing')

  // And the connection comes back: the same press, with nothing retyped, locks the frame.
  await page.unroute('**/*')
  await lockButton.click()
  await expect(page.getByRole('alertdialog')).toContainText('Lock the frame permanently?')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Lock it' }).click()

  await expect(page.locator('#locked-frame')).toContainText(FRAME.decision)
  await expect(page.locator('[data-state="working"]')).toBeVisible()
})
