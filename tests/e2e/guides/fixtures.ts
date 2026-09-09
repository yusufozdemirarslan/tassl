// Fixtures for the guide-driven specs (docs/prompts/02-qa-and-guides.md Part B).
//
// The guides and these specs are one artifact: every `### Task N` in a guide is a `test()` here,
// every numbered step is a `test.step('N.M …')`, and every step ends with the screenshot the guide
// embeds. What this file adds on top of `../fixtures` (the suite's own `test`, sign-in helpers and
// the console-transport mailbox):
//
//   * a fixed 1440×900 light viewport with a fixed locale and timezone, so the screenshots the
//     guides embed are the same size and the same shape on every machine;
//   * `shot(task, step)` — writes `docs/guides/screenshots/<persona>/task-NN-step-MM.png`; only
//     the chromium project writes (three engines racing on one file would be three screenshots of
//     the same screen, and the guides embed one), the other projects run the same steps and assert
//     the same things;
//   * an automatic guard that fails the test on any uncaught page error or `console.error` — a
//     screen that renders with an error in the console is a defect the guide must not describe as
//     working;
//   * `advanceRunClock` — the test-only route that shifts a run's whole timeline (D-109), so a step
//     that says "wait for the Turn" waits for the same thing a person would, without the 90 seconds.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { test as suite } from '../fixtures'

export {
  SEED_PASSWORD,
  TEST_PASSWORD,
  createVerifiedAccount,
  drainJobs,
  firstUrl,
  seatEmail,
  signIn,
  signInAs,
  signOut,
  uniqueEmail,
  waitForEmail,
  waitForEmailLink,
  type Seat,
  type TestEmail,
} from '../fixtures'
export { expect }

export type Persona = 'instructor' | 'student' | 'demo'

export type Shooter = (task: number, step: number) => Promise<void>

/** Where the guides read their screenshots from (`docs/guides/<guide>.md` embeds `screenshots/…`). */
export const SCREENSHOT_ROOT = join(process.cwd(), 'docs', 'guides', 'screenshots')

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * Browser noise that is not a defect of the product and that the guard therefore ignores. Each
 * entry names the browser that emits it and why it is not ours to fix. Anything not listed fails
 * the test.
 */
const IGNORED_CONSOLE_PATTERNS: RegExp[] = [
  // WebKit reports a cancelled fetch (a navigation that outran an in-flight poll) as an error.
  /Fetch API cannot load .* due to access control checks/,
  /Load failed/,
  // Firefox announces a navigation that pre-empted a load; Playwright's own fixture retries it.
  /NS_BINDING_ABORTED/,
]

export const test = suite.extend<{
  persona: Persona
  shot: Shooter
  consoleGuard: void
}>({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
  locale: 'en-US',
  timezoneId: 'America/New_York',

  persona: ['student', { option: true }],

  shot: async ({ page, persona, browserName }, provide) => {
    const dir = join(SCREENSHOT_ROOT, persona)
    mkdirSync(dir, { recursive: true })
    await provide(async (task, step) => {
      // Let the last action settle so the screenshot shows the state the guide describes.
      await page.waitForLoadState('domcontentloaded')
      if (browserName !== 'chromium') return
      const path = join(dir, `task-${pad(task)}-step-${pad(step)}.png`)
      mkdirSync(dirname(path), { recursive: true })
      await page.screenshot({ path, fullPage: false, animations: 'disabled' })
    })
  },

  consoleGuard: [
    async ({ page }, provide) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        const text = message.text()
        if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) return
        errors.push(`console.error: ${text}`)
      })
      await provide()
      expect(errors, 'no uncaught page error or console.error during the test').toEqual([])
    },
    { auto: true },
  ],
})

/** Cookie-authenticated mutations under /api/v1 carry X-Requested-With (08 §2.7). */
export const WRITE_HEADERS = {
  'content-type': 'application/json',
  'X-Requested-With': 'tassl',
} as const

/**
 * Shifts a run's whole timeline back by `ms` (test-only route, `APP_ENV=test`, D-109): the way a
 * spec reaches "the Turn has arrived" or "the working clock ran out" without waiting for it.
 */
export async function advanceRunClock(page: Page, runId: string, ms: number): Promise<void> {
  const response = await page.request.post(`/api/v1/test/runs/${runId}/advance-clock`, {
    data: { ms },
    headers: WRITE_HEADERS,
  })
  expect(response.status(), `advance-clock ${runId}: ${await response.text()}`).toBe(200)
}

/** The run id out of a run URL such as `/runs/<id>/work`. */
export function runIdFromUrl(url: string): string {
  const match = /\/runs\/([0-9a-f-]{36})/.exec(url)
  if (!match?.[1]) throw new Error(`No run id in ${url}`)
  return match[1]
}

/** Past the longest Turn delay a run can draw (FR-110: 60 to 120 seconds after the lock). */
export const PAST_THE_TURN_MS = 130_000
