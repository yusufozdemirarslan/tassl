// Email rendering and sending: docs/tech/03-adrs.md ADR-014, 10-backend-spec.md §7 (send_email),
// 13-observability-ops.md §2.4. Every send goes through the queue: sendEmail() validates the props
// and enqueues, the send_email handler calls deliverEmail(), which renders the template and hands
// the message to the transport. Rendering in the job (not at the call site) keeps the payload small
// and lets a failed render retry.
// No `import 'server-only'`: the send_email handler runs in the tsx jobs worker and in Vitest (D-143).
// Rendering needs `react-dom/server`, which does not exist under the `react-server` export
// condition; `emailRenderingSupport()` below is how a process finds out before it claims a job.
import { render } from '@react-email/render'
import type { ReactNode } from 'react'
import { z, type ZodType } from 'zod'
import { AppError } from '@/lib/errors'
import { emailAddress } from '@/server/email/links'
import IncidentNotice, {
  incidentNoticeProps,
  subject as incidentNoticeSubject,
} from '@/server/email/templates/incident-notice'
import Invitation, {
  invitationProps,
  subject as invitationSubject,
} from '@/server/email/templates/invitation'
import Notification, {
  notificationProps,
  subject as notificationSubject,
} from '@/server/email/templates/notification'
import ResetPassword, {
  resetPasswordProps,
  subject as resetPasswordSubject,
} from '@/server/email/templates/reset-password'
import VerifyEmail, {
  subject as verifyEmailSubject,
  verifyEmailProps,
} from '@/server/email/templates/verify-email'
import { getTransport } from '@/server/email/transport'
import { enqueue } from '@/server/jobs/enqueue'
import type { Payload } from '@/server/jobs/queues'

export type TemplateDefinition<P> = {
  schema: ZodType<P>
  component: (props: P) => ReactNode
  subject: (props: P) => string
}

/** Every email Tassl can send. Adding a row here is the only way to add a template. */
export const TEMPLATES = {
  'verify-email': {
    schema: verifyEmailProps,
    component: VerifyEmail,
    subject: verifyEmailSubject,
  },
  'reset-password': {
    schema: resetPasswordProps,
    component: ResetPassword,
    subject: resetPasswordSubject,
  },
  invitation: {
    schema: invitationProps,
    component: Invitation,
    subject: invitationSubject,
  },
  notification: {
    schema: notificationProps,
    component: Notification,
    subject: notificationSubject,
  },
  'incident-notice': {
    schema: incidentNoticeProps,
    component: IncidentNotice,
    subject: incidentNoticeSubject,
  },
} as const

export type EmailTemplate = keyof typeof TEMPLATES
export type EmailProps<T extends EmailTemplate> = z.infer<(typeof TEMPLATES)[T]['schema']>

export const EMAIL_TEMPLATES = Object.keys(TEMPLATES) as EmailTemplate[]

export const isEmailTemplate = (value: string): value is EmailTemplate =>
  Object.prototype.hasOwnProperty.call(TEMPLATES, value)

// One lookup type that all five definitions satisfy: `unknown` output on the schema (ZodType is
// covariant in its output) and `never` in the callback parameter position (functions are
// contravariant there), so no definition has to be cast to be read generically.
type AnyTemplate = {
  schema: ZodType<unknown>
  component: (props: never) => ReactNode
  subject: (props: never) => string
}

const definition = (template: EmailTemplate): AnyTemplate => TEMPLATES[template]

/** Parses props against the template's schema; throws VALIDATION_ERROR before anything is queued. */
export function parseEmailProps<T extends EmailTemplate>(
  template: T,
  props: unknown,
): EmailProps<T> {
  const parsed = definition(template).schema.safeParse(props)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', `Invalid props for the ${template} email.`, {
      details: z.flattenError(parsed.error),
    })
  }
  return parsed.data as EmailProps<T>
}

export type RenderedEmail = { subject: string; html: string; text: string }

/** Renders one template to the HTML and plain-text bodies plus its subject line. */
export async function renderEmail<T extends EmailTemplate>(
  template: T,
  props: EmailProps<T>,
): Promise<RenderedEmail> {
  const entry = definition(template)
  const element = entry.component(props as never)
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })])
  return { subject: entry.subject(props as never), html, text }
}

export type EmailRenderingSupport = { ok: true } | { ok: false; reason: string }

let support: Promise<EmailRenderingSupport> | null = null

/**
 * Whether this process can render an email at all — decided once, by rendering an empty document
 * through the same `render()` a delivery uses (D-431).
 *
 * `render()` reaches `react-dom/server`, and React resolves that specifier to a module whose only
 * statement is `throw new Error('react-dom/server is not supported in React Server Components.')`
 * for anyone using the `react-server` export condition. Node applies `--conditions` to the whole
 * process, so `pnpm db:seed` (`tsx --conditions=react-server`, which the seed needs because it
 * reaches `server-only` through the scenarios service, D-214) has no HTML renderer at all, and
 * nothing it drains from `send_email` can ever succeed. The Next.js server is not in that state:
 * Turbopack resolves the real `react-dom/server` in every server layer, so the drain route and the
 * `after()` drain render email normally.
 *
 * The probe is the real code path rather than a guess about the resolver, so it cannot disagree
 * with what `deliverEmail` will do a moment later.
 */
export function emailRenderingSupport(): Promise<EmailRenderingSupport> {
  support ??= render(null).then(
    (): EmailRenderingSupport => ({ ok: true }),
    (error: unknown): EmailRenderingSupport => ({
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }),
  )
  return support
}

export type SendEmailInput<T extends EmailTemplate> = {
  to: string
  template: T
  props: EmailProps<T>
}

/**
 * Validates and queues one email (SYS-010). Never renders and never talks to a provider: the
 * send_email job does both, so a slow or failing provider cannot slow down a request.
 */
export async function sendEmail<T extends EmailTemplate>({
  to,
  template,
  props,
}: SendEmailInput<T>): Promise<void> {
  const recipient = emailAddress.safeParse(to)
  if (!recipient.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid email recipient.', {
      details: z.flattenError(recipient.error),
    })
  }
  const validated = parseEmailProps(template, props)
  await enqueue('send_email', {
    to: recipient.data,
    template,
    props: { ...validated },
  })
}

/** The send_email job body: re-validate (the payload has been through the queue), render, send. */
export async function deliverEmail(payload: Payload<'send_email'>): Promise<void> {
  if (!isEmailTemplate(payload.template)) {
    throw new AppError('VALIDATION_ERROR', `Unknown email template: ${payload.template}.`)
  }
  const to = emailAddress.parse(payload.to)
  const props = parseEmailProps(payload.template, payload.props)
  const rendered = await renderEmail(payload.template, props)
  await getTransport().send({ to, template: payload.template, ...rendered })
}
