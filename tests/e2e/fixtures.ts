// Playwright fixtures (docs/tech/14-testing-strategy.md §2).
// Step 3.6 adds signInAs() and the console-transport mailbox readers; runToState() and
// advanceClock() arrive with the run phases.
//
// `dotenv/config` is imported for the same reason tests/setup/integration.ts imports it: the seed
// password and the cron secret live in `.env`, which the Playwright process does not otherwise
// read. Both fall back to the documented non-secret defaults (05 §1), so a checkout with no `.env`
// still runs.
import 'dotenv/config'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test as base, type Page } from '@playwright/test'

export { expect } from '@playwright/test'
export { axe } from './a11y/axe'

/** An address out of RFC 2544's benchmarking range: never a real client, and never a real user. */
const syntheticClientIp = (): string => {
  const octet = (): number => Math.floor(Math.random() * 254) + 1
  return `198.18.${octet()}.${octet()}`
}

/**
 * The suite's `test`: every browser context presents its own client address.
 *
 * Better Auth rate-limits its endpoints per IP — 10 sign-ins, sign-ups, reset requests or
 * verification sends a minute (08 §2.6) — and it reads that address from `x-forwarded-for`, the
 * one hop Vercel forwards. Without this, a dozen specs signing in from one machine spend each
 * other's budget and a second run inside the same minute is refused. Each test getting its own
 * address is what a dozen people signing in actually looks like; the limiter itself is proven
 * against a single address in tests/integration/auth/flows.test.ts.
 */
// The fixture's second argument is Playwright's `use`; it is named `provide` here because
// `react-hooks/rules-of-hooks` reads a call to `use()` outside a component as a React hook.
export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, provide) => {
    await provide({ ...extraHTTPHeaders, 'x-forwarded-for': syntheticClientIp() })
  },
  page: async ({ page }, provide) => {
    await provide(settleBeforeNavigating(page))
  },
})

/**
 * Every save in the app ends with `router.refresh()`, and that refresh is still in flight when the
 * success toast appears. Firefox cancels a document load started on top of one and reports
 * `NS_BINDING_ABORTED`; Chromium and WebKit let the new load win. It is a race in the spec rather
 * than a defect in the screen — nobody reloads by hand inside that window — so the lane absorbs it:
 * the page every spec is handed waits for the network to fall quiet before it navigates, and if the
 * navigation is cancelled anyway it is asked for once more. A cancelled load did not happen, so
 * retrying it asserts nothing that was not asked for; a second cancellation is raised. The same
 * wait runs on arrival, so a spec never types into a form React has not attached to yet (D-199).
 */
function settleBeforeNavigating(page: Page): Page {
  const goto = page.goto.bind(page)
  const reload = page.reload.bind(page)

  const settle = async (): Promise<void> => {
    try {
      await page.waitForLoadState('networkidle', { timeout: 10_000 })
    } catch {
      // Still busy after ten seconds: navigate anyway and let the assertions say what is wrong.
    }
  }

  /** Firefox's marker for "the load you asked for was cancelled by another one". */
  const wasCancelled = (error: unknown): boolean =>
    error instanceof Error && error.message.includes('NS_BINDING_ABORTED')

  const navigate = async <T>(attempt: () => Promise<T>): Promise<T> => {
    await settle()
    let answer: T
    try {
      answer = await attempt()
    } catch (error) {
      if (!wasCancelled(error)) throw error
      await settle()
      answer = await attempt()
    }
    // And once more on arrival: 'load' fires before React attaches, and a value typed into a field
    // the form does not own yet is a value it never sees — the field looks filled and the submit
    // carries nothing (D-182 found this in WebKit's password field). A quiet network is the closest
    // honest signal that the page is done becoming itself.
    await settle()
    return answer
  }

  page.goto = async (url, options) => navigate(() => goto(url, options))
  page.reload = async (options) => navigate(() => reload(options))
  return page
}

/** The five walkthrough seat accounts of docs/tech/06-data-model.md §5. */
export type Seat = 'student1' | 'student2' | 'instructor' | 'editor' | 'admin'

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Walkthrough-Pass-2026' // gitleaks:allow

export const seatEmail = (seat: Seat): string => `${seat}@tassl.local`

/** A password that satisfies the 12-128 character rule (08 §2.2) for accounts a spec creates. */
export const TEST_PASSWORD = 'Walkthrough-Spec-2026' // gitleaks:allow

/** An address no other run can collide with: specs create accounts and must not reuse one. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@tassl.test`
}

// ---------------------------------------------------------------------------------------------
// Sign in / sign out
// ---------------------------------------------------------------------------------------------

/**
 * Signing in for a spec whose subject is not the sign-in screen.
 *
 * This posts to `/api/auth/sign-in/email` through the page's own request context — which shares
 * the browser context's cookie jar, so the browser is signed in afterwards — rather than typing
 * into `/sign-in`. Driving the form is the thing being proven in
 * `tests/e2e/auth/sign-up-verify-sign-in.spec.ts`; everywhere else it would add a hydration race
 * (a click landing before React has attached the submit handler is a native GET) to every spec
 * that merely needs a session. The endpoint is the same one the form calls, so the cookie, the
 * session row, and the rate-limit bucket are identical.
 *
 * The per-test client address above keeps the suite inside Better Auth's 10 sign-ins a minute
 * (08 §2.6); a refusal is still waited out once rather than failed on, so a spec that signs in
 * many times, or a proxy that collapses the addresses, degrades to slow rather than red.
 */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const response = await page.request.post('/api/auth/sign-in/email', {
      data: { email, password, rememberMe: true },
      headers: { 'content-type': 'application/json' },
    })
    if (response.ok()) break
    const retryAfter = Number(response.headers()['x-retry-after'] ?? '0')
    if (response.status() !== 429 || attempt > 0) {
      throw new Error(`Sign-in failed for ${email}: ${response.status()} ${await response.text()}`)
    }
    await page.waitForTimeout(Math.min(Math.max(retryAfter, 1), 60) * 1000 + 500)
  }
  await page.goto('/home')
  // The shell renders from the session, so its own h1 is the proof that the session took.
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
}

