import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/** Fails the test on any WCAG 2.1 A/AA violation on the current page (NFR-012). */
export async function axe(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)
  expect(summary, summary.join('\n')).toEqual([])
}
