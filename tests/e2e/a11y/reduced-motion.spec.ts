// NFR-006, WCAG 2.3.3 (docs/tech/16-performance-a11y-budgets.md §8.6): a reader who has asked their
// system for less motion gets none of ours.
//
// The rule is four lines of `src/app/globals.css` — `transition-duration: 0s !important` on `*`,
// `*::before` and `*::after` inside `@media (prefers-reduced-motion: reduce)` — and four lines of
// CSS are exactly the kind of thing that survives a refactor by being deleted. So this spec toggles
// the media feature on a live page and reads what the browser computed, in both positions:
//
//   * with `no-preference`, the screen must have transitions on it — otherwise the assertion below
//     is a tautology and would pass just as well on a page that never animated anything, or with
//     the whole reduced-motion block removed;
//   * with `reduce`, *every* element on the same screen must compute to `0s`.
//
// Sweeping the whole document rather than naming two elements is the point. A rule written against
// `*` is either true of everything on the page or false, and a per-component list would go stale
// the first time somebody adds a transition to a component nobody put in the list. The failure
// message names the elements that still transition.
//
// The surfaces are the two §8.6 names: the run workspace in `working` — the screen with the most
// motion in the product — with a claim card raised on it, and a dialog opened over it, because a
// dialog is portalled out of the page's own tree and is styled by its own transition classes.
//
// The value asserted is `0s`, which is what the shipped rule sets. 16 §8.6 writes `0.01ms`, the
// convention of the widely copied reduced-motion snippet, whose purpose is to let a `transitionend`
// handler still fire; nothing in this product waits on one, and Phase 1 shipped a real zero
// (D-640). A near-zero would pass this spec's sweep too — it is not zero — so the assertion is on
// the value the stylesheet actually carries.
import type { Page } from '@playwright/test'
import { expect, seatEmail, signInAs, test } from '../fixtures'
import { createStudentAssignment, signInAsInstructor } from '../instructor/api'
import { myAssignment, reachWorking } from '../walkthrough/scored-run'

/** Raises C3, the claim whose card is read below. */
const REQUEST = 'What is the premium payback?'
const CLAIM_KEY = 'C3'

/**
 * Every element in `scope` whose computed `transition-duration` has a non-zero component, named
 * well enough for a failure to say which element it is.
 *
 * `transition-duration` is a list when a rule transitions several properties (`0.15s, 0.15s`), so
 * each entry is read rather than the string compared.
 */
async function transitioning(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((elements) =>
    elements
      .filter((element) =>
        getComputedStyle(element)
          .transitionDuration.split(',')
          .some((duration) => Number.parseFloat(duration) > 0),
      )
      .map((element) => {
        const classes =
          typeof element.className === 'string' ? element.className.split(/\s+/).slice(0, 3) : []
        return `${element.tagName.toLowerCase()}${classes.map((c) => `.${c}`).join('')} (${getComputedStyle(element).transitionDuration})`
      }),
  )
}

test('the workspace, a claim card and a dialog stop transitioning under prefers-reduced-motion', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000)

  await signInAsInstructor(request)
  const { label } = await createStudentAssignment(request, {
    what: 'Reduced motion',
    studentEmail: seatEmail('student1'),
    variant: 'defective',
  })

  await signInAs(page, 'student1')
  const assignment = await myAssignment(page.request, label)
  const runId = await reachWorking(page.request, assignment.assignmentId)

  // The screen is read with a preference first, so what follows is measured against a page that
  // really does animate rather than against a page with nothing on it.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(`/runs/${runId}/work`)
  await expect(page.locator('[data-state="working"]')).toBeVisible()

  // A claim card, so the sweep covers the component §8.6 names. The character count is the proof
  // that React owns the field before the click (D-182).
  const assistant = page.locator('#assistant-panel')
  await assistant.getByLabel('Your request').fill(REQUEST)
  await expect(assistant.getByText(`${String(REQUEST.length)} of 2000 characters`)).toBeVisible()
  await assistant.getByRole('button', { name: 'Ask the assistant' }).click()
  await expect(assistant.locator('#assistant-reply-status')).toContainText('Reply complete')

  const claimCard = assistant.getByRole('article', { name: `Claim ${CLAIM_KEY}` })
  await expect(claimCard).toBeVisible()
  const cardId = 'reduced-motion-card'
  await claimCard.evaluate((element, id) => element.setAttribute('id', id), cardId)

  // A dialog over it: portalled out of the page's tree, with transition classes of its own. It is
  // opened and read, never sent — an accessibility scan has no business spending one of the run's
  // two escalations (FR-090).
  await claimCard.getByRole('button', { name: `Escalate claim ${CLAIM_KEY}` }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Escalate to a colleague')

  const SCOPES = [
    ['the workspace', 'body *'],
    ['the claim card', `#${cardId}, #${cardId} *`],
    ['the dialog', '[role="dialog"], [role="dialog"] *'],
  ] as const

  for (const [where, selector] of SCOPES) {
    const moving = await transitioning(page, selector)
    expect(
      moving.length,
      `${where} has nothing that transitions, so the assertion under reduce would prove nothing:\n${selector}`,
    ).toBeGreaterThan(0)
  }

  // The same page, the same elements, one media feature changed.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(dialog).toBeVisible()

  for (const [where, selector] of SCOPES) {
    const moving = await transitioning(page, selector)
    expect(
      moving,
      `${where} still transitions under prefers-reduced-motion: reduce (16 §8.6)`,
    ).toEqual([])
  }

  // And the two elements §8.6 names by hand, at the exact value globals.css sets.
  //
  // The card is reached by its id rather than by its role: an open modal takes the rest of the
  // document out of the accessibility tree, so `getByRole('article', …)` stops matching the moment
  // the dialog is up. That is the dialog behaving correctly, and it is why the id was set above.
  for (const [where, locator] of [
    ['the claim card', page.locator(`#${cardId}`)],
    ['the dialog', dialog],
  ] as const) {
    const duration = await locator.evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    )
    expect(
      duration.split(',').map((value) => value.trim()),
      where,
    ).toEqual(Array.from({ length: duration.split(',').length }, () => '0s'))
  }
})