/**
 * A verified account a spec owns, created through the same endpoints the screens call: sign up,
 * then spend the emailed verification link. `autoSignInAfterVerification` means the browser holds
 * that account's session when this returns.
 *
 * Specs create their own accounts rather than mutating a seat (14 §2): a spec that changes a
 * password, deletes an account, or joins an institution must leave the seeded state exactly as it
 * found it.
 */
export async function createVerifiedAccount(
  page: Page,
  account: { name: string; email: string; password: string },
): Promise<void> {
  const since = Date.now()
  const response = await page.request.post('/api/auth/sign-up/email', {
    data: { ...account, callbackURL: '/verify-email?verified=1' },
    headers: { 'content-type': 'application/json' },
  })
  if (!response.ok()) {
    throw new Error(
      `Sign-up failed for ${account.email}: ${response.status()} ${await response.text()}`,
    )
  }
  const link = await waitForEmailLink(page, account.email, { since })
  const verified = await page.request.get(link)
  if (!verified.ok()) {
    throw new Error(`Verification failed for ${account.email}: ${verified.status()}`)
  }
}

/** Signs in as one of the seed seats with `SEED_PASSWORD`, and returns once `/home` has rendered. */
export async function signInAs(page: Page, seat: Seat): Promise<void> {
  await signIn(page, seatEmail(seat), SEED_PASSWORD)
}

/** The deployment's own origin, which Better Auth requires on a cookie-authenticated POST. */
function appOrigin(page: Page): string {
  const current = page.url()
  if (current.startsWith('http')) return new URL(current).origin
  return process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
}

/**
 * Ends the browser's session: the account menu's own control is proven in the sign-up spec, so
 * teardown revokes the session server-side and empties the jar rather than clicking through the UI.
 *
 * The answer is checked. A sign-out that quietly fails leaves the account this spec created holding
 * a live session, which is exactly what the teardown exists to prevent.
 */
export async function signOut(page: Page): Promise<void> {
  const response = await page.request.post('/api/auth/sign-out', {
    data: {},
    headers: { 'content-type': 'application/json', origin: appOrigin(page) },
  })
  if (!response.ok()) {
    throw new Error(`Sign-out failed: ${response.status()} ${await response.text()}`)
  }
  await page.context().clearCookies()
}

// ---------------------------------------------------------------------------------------------
// The console transport's mailbox
// ---------------------------------------------------------------------------------------------

export type TestEmail = {
  to: string
  subject: string
  html: string
  text: string
  template?: string
  sentAt: string
}

/** Where `consoleTransport` writes under APP_ENV=test (src/server/email/transport.ts). */
const EMAIL_DIR = join(process.cwd(), 'test-results', 'emails')

const CRON_SECRET = process.env.CRON_SECRET ?? 'local-cron-secret' // gitleaks:allow

async function readMailbox(): Promise<TestEmail[]> {
  let files: string[]
  try {
    files = await readdir(EMAIL_DIR)
  } catch {
    return [] // Nothing has been sent yet, so the directory does not exist.
  }
  const messages = await Promise.all(
    files
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => {
        try {
          return JSON.parse(await readFile(join(EMAIL_DIR, file), 'utf8')) as TestEmail
        } catch {
          return null // A file caught mid-write; the next poll reads it whole.
        }
      }),
  )
  return messages
    .filter((message): message is TestEmail => message !== null)
    .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt))
}

/**
 * Runs the job queues (D-012). Emails are enqueued, not sent inline, and the web process only
 * registers job handlers once this route has been hit, so the mailbox poll below kicks it.
 */
export async function drainJobs(page: Page): Promise<void> {
  await page.request.post('/api/internal/jobs/drain', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
}

/**
 * The newest message sent to `address`, waiting for the `send_email` job to run.
 *
 * `since` (a `Date.now()` taken before the action that sends) is what keeps a spec that triggers
 * two emails to one address from reading the first one twice.
 */
export async function waitForEmail(
  page: Page,
  address: string,
  options: { since?: number; timeoutMs?: number } = {},
): Promise<TestEmail> {
  const since = options.since ?? 0
  const deadline = Date.now() + (options.timeoutMs ?? 20_000)
  const wanted = address.toLowerCase()
  for (;;) {
    const messages = await readMailbox()
    const match = messages.filter(
      (message) => message.to.toLowerCase() === wanted && Date.parse(message.sentAt) >= since,
    )
    const newest = match.at(-1)
    if (newest) return newest
    if (Date.now() > deadline) {
      throw new Error(
        `No email for ${address} in ${EMAIL_DIR} (${messages.length} message(s) in the mailbox).`,
      )
    }
    await drainJobs(page)
    await page.waitForTimeout(400)
  }
}

/** The first link in a plain-text body: every template puts its one action first. */
export function firstUrl(text: string): string {
  const match = /https?:\/\/[^\s<>"')\]]+/.exec(text)
  if (!match) throw new Error(`No URL in the email body:\n${text}`)
  return match[0]
}

/** The link out of the newest email sent to `address` — verification, reset, or invitation. */
export async function waitForEmailLink(
  page: Page,
  address: string,
  options: { since?: number; timeoutMs?: number } = {},
): Promise<string> {
  return firstUrl((await waitForEmail(page, address, options)).text)
}
