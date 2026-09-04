// Email copy of an in-app notification (10-backend-spec-modules.md §notifications: notify() enqueues
// send_email when NOTIFY_EMAIL_COPIES is on). Title and body are written by the notification service;
// no student free text and no scoring detail travel in an email.
import { Button, Heading, Link, Text } from '@react-email/components'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { t } from '@/lib/i18n/t'
import { EmailLayout, emailStyles } from '@/server/email/layout'
import { appLink } from '@/server/email/links'

export const notificationProps = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  url: appLink.optional(),
})

export type NotificationProps = z.infer<typeof notificationProps>

export const subject = ({ title }: NotificationProps): string =>
  t('email.notification.subject', { title })

export default function Notification({ title, body, url }: NotificationProps): ReactNode {
  return (
    <EmailLayout preview={t('email.notification.preview', { title })}>
      <Heading style={emailStyles.heading}>{title}</Heading>
      <Text style={emailStyles.text}>{body}</Text>
      {url === undefined ? null : (
        <>
          <Text style={emailStyles.text}>
            <Button href={url} style={emailStyles.button}>
              {t('email.notification.cta')}
            </Button>
          </Text>
          <Text style={emailStyles.muted}>{t('email.linkFallback')}</Text>
          <Text style={emailStyles.muted}>
            <Link href={url} style={emailStyles.link}>
              {url}
            </Link>
          </Text>
        </>
      )}
      <Text style={emailStyles.muted}>{t('email.notification.footer')}</Text>
    </EmailLayout>
  )
}

Notification.PreviewProps = {
  title: 'Your run has been scored',
  body: 'The draft bands for your run are ready for your instructor to confirm.',
  url: 'http://localhost:3000/notifications',
} satisfies NotificationProps
