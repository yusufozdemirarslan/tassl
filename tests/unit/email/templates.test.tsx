// Step 3.1 (SYS-001, SYS-005, INT-003): every template renders its props, carries its link in both
// the HTML and the plain-text body, takes its strings from en-US, and stays plain (no images).
import { render } from '@react-email/render'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { enUS } from '@/lib/i18n/en-US'
import IncidentNotice, {
  incidentNoticeProps,
  subject as incidentSubject,
  type IncidentNoticeProps,
} from '@/server/email/templates/incident-notice'
import Invitation, {
  invitationProps,
  subject as invitationSubject,
  type InvitationProps,
} from '@/server/email/templates/invitation'
import Notification, {
  notificationProps,
  subject as notificationSubject,
  type NotificationProps,
} from '@/server/email/templates/notification'
import ResetPassword, {
  resetPasswordProps,
  subject as resetSubject,
  type ResetPasswordProps,
} from '@/server/email/templates/reset-password'
import VerifyEmail, {
  subject as verifySubject,
  verifyEmailProps,
  type VerifyEmailProps,
} from '@/server/email/templates/verify-email'

const APP = 'http://localhost:3000'

async function bodies(element: ReactNode): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })])
  return { html, text }
}

describe('verify-email', () => {
  const props: VerifyEmailProps = { url: `${APP}/verify-email?token=tok-1`, name: 'Ada' }

  it('renders the confirmation link in both bodies', async () => {
    const { html, text } = await bodies(<VerifyEmail {...props} />)
    expect(html).toContain(`href="${props.url}"`)
    expect(html).toContain(enUS['email.verify.heading'])
    expect(html).toContain(enUS['email.verify.cta'])
    expect(text).toContain(props.url)
  })

  it('greets by name only when a name is given', async () => {
    const withName = await render(<VerifyEmail {...props} />)
    expect(withName).toContain('Hello Ada,')
    const withoutName = await render(<VerifyEmail url={props.url} />)
    expect(withoutName).not.toContain('Hello')
  })

  it('accepts its props and titles the message', () => {
    expect(verifyEmailProps.parse(props)).toEqual(props)
    expect(verifySubject()).toBe(enUS['email.verify.subject'])
  })
})

describe('reset-password', () => {
  const props: ResetPasswordProps = { url: `${APP}/reset-password?token=tok-2`, name: 'Ada' }

  it('renders the reset link in both bodies', async () => {
    const { html, text } = await bodies(<ResetPassword {...props} />)
    expect(html).toContain(`href="${props.url}"`)
    expect(html).toContain(enUS['email.reset.heading'])
    expect(html).toContain(enUS['email.reset.ignore'])
    expect(text).toContain(props.url)
  })

  it('accepts its props and titles the message', () => {
    expect(resetPasswordProps.parse(props)).toEqual(props)
    expect(resetSubject()).toBe(enUS['email.reset.subject'])
  })
})

describe('invitation', () => {
  const props: InvitationProps = {
    url: `${APP}/invitations/00000000-0000-4000-8000-000000000001`,
    organizationName: 'Northgate Business School',
    inviterName: 'Ada Lovelace',
    role: 'instructor',
  }

  it('renders the invitation link, the institution, the inviter and the role', async () => {
    const { html, text } = await bodies(<Invitation {...props} />)
    expect(html).toContain(`href="${props.url}"`)
    expect(html).toContain(props.organizationName)
    expect(html).toContain(props.inviterName)
    expect(html).toContain('Your role: instructor')
    expect(text).toContain(props.url)
  })

  it('omits the role line when no role is given', async () => {
    const withoutRole: InvitationProps = {
      url: props.url,
      organizationName: props.organizationName,
      inviterName: props.inviterName,
    }
    const html = await render(<Invitation {...withoutRole} />)
    expect(html).not.toContain('Your role')
    expect(invitationProps.parse(withoutRole)).toEqual(withoutRole)
  })

  it('titles the message with the inviter and the institution', () => {
    expect(invitationSubject(props)).toBe(
      'Ada Lovelace invited you to Northgate Business School on Tassl',
    )
  })
})

describe('notification', () => {
  const props: NotificationProps = {
    title: 'Your run has been scored',
    body: 'The draft bands are ready for your instructor to confirm.',
    url: `${APP}/notifications`,
  }

  it('renders the title, the body and the link', async () => {
    const { html, text } = await bodies(<Notification {...props} />)
    expect(html).toContain(props.title)
    expect(html).toContain(props.body)
    expect(html).toContain(`href="${props.url}"`)
    expect(text).toContain(props.url)
  })

  it('renders without a link', async () => {
    const withoutLink: NotificationProps = { title: props.title, body: props.body }
    const html = await render(<Notification {...withoutLink} />)
    expect(html).toContain(props.title)
    expect(html).not.toContain(enUS['email.notification.cta'])
    expect(notificationProps.parse(withoutLink)).toEqual(withoutLink)
  })

  it('titles the message with the notification title', () => {
    expect(notificationSubject(props)).toBe('Your run has been scored · Tassl')
  })
})

describe('incident-notice', () => {
  const props: IncidentNoticeProps = {
    title: 'Access to run records was interrupted',
    body: 'Some run records could be read by members of another institution for forty minutes.',
    statusUrl: `${APP}/status`,
  }

  it('renders the notice and its status link', async () => {
    const { html, text } = await bodies(<IncidentNotice {...props} />)
    expect(html).toContain(props.title)
    expect(html).toContain(props.body)
    expect(html).toContain(`href="${props.statusUrl}"`)
    expect(text).toContain(props.statusUrl)
  })

  it('accepts its props and titles the message', () => {
    expect(incidentNoticeProps.parse(props)).toEqual(props)
    expect(incidentSubject(props)).toBe('Tassl notice · Access to run records was interrupted')
  })
})

describe('every template', () => {
  it('is plain: no images, and carries the standing footer', async () => {
    const elements = [
      <VerifyEmail key="v" url={`${APP}/verify-email?token=t`} />,
      <ResetPassword key="r" url={`${APP}/reset-password?token=t`} />,
      <Invitation key="i" url={`${APP}/invitations/x`} organizationName="Org" inviterName="Ada" />,
      <Notification key="n" title="Title" body="Body" />,
      <IncidentNotice key="x" title="Title" body="Body" />,
    ]
    for (const element of elements) {
      const html = await render(element)
      expect(html).not.toContain('<img')
      expect(html).toContain(enUS['email.footer'])
    }
  })
})
