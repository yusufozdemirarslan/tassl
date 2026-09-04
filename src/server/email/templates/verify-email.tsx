// Verify email (SYS-001, 08-auth-authz.md §2.2): Better Auth's `sendVerificationEmail` hook renders
// this with the token link it builds from NEXT_PUBLIC_APP_URL. Link lifetime: 24 hours.
import { Button, Heading, Link, Text } from '@react-email/components'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { t } from '@/lib/i18n/t'
import { EmailLayout, emailStyles } from '@/server/email/layout'
import { appLink } from '@/server/email/links'

export const verifyEmailProps = z.object({
  url: appLink,
  name: z.string().min(1).optional(),
})

export type VerifyEmailProps = z.infer<typeof verifyEmailProps>

export const subject = (): string => t('email.verify.subject')

export default function VerifyEmail({ url, name }: VerifyEmailProps): ReactNode {
  return (
    <EmailLayout preview={t('email.verify.preview')}>
      <Heading style={emailStyles.heading}>{t('email.verify.heading')}</Heading>
      {name === undefined ? null : (
        <Text style={emailStyles.text}>{t('email.greeting', { name })}</Text>
      )}
      <Text style={emailStyles.text}>{t('email.verify.body')}</Text>
      <Text style={emailStyles.text}>
        <Button href={url} style={emailStyles.button}>
          {t('email.verify.cta')}
        </Button>
      </Text>
      <Text style={emailStyles.muted}>{t('email.linkFallback')}</Text>
      <Text style={emailStyles.muted}>
        <Link href={url} style={emailStyles.link}>
          {url}
        </Link>
      </Text>
      <Text style={emailStyles.muted}>{t('email.verify.ignore')}</Text>
    </EmailLayout>
  )
}

VerifyEmail.PreviewProps = {
  url: 'http://localhost:3000/verify-email?token=preview-token',
  name: 'Ada Lovelace',
} satisfies VerifyEmailProps
