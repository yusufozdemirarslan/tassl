// Smoke against a deployment that already exists (docs/prompts/02-qa-and-guides.md Part B):
//
//   PLAYWRIGHT_BASE_URL=https://tassl.vercel.app pnpm test:smoke
//
// Nothing here writes a row. The two probes are the ones the production workflow's curl smoke reads
// too, asserted here with their bodies: liveness answers with the SHA the deploy was built from,
// and readiness answers with the database, the jobs schema and the assistant mode the next
// request will get.
import { expect, test } from '@playwright/test'

test.describe('@smoke health and readiness', () => {
  test('@smoke /api/health answers 200 with the build version', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toContain('no-store')
    const body = (await response.json()) as { status: string; version: string }
    expect(body.status).toBe('ok')
    // A deployment built by production.yml carries the merge commit SHA (D-563 / C14); a local
    // `pnpm start` carries "dev". Either is a value; an empty string is a deploy that lost its SHA.
    expect(body.version).toMatch(/^([0-9a-f]{40}|dev)$/)
    if (process.env.SMOKE_EXPECT_VERSION)
      expect(body.version).toBe(process.env.SMOKE_EXPECT_VERSION)
  })

  test('@smoke /api/ready answers 200 with the database, the jobs schema and the assistant mode', async ({
    request,
  }) => {
    const response = await request.get('/api/ready')
    expect(response.status()).toBe(200)
    const body = (await response.json()) as {
      status: string
      checks: Record<string, string>
      assistantMode: 'live' | 'scripted'
    }
    expect(body.status).toBe('ready')
    expect(body.checks.db).toBe('ok')
    expect(['live', 'scripted']).toContain(body.assistantMode)
    // The mode the deployment is meant to run with, when the caller says (the runbook's warm-up
    // does): production runs live unless the kill switch has been thrown.
    if (process.env.SMOKE_EXPECT_ASSISTANT_MODE) {
      expect(body.assistantMode).toBe(process.env.SMOKE_EXPECT_ASSISTANT_MODE)
    }
  })

  test('@smoke the root redirects a signed-out visitor to the sign-in page', async ({
    request,
  }) => {
    const response = await request.get('/', { maxRedirects: 0 })
    expect([302, 307]).toContain(response.status())
    expect(response.headers()['location']).toMatch(/\/sign-in$/)
  })

  test('@smoke /robots.txt keeps the deployment out of search engines', async ({ request }) => {
    const response = await request.get('/robots.txt')
    expect(response.status()).toBe(200)
    const text = await response.text()
    expect(text).toMatch(/User-Agent: \*/i)
    expect(text).toMatch(/Disallow: \//)
  })
})
