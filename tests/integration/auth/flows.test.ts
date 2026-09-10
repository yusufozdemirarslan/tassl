// Step 3.2 — the Better Auth flows of docs/tech/08-auth-authz.md §2 end to end against the test
// database: sign-up leaves the account unverified, sign-in refuses it, verification then sign-in
// yields a session, a password reset revokes every session, and the 11th /sign-in/email in a minute
// is rate limited.
//
// The flows run through `auth.api.*` (the server API) wherever they can. Sign-in goes through the
// route handler of `src/app/api/auth/[...all]/route.ts` with a real Request, because the session
// cookie and the rate limiter both live in the HTTP layer: `auth.api` calls skip them.
//
// `sendEmail` is mocked because the verification and reset tokens are signed values that exist
// nowhere but in the email — there is no `verification` row to read them from.
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'

type Outbox = Array<{ to: string; template: string; props: Record<string, string> }>

const outbox = vi.hoisted(() => [] as Outbox)

vi.mock('@/server/email/send', () => ({
  sendEmail: async (input: Outbox[number]) => {
    outbox.push(input)
  },
}))

type Auth = typeof import('@/server/auth/auth')
type Session = typeof import('@/server/auth/session')
type Route = typeof import('@/app/api/auth/[...all]/route')

let auth: Auth['auth']
let getSession: Session['getSession']
let POST: Route['POST']

const APP_URL = 'http://localhost:3000'
const EMAIL = 'flows-seat@example.test'
const PASSWORD = 'Flows-Pass-2026-A' // gitleaks:allow
const NEW_PASSWORD = 'Flows-Pass-2026-B' // gitleaks:allow

/** The token carried by a Better Auth email link, whether it rides in the query or the path. */
function tokenFrom(url: string): string {
  const parsed = new URL(url)
  const fromQuery = parsed.searchParams.get('token')
  if (fromQuery) return fromQuery
  const last = parsed.pathname.split('/').filter(Boolean).at(-1)
  if (!last) throw new Error(`no token in ${url}`)
  return last
}

function lastEmail(template: string): { to: string; props: Record<string, string> } {
  const email = [...outbox].reverse().find((sent) => sent.template === template)
  if (!email) throw new Error(`no ${template} email was sent`)
  return email
}

