// The per-account sign-in lockout (D-021 second half, D-704; 08 §2.6, 12 §3).
//
// Better Auth's own limiter counts sign-ins per client address (proven in ./flows.test.ts). This
// is the other half: failed sign-ins are counted per account, whatever address they come from, and
// the eleventh attempt inside a minute is refused before the password is checked. Successful
// sign-ins are never counted, so a seat that many people share is not locked out by its own use.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'

const EMAIL = 'lockout-target@tassl.test'
const PASSWORD = 'Walkthrough-Lockout-2026' // gitleaks:allow

type Auth = typeof import('@/server/auth/auth')

let auth: Auth['auth']

/** One sign-in attempt from its own client address, so the per-address limiter never fires. */
async function attempt(password: string, index: number): Promise<number> {
  const response = await auth.handler(
    new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        'x-forwarded-for': `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}`,
      },
      body: JSON.stringify({ email: EMAIL, password }),
    }),
  )
  return response.status
}

beforeEach(async () => {
  await truncateAll()
  auth = (await import('@/server/auth/auth')).auth
  await auth.api.signUpEmail({ body: { name: 'Lockout Target', email: EMAIL, password: PASSWORD } })
  // Verified the way the seed verifies a seat: a sign-in with the right password must succeed, and
  // an unverified account is refused with 403 before this suite's control is reached.
  await testSql`update "user" set email_verified = true where email = ${EMAIL}`
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

describe('per-account sign-in lockout', () => {
  it('refuses the eleventh failed attempt in a minute, from any address, and then the right password too', async () => {
    const statuses: number[] = []
    for (let index = 0; index < 11; index += 1)
      statuses.push(await attempt('wrong-password-000', index))
    // Ten wrong passwords are answered as wrong passwords; the eleventh is refused as a lockout.
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true)
    expect(statuses[10]).toBe(429)
    // The lockout holds for the right password as well: that is what makes it a lockout.
    expect(await attempt(PASSWORD, 50)).toBe(429)
  })

  it('never counts successful sign-ins, so a shared seat is not locked out by its own use', async () => {
    for (let index = 0; index < 12; index += 1) expect(await attempt(PASSWORD, index)).toBe(200)
  })

  it('counts the address-insensitive way: failures spread over addresses still add up', async () => {
    for (let index = 0; index < 5; index += 1) expect(await attempt('wrong-a', index)).toBe(401)
    for (let index = 100; index < 105; index += 1) expect(await attempt('wrong-b', index)).toBe(401)
    expect(await attempt('wrong-c', 200)).toBe(429)
  })
})
