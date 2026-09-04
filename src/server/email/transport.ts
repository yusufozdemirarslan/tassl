// Email transports: docs/tech/03-adrs.md ADR-014, 05-environment-config.md §1 (EMAIL_TRANSPORT,
// RESEND_API_KEY, EMAIL_FROM), 13-observability-ops.md §2.4 (the `email` log line).
// `console` writes the message to the log (and, under APP_ENV=test, to test-results/emails so the
// Phase 3.4 e2e can read the verification link); `resend` posts it to the Resend API. A failure
// throws: the send_email job then retries three times with backoff (10 §7).
// No `import 'server-only'`: the send_email handler runs in the tsx jobs worker and in Vitest (D-143).
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Resend } from 'resend'
import { env } from '@/server/config'
import { getLogger } from '@/server/http/request-context'
import { hashId } from '@/server/logging/logger'

export type EmailMessage = {
  to: string
  subject: string
  html: string
  text: string
  /** Template name; carried for the `email` log line only, never put on the wire. */
  template?: string
}

export type EmailTransport = {
  send(message: EmailMessage): Promise<void>
}

/** Directory the console transport writes to under APP_ENV=test; read by tests/e2e/auth/*. */
export const TEST_EMAIL_DIR = join(process.cwd(), 'test-results', 'emails')

/** The address never reaches a log line: only its hash and its domain do (13 §2.3). */
const domainOf = (to: string): string => to.slice(to.lastIndexOf('@') + 1)

async function writeTestCopy(message: EmailMessage): Promise<void> {
  await mkdir(TEST_EMAIL_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(TEST_EMAIL_DIR, `${stamp}-${randomUUID().slice(0, 8)}.json`)
  await writeFile(
    file,
    `${JSON.stringify({ ...message, sentAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  )
}

export const consoleTransport: EmailTransport = {
  async send(message) {
    if (env.APP_ENV === 'test') await writeTestCopy(message)
    getLogger().info(
      {
        event: 'email',
        outcome: 'sent',
        transport: 'console',
        template: message.template,
        to: hashId(message.to),
        toDomain: domainOf(message.to),
        subject: message.subject,
        // The body is the point of this transport: locally it is how a verification link is read.
        text: message.text,
      },
      'email sent',
    )
  },
}

let client: Resend | null = null

/** Built on first use so an empty RESEND_API_KEY never constructs a client (05 §1). */
const resendClient = (): Resend => (client ??= new Resend(env.RESEND_API_KEY))

export const resendTransport: EmailTransport = {
  async send(message) {
    const { data, error } = await resendClient().emails.send({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
    if (error) {
      getLogger().warn(
        {
          event: 'email',
          outcome: 'failed',
          transport: 'resend',
          template: message.template,
          to: hashId(message.to),
          toDomain: domainOf(message.to),
          code: error.name,
        },
        'email send failed',
      )
      // Thrown, never swallowed: pg-boss retries the send_email job (10 §7).
      throw new Error(`RESEND_SEND_FAILED: ${error.name}`)
    }
    getLogger().info(
      {
        event: 'email',
        outcome: 'sent',
        transport: 'resend',
        template: message.template,
        to: hashId(message.to),
        toDomain: domainOf(message.to),
        providerId: data?.id,
      },
      'email sent',
    )
  },
}

let transport: EmailTransport | null = null

/** The transport named by EMAIL_TRANSPORT, built once per process. */
export function getTransport(): EmailTransport {
  transport ??= env.EMAIL_TRANSPORT === 'resend' ? resendTransport : consoleTransport
  return transport
}
