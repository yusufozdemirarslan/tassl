import { expect, test } from '../fixtures'

// Step 13.3 — every header of docs/tech/12-security.md §4.1 on a real response, byte for byte
// (§4.5). The unit test next door proves `buildCsp` builds the right string; this proves the string
// reaches the wire, on a page and on an API route, together with the seven static headers
// `next.config.ts` sets and the request id `src/proxy.ts` mints.
//
// playwright.config.ts starts the server with APP_ENV=test, so the policy is the test one: no
// `upgrade-insecure-requests` (only production is served over https on a domain of its own) and no
// `'unsafe-eval'` or `ws://localhost:*` (only the dev server needs those).

/** 12 §4.5, with the nonce left as a hole: it is a fresh value per request. */
const CSP_WITHOUT_NONCE = (nonce: string): string =>
  [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `media-src 'none'`,
    `object-src 'none'`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join('; ')

/** The static half of §4.1: the same seven values on every response, whatever produced it. */
const STATIC_HEADERS: Record<string, string> = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const nonceOf = (csp: string): string => {
  const match = /'nonce-([^']+)'/.exec(csp)
  expect(match, `no nonce in the policy: ${csp}`).not.toBeNull()
  return match![1]!
}

test.describe('security headers', () => {
  test('a page carries every header of 12 §4.1, byte for byte', async ({ page }) => {
    const response = await page.goto('/sign-in')
    expect(response?.status()).toBe(200)
    const headers = await response!.allHeaders()

    for (const [name, value] of Object.entries(STATIC_HEADERS)) {
      expect(headers[name], `${name} on /sign-in`).toBe(value)
    }

    const csp = headers['content-security-policy']
    expect(csp, 'no Content-Security-Policy on /sign-in').toBeTruthy()
    expect(csp).toBe(CSP_WITHOUT_NONCE(nonceOf(csp!)))

    // 12 §4.1: Next's own name is not a fact about this deployment anyone needs.
    expect(headers['x-powered-by']).toBeUndefined()
    // `x-nonce` is how the nonce reaches a Server Component (12 §4.2). It is a *request* header;
    // echoing it to the browser would publish the one value the policy depends on staying private.
    expect(headers['x-nonce']).toBeUndefined()
    expect(headers['x-request-id']).toMatch(UUID)
  })

  // The half a header assertion cannot see: a policy is only worth its nonce if the nonce is on the
  // scripts. Next stamps it from the CSP *request* header while rendering, which it can only do for
  // a page rendered per request — so a page that slipped back into the build-time prerender would
  // serve script tags with no nonce, and under `'strict-dynamic'` (which makes a browser ignore
  // `'self'`) every one of them would be blocked. That failure is invisible to a header test and
  // silent in the product: the page renders and never hydrates.
  test('every script in the document carries the policy’s nonce', async ({ page }) => {
    for (const path of ['/sign-in', '/privacy', '/this-route-does-not-exist']) {
      const response = await page.goto(path)
      const csp = (await response!.allHeaders())['content-security-policy']
      const nonce = nonceOf(csp!)

      // The IDL property first, then the attribute. Order matters and is the whole reliability of
      // this test: a browser applying a CSP *hides* the nonce it parsed — the content attribute is
      // cleared to `""` and the value kept on `HTMLScriptElement.nonce` — so reading the attribute
      // first and falling back would report `""` for a correctly nonced script and for an unnonced
      // one alike, and the assertion below would hold on a page where nothing was nonced at all.
      const scripts = await page.locator('script').evaluateAll((nodes) =>
        nodes.map((node) => ({
          nonce: (node as HTMLScriptElement).nonce || node.getAttribute('nonce') || '',
          src: (node as HTMLScriptElement).getAttribute('src') ?? '(inline)',
        })),
      )

      expect(scripts.length, `${path} rendered no script at all`).toBeGreaterThan(0)
      const unnonced = scripts.filter((script) => script.nonce !== nonce)
      expect(
        unnonced,
        `${path} served ${String(unnonced.length)} script(s) without the nonce`,
      ).toEqual([])
    }
  })

  test('an API route carries them too, and is never cached', async ({ request }) => {
    // /api/v1/me answers 401 without a session, which is the point: the headers are on the refusal.
    const response = await request.get('/api/v1/me')
    expect(response.status()).toBe(401)
    const headers = response.headers()

    for (const [name, value] of Object.entries(STATIC_HEADERS)) {
      expect(headers[name], `${name} on /api/v1/me`).toBe(value)
    }
    const csp = headers['content-security-policy']
    expect(csp).toBe(CSP_WITHOUT_NONCE(nonceOf(csp!)))
    expect(headers['x-powered-by']).toBeUndefined()
    expect(headers['x-request-id']).toMatch(UUID)
    expect(headers['cache-control']).toBe('no-store')
  })

  // /api/health is outside the proxy's matcher (17 §5.7): it is the uptime probe, and it must
  // answer identically with or without a session cookie. The static headers still reach it, because
  // `next.config.ts` sets them on `/(.*)` rather than in the proxy.
  test('the uptime probe carries the static headers and no-store', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    const headers = response.headers()

    for (const [name, value] of Object.entries(STATIC_HEADERS)) {
      expect(headers[name], `${name} on /api/health`).toBe(value)
    }
    expect(headers['cache-control']).toBe('no-store')
    expect(headers['x-powered-by']).toBeUndefined()
  })

  test('a request id that is a UUID is honored; anything else is replaced (D-086)', async ({
    request,
  }) => {
    const mine = '11111111-1111-4111-8111-111111111111'

    const page = await request.get('/sign-in', { headers: { 'x-request-id': mine } })
    expect(page.headers()['x-request-id']).toBe(mine)

    const api = await request.get('/api/v1/me', { headers: { 'x-request-id': mine } })
    expect(api.headers()['x-request-id']).toBe(mine)
    // The envelope reports the same id the header carries, so a support request and a log line meet.
    expect(((await api.json()) as { error: { requestId: string } }).error.requestId).toBe(mine)

    const forged = await request.get('/api/v1/me', {
      headers: { 'x-request-id': 'not-a-uuid; drop table runs' },
    })
    const replaced = forged.headers()['x-request-id']
    expect(replaced).toMatch(UUID)
    expect(replaced).not.toBe('not-a-uuid; drop table runs')
  })

  test('the sign-in page redirect from an app path carries the policy and the request id', async ({
    request,
  }) => {
    // The proxy short-circuits an anonymous `(app)` request before Next routes it, so this response
    // is written by `src/proxy.ts` alone (08 §2.6).
    const response = await request.get('/home', { maxRedirects: 0 })
    expect(response.status()).toBe(307)
    expect(response.headers()['location']).toBe('/sign-in?next=%2Fhome')

    const csp = response.headers()['content-security-policy']
    expect(csp).toBe(CSP_WITHOUT_NONCE(nonceOf(csp!)))
    expect(response.headers()['x-request-id']).toMatch(UUID)
    expect(response.headers()['x-frame-options']).toBe('DENY')
  })

  test('no console CSP violation while a signed-out page loads and navigates', async ({ page }) => {
    const violations: string[] = []
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to (load|execute|apply)/i.test(message.text())) {
        violations.push(message.text())
      }
    })

    await page.goto('/sign-in')
    await page
      .getByRole('link', { name: /privacy/i })
      .first()
      .click()
    await page.waitForURL('**/privacy')

    expect(violations).toEqual([])
  })
})

// C9 of docs/prompts/02-qa-and-guides.md: the sign-in page's `next` parameter is reduced to a
// same-site path on the server (`resolveNext` in src/app/(public)/(auth)/sign-in/page.tsx), so an
// absolute URL, a protocol-relative host or a backslash path cannot send a signed-in person off the
// site. Proven through the form, which is the only thing that reads the value.
test.describe('open redirect on sign-in', () => {
  for (const evil of [
    'https://evil.example/',
    '//evil.example/',
    // A backslash path (`/\evil.example`), which some browsers read as `//evil.example`. Built from the
    // character code so the backslash survives every editor and shell that strips one.
    `/${String.fromCharCode(92)}evil.example`,
    'javascript:alert(1)',
  ]) {
    test(`next=${evil} lands on /home after sign-in`, async ({ page }) => {
      await page.goto(`/sign-in?next=${encodeURIComponent(evil)}`)
      await page.getByLabel('Email address').fill('student2@tassl.local')
      await page.getByLabel('Password').fill(process.env.SEED_PASSWORD ?? 'Walkthrough-Pass-2026')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/home$/)
      await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
    })
  }
})
