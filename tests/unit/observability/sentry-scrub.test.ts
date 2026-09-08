// @vitest-environment node
// What `beforeSend` is allowed to let through (12 §7, 13 §3.1). Every assertion here is a thing
// that has leaked from a real application: a connection string quoted by a driver error, a
// verification token sitting in the URL of the page that failed, a session cookie the SDK attached
// to the request, and a user object the SDK filled in with an email.
import { describe, expect, it } from 'vitest'
import { scrubSentryEvent, secretValues, stripQuery } from '@/lib/observability/sentry-scrub'

const source = {
  DATABASE_URL: 'postgres://tassl:s3cret-password@db.example.com:5432/tassl',
  BETTER_AUTH_SECRET: 'a'.repeat(40),
  CRON_SECRET: 'short',
  RESEND_API_KEY: 're_live_1234567890',
}

describe('secretValues', () => {
  it('ignores values too short to be matched safely', () => {
    expect(secretValues(source)).not.toContain('short')
    expect(secretValues(source)).toContain(source.DATABASE_URL)
  })
})

describe('stripQuery', () => {
  it('drops the query string and the hash', () => {
    expect(stripQuery('https://app/verify-email?token=abc#x')).toBe('https://app/verify-email')
    expect(stripQuery('https://app/runs/1/work')).toBe('https://app/runs/1/work')
  })
})

describe('scrubSentryEvent', () => {
  it('removes a secret from an exception message and from the event message', () => {
    const event = scrubSentryEvent(
      {
        message: `connect ECONNREFUSED ${source.DATABASE_URL}`,
        exception: { values: [{ type: 'Error', value: `bad key ${source.RESEND_API_KEY}` }] },
      },
      source,
    )
    expect(event.message).toBe('connect ECONNREFUSED [REDACTED]')
    expect(event.exception?.values?.[0]?.value).toBe('bad key [REDACTED]')
  })

  it('strips the token from the request URL and drops cookies, body, and query string', () => {
    const event = scrubSentryEvent(
      {
        request: {
          url: 'https://app.tassl.io/verify-email?token=secret-token',
          query_string: 'token=secret-token',
          cookies: { 'better-auth.session_token': 'abc' },
          data: { justification: 'the student wrote this' },
          headers: {
            cookie: 'better-auth.session_token=abc',
            authorization: 'Bearer x',
            'api-key': 'k',
            'user-agent': 'Chrome',
          },
        },
      },
      source,
    )
    expect(event.request?.url).toBe('https://app.tassl.io/verify-email')
    expect(event.request?.query_string).toBeUndefined()
    expect(event.request?.cookies).toBeUndefined()
    expect(event.request?.data).toBeUndefined()
    expect(event.request?.headers).toEqual({ 'user-agent': 'Chrome' })
  })

  it('keeps the hashed id and nothing else on the user', () => {
    const event = scrubSentryEvent(
      {
        user: { id: 'a1b2c3d4e5f6', email: 'student@example.edu', ip_address: '1.2.3.4' } as never,
      },
      source,
    )
    expect(event.user).toEqual({ id: 'a1b2c3d4e5f6' })
  })

  it('strips tokens from navigation breadcrumbs and drops request bodies from them', () => {
    const event = scrubSentryEvent(
      {
        breadcrumbs: [
          {
            data: {
              url: 'https://app/reset-password?token=abc',
              from: '/sign-in?next=/home',
              to: '/reset-password?token=abc',
              body: 'answer text',
            },
          },
        ],
        extra: { anything: 'at all' },
      },
      source,
    )
    const data = event.breadcrumbs?.[0]?.data
    expect(data?.url).toBe('https://app/reset-password')
    expect(data?.to).toBe('/reset-password')
    expect(data?.from).toBe('/sign-in')
    expect(data?.body).toBeUndefined()
    expect(event.extra).toBeUndefined()
  })
})
