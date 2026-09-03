import { expect, test } from '../fixtures'

// D-159: sonner's own [data-styled] rules must not win over the product toast styling.
test('a toast renders in Plex on raised paper with the float shadow and muted description', async ({
  page,
}) => {
  await page.goto('/dev/components')
  await page.getByRole('button', { name: 'Show toast' }).click()
  const toast = page.locator('[data-sonner-toast]').first()
  await expect(toast).toBeVisible()
  const styles = await toast.evaluate((el) => {
    const toastStyle = getComputedStyle(el)
    const description = el.querySelector('[data-description]')
    return {
      fontFamily: toastStyle.fontFamily,
      boxShadow: toastStyle.boxShadow,
      description: description ? getComputedStyle(description).color : null,
    }
  })
  expect(styles.fontFamily).toMatch(/plexSans/)
  expect(styles.boxShadow).toContain('24px')
  expect(styles.description).toBe('rgb(75, 85, 99)')
})
