// src/proxy.ts (08 §2.6, D-086, D-198): the optimistic hop to /sign-in, the baseline headers, and
// the address stamped on every forwarded request so the guard behind the hop knows where the
// visitor was going.
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { proxy } from '@/proxy'

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

  it('carries the baseline security headers on both answers', () => {
    for (const response of [proxy(request('/home')), proxy(request('/home', { cookie: true }))]) {
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(response.headers.get('X-Frame-Options')).toBe('DENY')
      expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
      expect(response.headers.get('x-request-id')).toBeTruthy()
    }
  })
})
