import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  VerifyEmailPanel,
  type VerifyEmailState,
} from '@/components/features/auth/verify-email-panel'
import { PageHeader } from '@/components/layout/page-header'
import { t } from '@/lib/i18n/t'
import { getSession } from '@/server/auth/session'

const TITLES: Record<VerifyEmailState, string> = {
  idle: t('auth.verify.idleTitle'),
  sent: t('auth.verify.sentTitle'),
  verified: t('auth.verify.verifiedTitle'),
  invalid: t('auth.verify.invalidTitle'),
}

function first(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Better Auth owns the token: the emailed link hits `/api/auth/verify-email?token=…` and redirects
 * here with `verified=1` on success or with `error=INVALID_TOKEN | TOKEN_EXPIRED | …` appended to
 * that same callback, so the error is read first. `sent=1` is what sign-up hands over; without any
 * of the three nothing has been sent to anybody, and the screen may not claim otherwise.
 */
function resolveState(
  error: string | null,
  verified: string | null,
  sent: string | null,
): VerifyEmailState {
  if (error !== null) return 'invalid'
  if (verified !== null) return 'verified'
  if (sent !== null) return 'sent'
  return 'idle'
}

function stateOf(params: Awaited<PageProps<'/verify-email'>['searchParams']>): VerifyEmailState {
  return resolveState(first(params.error), first(params.verified), first(params.sent))
}

function describe(state: VerifyEmailState, email: string | null): string {
  if (state === 'verified') return t('auth.verify.verifiedBody')
  if (state === 'invalid') return t('auth.verify.invalidBody')
  if (state === 'idle') return t('auth.verify.idleBody')
  if (email === null) return t('auth.verify.sentBodyNoEmail')
  // The address itself is rendered as its own line below, so the sentence ends at the colon.
  return t('auth.verify.sentBodyAddressed')
}

// The tab is one of four screens, so the title tracks the state rather than always saying "sent".
export async function generateMetadata({
  searchParams,
}: PageProps<'/verify-email'>): Promise<Metadata> {
  return { title: TITLES[stateOf(await searchParams)] }
}

// UI-003. The signed-in redirect is skipped for the two states a session is expected in: Better
// Auth signs the person in as it verifies (autoSignInAfterVerification), so bouncing them to /home
// would delete the only confirmation they ever get.
export default async function VerifyEmailPage({ searchParams }: PageProps<'/verify-email'>) {
  const [session, params] = await Promise.all([getSession(await headers()), searchParams])
  const state = stateOf(params)
  if (session && (state === 'sent' || state === 'idle')) redirect('/home')
  const email = first(params.email)

  return (
    <>
      <PageHeader title={TITLES[state]} description={describe(state, email)} />
      {state === 'sent' && email !== null && (
        // The address is what the person checks the screen for: ink at weight 500 on its own
        // line, not a token buried in a muted sentence.
        <p className="text-ink text-body -mt-4 mb-6 font-medium break-words">{email}</p>
      )}
      <VerifyEmailPanel state={state} email={email} />
    </>
  )
}
