import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ForgotPasswordForm } from '@/components/features/auth/forgot-password-form'
import { PageHeader } from '@/components/layout/page-header'
import { t } from '@/lib/i18n/t'
import { getSession } from '@/server/auth/session'

export const metadata: Metadata = { title: t('auth.forgot.title') }

// UI-004 (request half).
export default async function ForgotPasswordPage() {
  const session = await getSession(await headers())
  if (session) redirect('/home')

  return (
    <>
      <PageHeader title={t('auth.forgot.title')} description={t('auth.forgot.description')} />
      <ForgotPasswordForm />
    </>
  )
}
