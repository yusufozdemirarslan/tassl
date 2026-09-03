// Request proxy (Next.js 16 `proxy.ts`): stamps x-request-id on the forwarded request and on the
// response (D-086) and sets the baseline security headers. The nonce-based CSP and the remaining
// static headers arrive in Phase 13 (docs/tech/12-security.md §4).
import { NextResponse, type NextRequest } from 'next/server'
import { getOrCreateRequestId } from '@/server/logging/request-id'

export function proxy(request: NextRequest) {
  const requestId = getOrCreateRequestId(request.headers)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('x-request-id', requestId)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-Frame-Options', 'DENY')
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts).*)'],
}
