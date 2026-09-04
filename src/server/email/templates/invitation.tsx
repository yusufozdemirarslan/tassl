// Institution invitation (SYS-005, 08-auth-authz.md §2.5): sent by tenancy.inviteMember with a link
// to /invitations/{id}. The invitation expires after seven days; the invitee must accept it with the
// same email address.
import { Button, Heading, Link, Text } from '@react-email/components'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { t } from '@/lib/i18n/t'
import { EmailLayout, emailStyles } from '@/server/email/layout'
import { appLink } from '@/server/email/links'

export const invitationProps = z.object({
  url: appLink,
  organizationName: z.string().min(1),
  inviterName: z.string().min(1),
  // Optional: the Better Auth hook in 08 §1 sends url, organizationName and inviterName only.
  role: z.string().min(1).optional(),
})

export type InvitationProps = z.infer<typeof invitationProps>

export const subject = ({ organizationName, inviterName }: InvitationProps): string =>
  t('email.invitation.subject', { organizationName, inviterName })

export default function Invitation({
  url,
  organizationName,
  inviterName,
  role,
}: InvitationProps): ReactNode {
  return (
    <EmailLayout preview={t('email.invitation.preview', { organizationName })}>
      <Heading style={emailStyles.heading}>
        {t('email.invitation.heading', { organizationName })}
      </Heading>
      <Text style={emailStyles.text}>
        {t('email.invitation.body', { organizationName, inviterName })}
      </Text>
      {role === undefined ? null : (
        <Text style={emailStyles.text}>{t('email.invitation.role', { role })}</Text>
      )}
      <Text style={emailStyles.text}>
        <Button href={url} style={emailStyles.button}>
          {t('email.invitation.cta')}
        </Button>
      </Text>
      <Text style={emailStyles.muted}>{t('email.linkFallback')}</Text>
      <Text style={emailStyles.muted}>
        <Link href={url} style={emailStyles.link}>
          {url}
        </Link>
      </Text>
    </EmailLayout>
  )
}

Invitation.PreviewProps = {
  url: 'http://localhost:3000/invitations/00000000-0000-4000-8000-000000000000',
  organizationName: 'Northgate Business School',
  inviterName: 'Ada Lovelace',
  role: 'instructor',
} satisfies InvitationProps
