/**
 * Prints one screen of a running local build: its URL, its title, its accessible tree and its
 * visible text (docs/manual tooling).
 *
 *   pnpm exec tsx scripts/manual-probe.ts <seat|anon> [path]
 *   pnpm exec tsx scripts/manual-probe.ts instructor /review
 *
 * Use it before editing a capture lane: the accessible tree gives the exact name and role of every
 * control, which is what a lane has to address them by. A tree is also the fastest way to answer
 * "what does this seat actually see here" when the manual and the code disagree.
 */
import { chromium } from '@playwright/test'

const BASE = process.env.MANUAL_BASE_URL ?? 'http://localhost:3000'
const PASSWORD = process.env.SEED_PASSWORD ?? 'Walkthrough-Pass-2026'

async function main(): Promise<void> {
  const seat = process.argv[2] ?? 'instructor'
  const path = process.argv[3] ?? '/home'

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  if (seat !== 'anon') {
    await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Email address').fill(`${seat}@tassl.local`)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 45_000 })
  }
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1800)
  console.log('URL:', page.url())
  console.log('TITLE:', await page.title())
  console.log('======== ARIA ========')
  console.log(await page.locator('body').ariaSnapshot())
  console.log('======== TEXT ========')
  console.log(await page.locator('body').innerText())
  await browser.close()
}

void main()
