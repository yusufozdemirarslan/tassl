// Incident notice (12-security.md §Incident response step 4): sent to the people affected when their
// identity data or authored text was exposed. It never names another person and never characterises
// anyone's intent (FR-006, FR-153); the operator writes title and body from the incident record.
import { Button, Heading, Link, Text } from '@react-email/components'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { t } from '@/lib/i18n/t'
import { EmailLayout, emailStyles } from '@/server/email/layout'
import { appLink } from '@/server/email/links'

export const incidentNoticeProps = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  statusUrl: appLink.optional(),
})

export type IncidentNoticeProps = z.infer<typeof incidentNoticeProps>

export const subject = ({ title }: IncidentNoticeProps): string =>
  t('email.incident.subject', { title })

export default function IncidentNotice({ title, body, statusUrl }: IncidentNoticeProps): ReactNode {
  return (
    <EmailLayout preview={t('email.incident.preview', { title })}>
      <Heading style={emailStyles.heading}>{title}</Heading>
      <Text style={emailStyles.text}>{body}</Text>
      {statusUrl === undefined ? null : (
        <>
          <Text style={emailStyles.text}>
            <Button href={statusUrl} style={emailStyles.button}>
              {t('email.incident.cta')}
            </Button>
          </Text>
          <Text style={emailStyles.muted}>{t('email.linkFallback')}</Text>
          <Text style={emailStyles.muted}>
            <Link href={statusUrl} style={emailStyles.link}>
              {statusUrl}
            </Link>
          </Text>
        </>
      )}
      <Text style={emailStyles.muted}>{t('email.incident.footer')}</Text>
    </EmailLayout>
  )
}

IncidentNotice.PreviewProps = {
  title: 'Access to run records was interrupted on 12 March',
  body: 'Between 09:00 and 09:40 UTC some run records could be read by signed-in members of another institution. Nothing was changed, and no scoring was affected.',
  statusUrl: 'http://localhost:3000/status',
} satisfies IncidentNoticeProps
