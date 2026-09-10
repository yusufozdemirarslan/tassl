// `DEMO_MODE` and the Better Auth options (docs/tech/08-auth-authz.md §1; D-692).
//
// The options are a pure function of the environment, so both modes can be read in one process
// without a second `betterAuth()`. What is pinned is the *difference*, and that it is exactly three
// options and one hook: off, the values are what they have been since Phase 3 — verification
// required, no auto sign-in, the email sent on sign-up, the account created as it came; on, a
// sign-up is verified at creation, signed in at once, and sent nothing.
import { describe, expect, it, vi } from 'vitest'

// The options carry callbacks into the email module and the analytics module; neither is called
// here, and neither should pull the job queue or PostHog into a test about six booleans.
vi.mock('@/server/email/send', () => ({ sendEmail: vi.fn() }))
vi.mock('@/server/analytics/track', () => ({ track: vi.fn() }))

const { authOptionsFor } = await import('@/server/auth/auth')

const base = {
  APP_ENV: 'test' as const,
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'x'.repeat(48),
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
}

const user = {
  id: 'user-1',
  name: 'Lena Ortiz',
  email: 'lena@example.edu',
  emailVerified: false,
  createdAt: new Date('2026-09-01T09:00:00Z'),
  updatedAt: new Date('2026-09-01T09:00:00Z'),
}

describe('authOptionsFor (D-692)', () => {
  it('with DEMO_MODE off, keeps verification required, no auto sign-in, and the email on sign-up', async () => {
    const options = authOptionsFor({ ...base, DEMO_MODE: false })
    expect(options.emailAndPassword.requireEmailVerification).toBe(true)
    expect(options.emailAndPassword.autoSignIn).toBe(false)
    expect(options.emailVerification.sendOnSignUp).toBe(true)
    // The hook leaves the account exactly as it came: unverified until the link is followed.
    await expect(options.databaseHooks.user.create.before(user)).resolves.toBeUndefined()
  })

  it('with DEMO_MODE on, waives verification, signs the person in, sends nothing, and marks the account verified', async () => {
    const options = authOptionsFor({ ...base, DEMO_MODE: true })
    expect(options.emailAndPassword.requireEmailVerification).toBe(false)
    expect(options.emailAndPassword.autoSignIn).toBe(true)
    expect(options.emailVerification.sendOnSignUp).toBe(false)
    await expect(options.databaseHooks.user.create.before(user)).resolves.toEqual({
      data: { ...user, emailVerified: true },
    })
  })

  it('changes nothing else between the two modes', () => {
    const off = authOptionsFor({ ...base, DEMO_MODE: false })
    const on = authOptionsFor({ ...base, DEMO_MODE: true })
    expect(on.baseURL).toBe(off.baseURL)
    expect(on.session).toEqual(off.session)
    expect(on.rateLimit).toEqual(off.rateLimit)
    expect(on.emailAndPassword.minPasswordLength).toBe(off.emailAndPassword.minPasswordLength)
    expect(on.emailVerification.autoSignInAfterVerification).toBe(
      off.emailVerification.autoSignInAfterVerification,
    )
    expect(on.plugins).toHaveLength(off.plugins.length)
  })
})
