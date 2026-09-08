// Step 13.3 — the Content-Security-Policy of docs/tech/12-security.md §4.1, asserted as the two
// exact strings §4.5 pins (D-115).
//
// The whole string, not a directive at a time. A CSP is one header whose meaning is the join of its
// parts: a test that asked "does it contain `object-src 'none'`" would pass a policy that had lost
// `base-uri`, and a test that asked "does it contain `script-src 'self'`" would pass one that had
// gained `'unsafe-inline'` next to it. So the assertions below are equalities, and the
// environment-conditional parts are asserted as differences from the production string rather than
// as substrings of it.
import { describe, expect, it } from 'vitest'
import { buildCsp } from '@/proxy'

const NONCE = 'abc'

/** 12 §4.5, verbatim: the string a `test` (and a `preview`) response carries. */
const TEST_CSP =
  "default-src 'self'; " +
  "script-src 'self' 'nonce-abc' 'strict-dynamic'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; " +
  "font-src 'self'; " +
  "connect-src 'self'; " +
  "worker-src 'self'; " +
  "manifest-src 'self'; " +
  "media-src 'none'; " +
  "object-src 'none'; " +
  "frame-src 'none'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'"

describe('buildCsp', () => {
  it('is the exact string of 12 §4.5 under APP_ENV=test', () => {
    expect(buildCsp(NONCE, 'test')).toBe(TEST_CSP)
  })

  it('adds upgrade-insecure-requests, and only that, under APP_ENV=production', () => {
    expect(buildCsp(NONCE, 'production')).toBe(`${TEST_CSP}; upgrade-insecure-requests`)
  })

  it('is the test policy under APP_ENV=preview: a preview deploy upgrades nothing', () => {
    // A preview deployment is served over https on a *.vercel.app host, but it is also what the
    // walkthrough is driven against, and `upgrade-insecure-requests` there would rewrite a
    // reviewer's own http:// link into a request the deployment cannot answer (12 §4.1).
    expect(buildCsp(NONCE, 'preview')).toBe(TEST_CSP)
  })

  it('adds unsafe-eval and the dev-server socket under APP_ENV=local, and nothing else', () => {
    const local = buildCsp(NONCE, 'local')

    expect(local).toBe(
      TEST_CSP.replace(
        "script-src 'self' 'nonce-abc' 'strict-dynamic'",
        "script-src 'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval'",
      ).replace("connect-src 'self'", "connect-src 'self' ws://localhost:*"),
    )
    // The two relaxations are local-only in both directions: neither reaches a deployed response.
    for (const deployed of ['test', 'preview', 'production'] as const) {
      expect(buildCsp(NONCE, deployed)).not.toContain('unsafe-eval')
      expect(buildCsp(NONCE, deployed)).not.toContain('ws://localhost')
    }
  })

  it('carries the request’s own nonce, and nothing that would make one unnecessary', () => {
    const first = buildCsp('n1', 'production')
    const second = buildCsp('n2', 'production')

    expect(first).toContain("'nonce-n1'")
    expect(second).toContain("'nonce-n2'")
    expect(first).not.toBe(second)
    // `'unsafe-inline'` in script-src would make every nonce in the document decorative: a browser
    // that sees a nonce ignores `'unsafe-inline'`, and one that does not would run anything.
    expect(first.slice(first.indexOf('script-src'), first.indexOf('; style-src'))).not.toContain(
      'unsafe-inline',
    )
  })

  it('reads APP_ENV when the caller does not name an environment', () => {
    // The parameter exists for the assertions above; the proxy calls it with one argument, and this
    // is the reading that call gets. `APP_ENV=test` is set by tests/setup/unit.ts.
    expect(buildCsp(NONCE)).toBe(buildCsp(NONCE, 'test'))
  })

  it('names no host: every destination the browser opens is this origin (D-115)', () => {
    const csp = buildCsp(NONCE, 'production')

    // PostHog ingest is `/ingest/*` (next.config.ts rewrites), Sentry is `/sentry-tunnel`
    // (withSentryConfig `tunnelRoute`), and both are therefore `connect-src 'self'`. A host name
    // appearing here would mean one of those two proxies had been dropped.
    expect(csp).toContain("connect-src 'self';")
    expect(csp).not.toContain('posthog.com')
    expect(csp).not.toContain('sentry.io')
    expect(csp).not.toContain('https://')
  })
})
