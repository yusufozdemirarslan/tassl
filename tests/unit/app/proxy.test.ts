// src/proxy.ts (08 §2.6, 12 §4.2, D-086, D-198): the optimistic hop to /sign-in, the per-request
// nonce and the CSP built from it, and the address stamped on every forwarded request so the guard
// behind the hop knows where the visitor was going.
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { buildCsp, proxy } from '@/proxy'

const SESSION_COOKIE = 'better-auth.session_token'

function request(path: string, init: { cookie?: boolean; headers?: Record<string, string> } = {}) {
  const req = new NextRequest(new URL(path, 'http://localhost:3000'), {
    headers: new Headers(init.headers ?? {}),
  })
  if (init.cookie) req.cookies.set(SESSION_COOKIE, 'a.session')
  return req
}

/** What `NextResponse.next({ request: { headers } })` forwards, as the runtime encodes it. */
const forwarded = (response: Response, name: string): string | null =>
  response.headers.get(`x-middleware-request-${name}`)

describe('proxy', () => {
  it('sends an anonymous visitor on an app path to sign in, saying where they were going', () => {
    const response = proxy(request('/courses/abc/sections/def/roster?tab=people'))
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location') ?? '', 'http://localhost:3000')
    expect(location.pathname).toBe('/sign-in')
    expect(location.searchParams.get('next')).toBe('/courses/abc/sections/def/roster?tab=people')
  })

  it('lets a public path through untouched', () => {
    const response = proxy(request('/sign-in'))
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('stamps the address on a request that carries a cookie, for the guard behind the hop', () => {
    const response = proxy(request('/home', { cookie: true }))
    expect(response.headers.get('location')).toBeNull()
    expect(forwarded(response, 'x-pathname')).toBe('/home')
    expect(forwarded(response, 'x-request-id')).toBeTruthy()
  })

  it('replaces an address the client made up rather than trusting it', () => {
    const response = proxy(
      request('/settings', {
        cookie: true,
        headers: { 'x-pathname': 'https://elsewhere.example' },
      }),
    )
    expect(forwarded(response, 'x-pathname')).toBe('/settings')
  })

  it('carries the policy and the request id on both answers — the redirect included', () => {
    // The redirect is written by this file alone and never reaches the router, so a header it does
    // not set is a header that response does not have.
    for (const response of [proxy(request('/home')), proxy(request('/home', { cookie: true }))]) {
      const csp = response.headers.get('Content-Security-Policy')
      expect(csp).toBeTruthy()
      const nonce = /'nonce-([^']+)'/.exec(csp ?? '')?.[1] ?? ''
      expect(nonce.length).toBeGreaterThan(0)
      expect(csp).toBe(buildCsp(nonce))
      expect(response.headers.get('x-request-id')).toBeTruthy()
    }
  })

  it('mints a fresh nonce per request: the whole security property of one', () => {
    const first = proxy(request('/sign-in')).headers.get('Content-Security-Policy') ?? ''
    const second = proxy(request('/sign-in')).headers.get('Content-Security-Policy') ?? ''
    expect(first).not.toBe(second)
  })

  it('hands the nonce to the renderer twice: in the policy, and as x-nonce (12 §4.2)', () => {
    const response = proxy(request('/sign-in'))
    // Next parses the *request* CSP header for `'nonce-…'` and stamps what it finds onto the scripts
    // it emits; `x-nonce` is the same value in the form a Server Component reads.
    const csp = forwarded(response, 'content-security-policy') ?? ''
    const nonce = forwarded(response, 'x-nonce')
    expect(nonce).toBeTruthy()
    expect(csp).toContain(`'nonce-${nonce ?? ''}'`)
    expect(csp).toBe(response.headers.get('Content-Security-Policy'))
    // And it stays on the request: a response that echoed it would publish the one value the policy
    // depends on being unguessable.
    expect(response.headers.get('x-nonce')).toBeNull()
  })

  it('sets none of the static headers: they are next.config.ts’s, on every path (D-610)', () => {
    // They used to be set here as a Phase-1 placeholder. 12 §4.1 puts them in `next.config.ts`
    // `headers()`, which matches `/(.*)` and so reaches the paths this file's matcher skips —
    // `/api/health`, `/api/auth/*`, `/ingest/*`, `/_next/static/*`. Two setters for one header name
    // is how a response ends up carrying two values for it. `tests/e2e/security/headers.spec.ts`
    // asserts all seven byte for byte on a real response, this one asserts they are not set twice.
    for (const response of [proxy(request('/home')), proxy(request('/sign-in'))]) {
      for (const name of [
        'X-Content-Type-Options',
        'X-Frame-Options',
        'Referrer-Policy',
        'Strict-Transport-Security',
        'Permissions-Policy',
        'Cross-Origin-Opener-Policy',
        'Cross-Origin-Resource-Policy',
      ]) {
        expect([name, response.headers.get(name)]).toEqual([name, null])
      }
    }
  })
})
