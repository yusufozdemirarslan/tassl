import { axe, expect, test } from '../fixtures'

// UI-060: the gallery is the accessibility review surface for every component (NFR-006).
test('the component gallery has no axe violations', async ({ page }) => {
  await page.goto('/dev/components')
  await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'UI primitives' })).toBeVisible()
  await axe(page)
})

// The narrowest supported viewport (16 §3): nothing may widen the document, so the nowrap tables
// scroll inside their own containers, and the page still passes axe at that width.
test('the component gallery fits a 360 px viewport without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto('/dev/components')
  await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'UI primitives' })).toBeVisible()

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360)
  await axe(page)
})

// FR-212, 16 §9: every graph is an image with a name, a description that is always in the DOM, and
// a data table a reader can open. The two recharts graphs arrive in a deferred chunk (16 §3.3), so
// this test is also what proves that chunk loads and names its SVG once it does.
test('the four graphs are named images with descriptions, and pass axe', async ({ page }) => {
  await page.goto('/dev/components')
  await expect(page.getByRole('heading', { level: 2, name: 'Graphs' })).toBeVisible()

  const graphs = [
    { anchor: '#confidence-line', key: 'confidence_line', title: 'Confidence line' },
    { anchor: '#clock-timeline', key: 'clock_timeline', title: 'Clock timeline' },
    { anchor: '#stance-matrix', key: 'stance_matrix', title: 'Stance matrix' },
  ]

  for (const graph of graphs) {
    const figure = page.locator(`${graph.anchor} figure[data-graph="${graph.key}"]`)
    await expect(figure).toBeVisible()

    const svg = figure.locator('svg[role="img"]').first()
    await expect(svg).toBeVisible({ timeout: 30_000 })

    // The SVG is named by the visible heading and described by the hidden description.
    const labelledBy = await svg.getAttribute('aria-labelledby')
    const describedBy = await svg.getAttribute('aria-describedby')
    expect(labelledBy).toBeTruthy()
    expect(describedBy).toBeTruthy()
    // React's `useId` puts characters in an id that a CSS id selector would have to escape, so the
    // lookup is by attribute.
    await expect(page.locator(`[id="${labelledBy!}"]`)).toHaveText(graph.title)
    const description = await page.locator(`[id="${describedBy!}"]`).textContent()
    expect(description?.length ?? 0).toBeGreaterThan(30)
  }

  // Frame beside decision is the fourth graph and carries no chart: it is the two records, and its
  // description and table are the same contract.
  const record = page.locator('#frame-beside-decision figure[data-graph="frame_beside_decision"]')
  await expect(record).toBeVisible()
  await expect(record.getByText('Disrupted by the Turn', { exact: false }).first()).toBeVisible()

  await axe(page)
})

test('a graph opens its data table, and an unavailable graph names its missing events', async ({
  page,
}) => {
  await page.goto('/dev/components')
  await expect(page.getByRole('heading', { level: 2, name: 'Graphs' })).toBeVisible()

  const matrix = page.locator('#stance-matrix figure[data-graph="stance_matrix"]')
  await matrix.getByRole('button', { name: 'Show data table' }).click()
  await expect(matrix.getByRole('button', { name: 'Show graph' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const table = matrix.getByRole('table')
  await expect(table).toBeVisible()
  // The Marco fixture carries eleven consequential claims, plus the header row.
  await expect(table.locator('tr')).toHaveCount(12)

  const unavailable = page.locator('#graph-frame-unavailable figure')
  await expect(unavailable.getByRole('status')).toContainText(
    'This graph is not available for this run.',
  )
  await expect(unavailable.getByRole('status')).toContainText('frame_locked, decision_locked')
  await expect(unavailable.getByRole('button')).toHaveCount(0)

  await axe(page)
})
