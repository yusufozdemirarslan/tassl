import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ResetPasswordForm } from '@/components/features/auth/reset-password-form'
import { PageHeader } from '@/components/layout/page-header'
import { buttonVariants } from '@/components/ui/button'
import { t } from '@/lib/i18n/t'
import { getSession } from '@/server/auth/session'

function first(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.length > 0 ? value : null
}

// Two screens live on this route, so the tab says which one is open.
export async function generateMetadata({
  searchParams,
}: PageProps<'/reset-password'>): Promise<Metadata> {
  const params = await searchParams
  return {
    title: first(params.token) === null ? t('auth.reset.invalidTitle') : t('auth.reset.title'),
  }
}

/**
 * UI-004 (reset half). Better Auth's `/reset-password/:token` callback redirects here with either
 * `token` (checked and unexpired) or `error=INVALID_TOKEN`, so the two states are decided by the
 * query alone. A signed-in visitor is only bounced when there is no token to spend: someone who
 * still has a session and follows their own reset link must be able to finish.
 */
export default async function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  const [session, params] = await Promise.all([getSession(await headers()), searchParams])
  const token = first(params.token)
  if (session && token === null) redirect('/home')

  if (token === null) {
    return (
      <>
        <PageHeader
          title={t('auth.reset.invalidTitle')}
          description={t('auth.reset.invalidBody')}
        />
        <div className="flex flex-col items-start gap-4">
          <Link
            href="/forgot-password"
            className={buttonVariants({ variant: 'primary', size: 'md' })}
          >
            {t('auth.reset.requestNew')}
          </Link>
          {/* A terminal state still has to offer the way back (40 px target, DESIGN.md §Layout). */}
          <Link
            href="/sign-in"
            className="text-primary text-body inline-flex min-h-10 w-fit items-center underline-offset-4 hover:underline"
          >
            {t('auth.reset.backToSignIn')}
          </Link>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader title={t('auth.reset.title')} description={t('auth.reset.description')} />
      <ResetPasswordForm token={token} />
    </>
  )
}
