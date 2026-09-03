import { expect, test } from '../fixtures'

// playwright.config.ts starts the server with APP_ENV=test, so the dev routes must answer here;
// the preview/production 404 is covered by tests/unit/app/dev-layout.test.tsx.
test('the component gallery renders under APP_ENV=test', async ({ page }) => {
  const response = await page.goto('/dev/components')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible()
  await expect(page.getByText('Illustrative sample data')).toBeVisible()
})

// Wayfinding on the review surface: a jump row to the three groups, an anchor and source path per
// demo, the token table read from DESIGN.md with its contrast against --paper, and visible captions
// on the radius and shadow samples.
test('the gallery carries a jump row, source paths, token values, and sample captions', async ({
  page,
}) => {
  await page.goto('/dev/components')

  const sections = page.getByRole('navigation', { name: 'Sections' })
  await expect(sections.getByRole('link', { name: 'Tokens' })).toHaveAttribute('href', '#tokens')
  await expect(sections.getByRole('link', { name: 'Layout components' })).toHaveAttribute(
    'href',
    '#layout',
  )
  await expect(sections.getByRole('link', { name: 'UI primitives' })).toHaveAttribute('href', '#ui')
  await sections.getByRole('link', { name: 'UI primitives' }).click()
  await expect(page).toHaveURL(/#ui$/)

  const panelDemo = page.locator('#panel')
  await expect(panelDemo.getByRole('heading', { level: 3, name: 'Panel' })).toBeVisible()
  await expect(panelDemo.getByText('src/components/layout/panel.tsx')).toBeVisible()

  const ink = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '--ink', exact: true }) })
  await expect(ink.getByRole('cell', { name: '#141A26', exact: true })).toBeVisible()
  await expect(ink.getByRole('cell', { name: '16.25:1', exact: true })).toBeVisible()
  const control = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: '--line-control', exact: true }) })
  await expect(
    control.getByRole('cell', { name: 'rgb(20 26 38 / 0.55)', exact: true }),
  ).toBeVisible()
  await expect(control.getByRole('cell', { name: /^3\.8\d:1 over paper$/ })).toBeVisible()

  // Each table's caption names its keyboard-reachable scroll region (the sample's caption is
  // visually hidden so the panel heading is not repeated).
  await expect(page.getByRole('region', { name: /^Color tokens/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Runs in the review queue' })).toBeVisible()

  for (const caption of ['sm 2 px', 'md 6 px', 'lg 10 px', 'float']) {
    await expect(page.getByText(caption, { exact: true })).toBeVisible()
  }

  const lock = page.locator('#buttons').getByRole('button', { name: 'Lock decision' })
  await expect(lock).toHaveAttribute('aria-disabled', 'true')
  await expect(lock).toHaveAccessibleDescription(/not yet allowed/)
})
