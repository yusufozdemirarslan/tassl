// Step 3.1 (SYS-001, SYS-010, INT-003): sendEmail() validates and enqueues, the drain runs the
// send_email handler, and the console transport writes the message (log line plus the JSON copy the
// Phase 3.4 e2e reads for its verification link). Job rows live in the pgboss schema, which
// truncateAll() leaves alone, so this suite clears them itself.
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAppError } from '@/lib/errors'
import { env } from '@/server/config'
import { deliverEmail, renderEmail, sendEmail } from '@/server/email/send'
import { TEST_EMAIL_DIR } from '@/server/email/transport'
import { runWithContext } from '@/server/http/request-context'
import { getBoss, stopBoss } from '@/server/jobs/boss'
import { clearHandlers, getHandler, registerHandler, type JobHandler } from '@/server/jobs/handlers'
import { registerAllHandlers } from '@/server/jobs/handlers/register'
import { sendEmailHandler } from '@/server/jobs/handlers/send-email'

const TO = 'ada@example.test'
const VERIFY_URL = `${env.NEXT_PUBLIC_APP_URL}/verify-email?token=tok-integration`

type EmailFile = { to: string; subject: string; html: string; text: string; template: string }

async function readWrittenEmails(): Promise<EmailFile[]> {
  const names = await readdir(TEST_EMAIL_DIR).catch(() => [] as string[])
  return Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        const raw = await readFile(join(TEST_EMAIL_DIR, name), 'utf8')
        return JSON.parse(raw) as EmailFile
      }),
  )
}

/** The error code of a rejected promise, or NO_ERROR when it resolved. */
async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'NO_ERROR'
  } catch (error) {
    return isAppError(error) ? error.code : `UNEXPECTED: ${String(error)}`
  }
}

/** A pino-shaped stub so the transport's log line can be read without touching the root logger. */
function stubLogger(): { logger: Logger; info: ReturnType<typeof vi.fn> } {
  const info = vi.fn()
  const logger = { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() }
  return { logger: logger as unknown as Logger, info }
}

describe('email sending', () => {
  beforeAll(async () => {
    registerAllHandlers()
    const boss = await getBoss()
    await boss.deleteAllJobs()
  })

  beforeEach(async () => {
    await rm(TEST_EMAIL_DIR, { recursive: true, force: true })
    registerHandler('send_email', sendEmailHandler)
  })

  afterAll(async () => {
    clearHandlers()
    await stopBoss()
    await rm(TEST_EMAIL_DIR, { recursive: true, force: true })
  })

  it('registers the send_email handler through the handler registry', () => {
    expect(getHandler('send_email')).toBeDefined()
  })

  it('enqueues a send_email job carrying the validated payload', async () => {
    const handler = vi.fn<JobHandler<'send_email'>>(async () => {})
    registerHandler('send_email', handler)

    await sendEmail({ to: TO, template: 'verify-email', props: { url: VERIFY_URL, name: 'Ada' } })

    // JOBS_DRAIN_ON_ENQUEUE is on and there is no request scope, so the enqueue drains inline (D-012).
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]?.[0]).toEqual({
      to: TO,
      template: 'verify-email',
      props: { url: VERIFY_URL, name: 'Ada' },
    })
  })

  it('delivers through the console transport when the queue drains', async () => {
    await sendEmail({ to: TO, template: 'verify-email', props: { url: VERIFY_URL } })

    const written = await readWrittenEmails()
    expect(written).toHaveLength(1)
    expect(written[0]?.to).toBe(TO)
    expect(written[0]?.template).toBe('verify-email')
    expect(written[0]?.subject).toBe('Confirm your email address for Tassl')
    expect(written[0]?.html).toContain(VERIFY_URL)
    expect(written[0]?.text).toContain(VERIFY_URL)

    const boss = await getBoss()
    expect(await boss.findJobs('send_email', { queued: true })).toHaveLength(0)
  })

  it('logs one `email` line with the template, the transport and the outcome', async () => {
    const { logger, info } = stubLogger()
    await runWithContext({ requestId: 'test', actor: null, logger, startedAt: Date.now() }, () =>
      deliverEmail({ to: TO, template: 'reset-password', props: { url: VERIFY_URL } }),
    )

    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0]?.[0]).toMatchObject({
      event: 'email',
      outcome: 'sent',
      transport: 'console',
      template: 'reset-password',
      subject: 'Reset your Tassl password',
    })
    // The address itself never reaches a log line (13 §2.3).
    expect(JSON.stringify(info.mock.calls[0]?.[0])).not.toContain(TO)
  })

  it('rejects invalid props and bad recipients before anything is queued', async () => {
    // `url` must be an absolute link on this application's own origin (12-security.md, A10).
    expect(
      await errorCode(
        sendEmail({
          to: TO,
          template: 'verify-email',
          props: { url: 'https://phishing.example/verify' },
        }),
      ),
    ).toBe('VALIDATION_ERROR')

    expect(
      await errorCode(
        sendEmail({ to: TO, template: 'notification', props: { title: '', body: 'y' } }),
      ),
    ).toBe('VALIDATION_ERROR')

    expect(
      await errorCode(
        sendEmail({
          to: 'not-an-address',
          template: 'notification',
          props: { title: 'x', body: 'y' },
        }),
      ),
    ).toBe('VALIDATION_ERROR')

    const boss = await getBoss()
    expect(await boss.findJobs('send_email', { queued: true })).toHaveLength(0)
    expect(await readWrittenEmails()).toHaveLength(0)
  })

  it('renders a template to an HTML and a plain-text body', async () => {
    const rendered = await renderEmail('invitation', {
      url: `${env.NEXT_PUBLIC_APP_URL}/invitations/abc`,
      organizationName: 'Northgate',
      inviterName: 'Ada',
    })
    expect(rendered.subject).toBe('Ada invited you to Northgate on Tassl')
    expect(rendered.html).toContain('<html')
    expect(rendered.text).not.toContain('<html')
    expect(rendered.text).toContain('Northgate')
  })

  it('throws on an unknown template so pg-boss retries and then dead-letters the job', async () => {
    expect(await errorCode(deliverEmail({ to: TO, template: 'does-not-exist', props: {} }))).toBe(
      'VALIDATION_ERROR',
    )
  })
})
