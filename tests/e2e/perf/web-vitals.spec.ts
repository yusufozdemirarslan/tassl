// B1 and B3 on the pages Lighthouse cannot reach (docs/tech/16-performance-a11y-budgets.md §2.1,
// §2.4, §10).
//
// LHCI asserts `/sign-in` and `/dev/components`, because those are the two addresses a lab run can
// open without a session. The three screens the product is actually judged on — the run workspace,
// the debrief and the faculty replay — are behind a sign-in and behind a run, so their lab numbers
// are taken here: a real session, a real run driven through the documented endpoints, and a
// `PerformanceObserver` for `largest-contentful-paint` and `layout-shift` installed before the
// first byte of the document.
//
// **It never fails.** §2.4 is explicit about why, and it is not timidity: a CI runner shares its
// cores with whatever else GitHub put on the box, and an LCP measured there says more about the
// runner than about the page. Sentry's field data is the authoritative signal for these three
// screens (B1/B2/B3, "Field: Sentry"), and the number here exists so a regression that doubles the
// workspace's LCP is visible in the run log and in `test-results/web-vitals.json` the same day
// rather than a week later in production. A value over §2.1's target prints a warning line and the
// run stays green.
//
// **Chromium only.** `largest-contentful-paint` and `layout-shift` are Chromium's entry types;
// Firefox and WebKit implement neither, so the observer would record nothing and the file would
// carry three zeroes that look like a very fast page. The other two projects run the walkthrough.
//
// **One run, three screens.** D-041 allows one run per student per assignment, so the workspace is
// read while the run is in `working` and the same run is then carried to `scored` for the debrief
// (`continueToDefense` and `completeDefenseAndScore` in ../walkthrough/scored-run.ts), and the
// instructor reads the replay of it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { expect, seatEmail, signInAs, signOut, test } from '../fixtures'
import { addSectionMember, createStudentAssignment, signInAsInstructor } from '../instructor/api'
import {
  completeDefenseAndScore,
  continueToDefense,
  myAssignment,
  reachWorking,
} from '../walkthrough/scored-run'

/** §2.1: every page, every screen. */
const LCP_TARGET_MS = 2500
const CLS_TARGET = 0.1

/** Where §2.4 says the numbers go; the `e2e` job uploads `test-results/` already. */
const OUTPUT = join(process.cwd(), 'test-results', 'web-vitals.json')

type Vitals = { url: string; lcpMs: number; cls: number }

/**
 * The observer, installed on every document this page loads.
 *
 * `buffered: true` replays the entries the browser recorded before the observer existed, which for
 * LCP is the one that matters: the largest paint usually happens before any script of ours runs.
 * Layout shifts with `hadRecentInput` are excluded, as the CLS definition excludes them — a box
 * that moves because somebody opened a disclosure is not a shift they did not ask for.
 */
async function observeVitals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { lcp: 0, cls: 0 }
    ;(window as unknown as { __vitals: typeof state }).__vitals = state
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.lcp = Math.max(state.lcp, entry.startTime)
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }
          if (!shift.hadRecentInput) state.cls += shift.value
        }
      }).observe({ type: 'layout-shift', buffered: true })
    } catch {
      // An engine that does not implement the entry type; the spec skips those projects anyway.
    }
  })
}

const recorded: Vitals[] = []

/** Opens `url`, waits for the screen to be on it and the network quiet, and records what it saw. */
async function record(page: Page, url: string, ready: Locator): Promise<Vitals> {
  await page.goto(url)
  await expect(ready).toBeVisible()
  // The largest paint is not final until the page stops changing; the fixtures' own `settle` has
  // already waited for `networkidle`, and this is the beat that lets a late candidate land.
  await page.waitForTimeout(500)

  const seen = await page.evaluate(
    () => (window as unknown as { __vitals: { lcp: number; cls: number } }).__vitals,
  )
  const vitals: Vitals = {
    url: new URL(page.url()).pathname,
    lcpMs: Math.round(seen.lcp),
    cls: Number(seen.cls.toFixed(4)),
  }
  recorded.push(vitals)

  const over: string[] = []
  if (vitals.lcpMs > LCP_TARGET_MS) over.push(`LCP ${vitals.lcpMs} ms > ${LCP_TARGET_MS} ms`)
  if (vitals.cls > CLS_TARGET) over.push(`CLS ${vitals.cls} > ${CLS_TARGET}`)
  console.log(
    over.length === 0
      ? `web-vitals ok   ${vitals.url}: LCP ${vitals.lcpMs} ms, CLS ${vitals.cls}`
      : `web-vitals WARN ${vitals.url}: ${over.join('; ')} (16 §2.1; informational, Sentry field data is authoritative)`,
  )
  return vitals
}

test('core web vitals on the workspace, the debrief and the faculty replay', async ({
  page,
  request,
  browserName,
}, testInfo) => {
  // largest-contentful-paint and layout-shift are Chromium entry types (16 §2.4), so this spec
  // belongs to the chromium project alone by configuration (playwright.config.ts `testIgnore`),
  // not by a skip inside the test.
  if (browserName !== 'chromium') throw new Error('the perf spec runs on the chromium project only')
  test.setTimeout(600_000)
  recorded.length = 0 // A retry re-measures rather than appending to what the first attempt saw.

  await signInAsInstructor(request)
  const { section, label } = await createStudentAssignment(request, {
    what: 'Web vitals',
    studentEmail: seatEmail('student1'),
    variant: 'defective',
  })
  await addSectionMember(request, section.id, {
    email: seatEmail('instructor'),
    role: 'instructor',
  })

  await observeVitals(page)
  await signInAs(page, 'student1')
  const assignment = await myAssignment(page.request, label)
  const runId = await reachWorking(page.request, assignment.assignmentId)

  // UI-023, in the state a student works in.
  await record(
    page,
    `/runs/${runId}/work`,
    page.getByRole('heading', { level: 1, name: 'The scenario' }),
  )

  // The same run, carried to `scored` so the debrief has bands on it.
  await continueToDefense(page.request, runId)
  await completeDefenseAndScore(page.request, runId)

  // UI-028, with seven drafted bands on it and nothing decided.
  await record(
    page,
    `/runs/${runId}/debrief`,
    page.getByRole('heading', { level: 1, name: 'Run Debrief' }),
  )

  // UI-033, from the reviewer's seat. The replay's own h1 is the student's name, so the anchor is
  // the panel only this view has rather than a title that would have to track a fixture.
  await signOut(page)
  await signInAs(page, 'instructor')
  await record(page, `/review/runs/${runId}`, page.locator('#replay-graphs'))

  mkdirSync(dirname(OUTPUT), { recursive: true })
  const body = JSON.stringify(recorded, null, 2)
  writeFileSync(OUTPUT, body)
  await testInfo.attach('web-vitals.json', { body, contentType: 'application/json' })

  // The one thing this spec does assert: that it measured anything at all. A file of three zeroes
  // would otherwise be indistinguishable from a very fast page, and it is what a broken observer,
  // a changed heading or a page that never painted would all produce.
  for (const vitals of recorded) {
    expect(vitals.lcpMs, `${vitals.url} recorded no largest-contentful-paint`).toBeGreaterThan(0)
  }
})
