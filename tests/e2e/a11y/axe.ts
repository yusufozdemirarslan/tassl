import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * The tag set of B14 (docs/tech/16-performance-a11y-budgets.md §8.1): WCAG 2.0, 2.1 and 2.2, level
 * A and AA. In axe-core 4.13.0 `wcag22aa` carries exactly one rule, `target-size` (2.5.8), which is
 * the criterion 16 §8.5 answers for by hand — every interactive target at least 24 x 24 CSS px.
 * Running it is what turns that sentence into a check.
 */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const

/**
 * Fails the test on any WCAG 2.0/2.1/2.2 A or AA violation on the current page (NFR-006, B14).
 *
 * Every violation, not only the serious and critical ones 16 §8.1 sets as the floor: on a product
 * whose scored surface is entirely text, a "moderate" finding is a heading level or a landmark, and
 * those are the ones a screen-reader user actually navigates by. No rule is disabled anywhere in
 * the suite.
 *
 * The full result is attached to the report as `axe-violations.json` whether or not the scan passes
 * (16 §10: "playwright-report artifact carries axe-violations.json per test"), so a red run says
 * which node on which screen rather than only that a list was not empty. `test.info()` is used
 * rather than a `testInfo` parameter so the sixty-odd call sites stay `axe(page)`.
 */
export async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze()

  const detail = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? 'unknown',
    help: violation.helpUrl,
    nodes: violation.nodes.map((node) => node.target.join(' ')),
  }))
  await test.info().attach('axe-violations.json', {
    body: JSON.stringify({ url: page.url(), violations: detail }, null, 2),
    contentType: 'application/json',
  })

  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)
  expect(summary, summary.join('\n')).toEqual([])
}
