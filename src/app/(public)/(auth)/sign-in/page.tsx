import type { Metadata, Route } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignInForm } from '@/components/features/auth/sign-in-form'
import { PageHeader } from '@/components/layout/page-header'
import { t } from '@/lib/i18n/t'
import { getSession } from '@/server/auth/session'
import { env } from '@/server/config'

export const metadata: Metadata = { title: t('auth.signIn.title') }

/**
 * `next` decides where a successful sign-in lands, so it is reduced to a same-site path here:
 * anything that is not a single leading slash (a protocol-relative `//host`, an absolute URL, a
 * backslash Windows path) is dropped for `/home` rather than sent to the browser.
 */
function resolveNext(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return '/home'
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/home'
  return value
}

// UI-001. A signed-in visitor never sees the form (09 §1); they go where they were headed.
export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const [session, params] = await Promise.all([getSession(await headers()), searchParams])
  const next = resolveNext(params.next)
  if (session) redirect(next as Route)

  return (
    <>
      <PageHeader title={t('auth.signIn.title')} description={t('auth.signIn.description')} />
      <SignInForm next={next} googleEnabled={env.GOOGLE_CLIENT_ID.length > 0} />
    </>
  )
}
