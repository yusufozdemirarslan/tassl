import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignUpForm } from '@/components/features/auth/sign-up-form'
import { PageHeader } from '@/components/layout/page-header'
import { flagsFromEnv } from '@/lib/flags'
import { t } from '@/lib/i18n/t'
import { getSession } from '@/server/auth/session'
import { env } from '@/server/config'

export const metadata: Metadata = { title: t('auth.signUp.title') }

// UI-002. `demoMode` (D-692) is read here, on the server, and handed to the form: the deployment
// decides whether a sign-up ends on "check your email" or on `/home`, never the browser.
export default async function SignUpPage() {
  const session = await getSession(await headers())
  if (session) redirect('/home')

  return (
    <>
      <PageHeader title={t('auth.signUp.title')} description={t('auth.signUp.description')} />
      <SignUpForm demoMode={flagsFromEnv(env).demoMode} />
    </>
  )
}