function signInRequest(body: { email: string; password: string }): Request {
  return new Request(`${APP_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP_URL },
    body: JSON.stringify(body),
  })
}

/** The `Cookie` request header built from a response's Set-Cookie headers. */
function cookiesOf(response: Response): Headers {
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .filter((pair): pair is string => Boolean(pair))
    .join('; ')
  return new Headers({ cookie })
}

async function sessionRowCount(email: string): Promise<number> {
  const rows = await testSql<Array<{ count: string }>>`
    select count(*) as count from session s
    join "user" u on u.id = s.user_id
    where u.email = ${email}`
  return Number(rows[0]?.count ?? '0')
}

describe('better auth flows (08 §2)', () => {
  beforeAll(async () => {
    await truncateAll()
    auth = (await import('@/server/auth/auth')).auth
    getSession = (await import('@/server/auth/session')).getSession
    POST = (await import('@/app/api/auth/[...all]/route')).POST
  })

  afterAll(async () => {
    await truncateAll()
  })

  it('creates an unverified user on sign-up and sends the verification email', async () => {
    await auth.api.signUpEmail({ body: { name: 'Flows Seat', email: EMAIL, password: PASSWORD } })

    const rows = await testSql<Array<{ email_verified: boolean }>>`
      select email_verified from "user" where email = ${EMAIL}`
    expect(rows).toHaveLength(1)
    expect(rows[0]?.email_verified).toBe(false)
    // autoSignIn is false: sign-up must not hand out a session (08 §2.1).
    expect(await sessionRowCount(EMAIL)).toBe(0)

    const verification = lastEmail('verify-email')
    expect(verification.to).toBe(EMAIL)
    expect(verification.props.url).toContain('token=')
  })

  it('refuses sign-in before verification with EMAIL_NOT_VERIFIED', async () => {
    const error = await auth.api
      .signInEmail({ body: { email: EMAIL, password: PASSWORD } })
      .then(() => null)
      .catch((thrown: unknown) => thrown as { status?: string; body?: { code?: string } })

    expect(error).not.toBeNull()
    expect(error?.body?.code).toBe('EMAIL_NOT_VERIFIED')
    expect(error?.status).toBe('FORBIDDEN')
  })

  it('signs in after verification and getSession() resolves the actor', async () => {
    const token = tokenFrom(lastEmail('verify-email').props.url ?? '')
    await auth.api.verifyEmail({ query: { token } })

    const rows = await testSql<Array<{ email_verified: boolean }>>`
      select email_verified from "user" where email = ${EMAIL}`
    expect(rows[0]?.email_verified).toBe(true)

    const response = await POST(signInRequest({ email: EMAIL, password: PASSWORD }))
    expect(response.status).toBe(200)

    const headers = cookiesOf(response)
    const actor = await getSession(headers)
    expect(actor).toMatchObject({
      email: EMAIL,
      name: 'Flows Seat',
      emailVerified: true,
      platformRole: 'none',
      activeOrganizationId: null,
    })
  })

  it('treats a deleted user as signed out (08 §2.6)', async () => {
    const response = await POST(signInRequest({ email: EMAIL, password: PASSWORD }))
    const headers = cookiesOf(response)
    expect(await getSession(headers)).not.toBeNull()

    await testSql`update "user" set deleted_at = now() where email = ${EMAIL}`
    expect(await getSession(headers)).toBeNull()
    await testSql`update "user" set deleted_at = null where email = ${EMAIL}`
  })

  it('revokes every session when the password is reset', async () => {
    const response = await POST(signInRequest({ email: EMAIL, password: PASSWORD }))
    const headers = cookiesOf(response)
    expect(await getSession(headers)).not.toBeNull()
    expect(await sessionRowCount(EMAIL)).toBeGreaterThan(0)

    await auth.api.requestPasswordReset({
      body: { email: EMAIL, redirectTo: `${APP_URL}/reset-password` },
    })
    const token = tokenFrom(lastEmail('reset-password').props.url ?? '')
    await auth.api.resetPassword({ body: { newPassword: NEW_PASSWORD, token } })

    expect(await sessionRowCount(EMAIL)).toBe(0)
    expect(await getSession(headers)).toBeNull()

    const after = await POST(signInRequest({ email: EMAIL, password: NEW_PASSWORD }))
    expect(after.status).toBe(200)
  })

  it(
    'admits a section from one address — 120 sign-ins in a minute — and refuses the 121st (D-712)',
    { timeout: 180_000 },
    async () => {
      await testSql`delete from rate_limit`
      // The per-account lockout (D-704) has counted this file's earlier failed sign-ins for EMAIL;
      // this test is about Better Auth's own per-address limiter, so the other window is emptied.
      const { resetRateLimiter } = await import('@/server/rate-limit/index')
      resetRateLimiter()

      // Sixty seats, made through the server API (no HTTP, so no limiter) and verified by hand so
      // they can sign in; each signs in twice, as a class does when a laptop lid closes.
      const seats: string[] = []
      for (let index = 1; index <= 60; index += 1) {
        const email = `section-seat-${String(index).padStart(2, '0')}@example.test`
        await auth.api.signUpEmail({
          body: { name: `Section Seat ${index}`, email, password: PASSWORD },
        })
        seats.push(email)
      }
      await testSql`update "user" set email_verified = true where email like 'section-seat-%@example.test'`

      const statuses: number[] = []
      for (let round = 0; round < 2; round += 1) {
        for (const email of seats) {
          statuses.push((await POST(signInRequest({ email, password: PASSWORD }))).status)
        }
      }
      expect(statuses).toHaveLength(120)
      expect(statuses.filter((status) => status !== 200)).toEqual([])

      // The ceiling still exists: it is sized for a section, not removed.
      const beyond = await POST(signInRequest({ email: seats[0]!, password: PASSWORD }))
      expect(beyond.status).toBe(429)
    },
  )
})
