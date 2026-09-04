// Reset password (SYS-002, 08-auth-authz.md §2.3): Better Auth's `sendResetPassword` hook renders
// this. Link lifetime: one hour; using it revokes every other session.
import { Button, Heading, Link, Text } from '@react-email/components'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { t } from '@/lib/i18n/t'
import { EmailLayout, emailStyles } from '@/server/email/layout'
import { appLink } from '@/server/email/links'

export const resetPasswordProps = z.object({
  url: appLink,
  name: z.string().min(1).optional(),
})

export type ResetPasswordProps = z.infer<typeof resetPasswordProps>

export const subject = (): string => t('email.reset.subject')

export default function ResetPassword({ url, name }: ResetPasswordProps): ReactNode {
  return (
    <EmailLayout preview={t('email.reset.preview')}>
      <Heading style={emailStyles.heading}>{t('email.reset.heading')}</Heading>
      {name === undefined ? null : (
        <Text style={emailStyles.text}>{t('email.greeting', { name })}</Text>
      )}
      <Text style={emailStyles.text}>{t('email.reset.body')}</Text>
      <Text style={emailStyles.text}>
        <Button href={url} style={emailStyles.button}>
          {t('email.reset.cta')}
        </Button>
      </Text>
      <Text style={emailStyles.muted}>{t('email.linkFallback')}</Text>
      <Text style={emailStyles.muted}>
        <Link href={url} style={emailStyles.link}>
          {url}
        </Link>
      </Text>
      <Text style={emailStyles.muted}>{t('email.reset.ignore')}</Text>
    </EmailLayout>
  )
}

ResetPassword.PreviewProps = {
  url: 'http://localhost:3000/reset-password?token=preview-token',
  name: 'Ada Lovelace',
} satisfies ResetPasswordProps
