import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignUpForm } from '@/components/features/auth/sign-up-form'
import { PageHeader } from '@/components/layout/page-header'
import { t } from '@/lib/i18n/t'
import { getSession } from '@/server/auth/session'

export const metadata: Metadata = { title: t('auth.signUp.title') }

// UI-002.
export default async function SignUpPage() {
  const session = await getSession(await headers())
  if (session) redirect('/home')

  return (
    <>
      <PageHeader title={t('auth.signUp.title')} description={t('auth.signUp.description')} />
      <SignUpForm />
    </>
  )
}
