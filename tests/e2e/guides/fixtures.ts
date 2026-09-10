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
import { expect, type Locator, type Page } from '@playwright/test'
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

/**
 * Writes the step's screenshot. `show` names what the step's "You see" describes: it is scrolled into
 * view first, so the image carries the heading, counter, or panel the sentence names rather than
 * whatever the top of the page happened to be (D-714). A step whose subject is already in the first
 * viewport passes nothing.
 */
export type Shooter = (task: number, step: number, show?: Locator) => Promise<void>

/** Where the guides read their screenshots from (`docs/guides/<guide>.md` embeds `screenshots/…`). */
export const SCREENSHOT_ROOT =
  process.env.GUIDE_SCREENSHOT_ROOT ?? join(process.cwd(), 'docs', 'guides', 'screenshots')

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * Browser noise that is not a defect of the product and that the guard therefore ignores. Each
 * entry names the browser that emits it and why it is not ours to fix. Anything not listed fails
 * the test.
 */
const IGNORED_CONSOLE_PATTERNS: RegExp[] = [
  // WebKit reports a cancelled fetch (a navigation that outran an in-flight poll, or a link
  // prefetch the sign-out's navigation cut short) as an error — as a console line, or as an
  // unhandled rejection whose whole message is the URL and this phrase.
  /due to access control checks/,
  /Load failed/,
  // Firefox announces a navigation that pre-empted a load; Playwright's own fixture retries it.
  /NS_BINDING_ABORTED/,
  // Chromium and WebKit report every fetch the server answers with an error status as a failed
  // resource. The one such answer a guide describes is the assistant outage (Student guide Task 15):
  // the delegation is refused with ASSISTANT_UNAVAILABLE, 503, and the run pauses — which is the
  // product working, and the step asserts the paused dialog itself.
  /Failed to load resource: the server responded with a status of 503/,
  // WebKit raises this as a window error when a layout pass leaves a ResizeObserver with more to
  // report than one frame delivers; the spec calls it a benign notice, nothing is undelivered for
  // long, and no other engine reports it. It surfaces around Base UI's sheets and the graphs.
  /ResizeObserver loop completed with undelivered notifications/,
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
    await provide(async (task, step, show) => {
      // Let the last action settle so the screenshot shows the state the guide describes.
      await page.waitForLoadState('domcontentloaded')
      if (show) {
        // Every engine scrolls, so the three chains walk the same page; only chromium captures.
        await expect(show).toBeVisible()
        await show.scrollIntoViewIfNeeded()
      }
      if (browserName !== 'chromium') return
      const path = join(dir, `task-${pad(task)}-step-${pad(step)}.png`)
      mkdirSync(dirname(path), { recursive: true })
      await page.screenshot({ path, fullPage: false, animations: 'disabled' })
    })
  },

  consoleGuard: [
    async ({ page }, provide) => {
      const errors: string[] = []
      const pending: Promise<void>[] = []
      const ignored = (text: string): boolean =>
        IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))
      page.on('pageerror', (error) => {
        if (ignored(error.message)) return
        errors.push(`pageerror: ${error.message}`)
      })
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        // Firefox hands an object argument over as "JSHandle@object", which names nothing. The
        // arguments are read out of the page — an Error's name, message and stack, any other
        // object as JSON — so a failure says what was logged and where it came from.
        const describe = async (): Promise<void> => {
          const parts = await Promise.all(
            message.args().map((arg) =>
              arg
                .evaluate((value: unknown) => {
                  if (value instanceof Error)
                    return `${value.name}: ${value.message}
${value.stack ?? ''}`
                  if (typeof value === 'object' && value !== null) {
                    try {
                      return JSON.stringify(value)
                    } catch {
                      return String(value)
                    }
                  }
                  return String(value)
                })
                .catch(() => message.text()),
            ),
          )
          const text = parts.length > 0 ? parts.join(' ') : message.text()
          if (ignored(text)) return
          const { url, lineNumber } = message.location()
          errors.push(`console.error: ${text} (${url}:${String(lineNumber)})`)
        }
        pending.push(describe())
      })
      await provide()
      await Promise.all(pending)
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
  // Outside APP_ENV=test the route does not exist (it answers 404 before it looks at a session),
  // and the guide chain is then running against a deployment — the walkthrough of
  // build-plan step 15.5 — where the only honest way past the clock is to wait for it.
  if (response.status() === 404) {
    await page.waitForTimeout(ms)
    return
  }
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
