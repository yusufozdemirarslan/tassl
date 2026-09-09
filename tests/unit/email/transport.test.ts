// The email transport as a function of the environment (docs/tech/05-environment-config.md §1;
// D-692). `EMAIL_TRANSPORT` names it; `DEMO_MODE` forces the console whatever it says, because a
// judged demo signs people up with addresses nobody should be writing to.
import { describe, expect, it } from 'vitest'
import { consoleTransport, resendTransport, transportFor } from '@/server/email/transport'

describe('transportFor (D-692)', () => {
  it('follows EMAIL_TRANSPORT when DEMO_MODE is off', () => {
    expect(transportFor({ EMAIL_TRANSPORT: 'console', DEMO_MODE: false })).toBe(consoleTransport)
    expect(transportFor({ EMAIL_TRANSPORT: 'resend', DEMO_MODE: false })).toBe(resendTransport)
  })

  it('is the console under DEMO_MODE even when EMAIL_TRANSPORT names Resend', () => {
    expect(transportFor({ EMAIL_TRANSPORT: 'resend', DEMO_MODE: true })).toBe(consoleTransport)
    expect(transportFor({ EMAIL_TRANSPORT: 'console', DEMO_MODE: true })).toBe(consoleTransport)
  })
})
