import type { Metadata } from 'next'
import Link from 'next/link'
import {
  AcceptInvitationButton,
  SwitchAccountButton,
} from '@/components/features/invitations/accept-invitation'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { getInvitation, type InvitationDetail } from '@/server/modules/tenancy'
import { getViewer } from '../../viewer'

export const metadata: Metadata = { title: t('invitation.title') }

/** The role as a person reads it (08 §3); the key set is the organization role vocabulary. */
const ROLE_LABELS: Record<InvitationDetail['role'], string> = {
  student: t('role.student'),
  instructor: t('role.instructor'),
  teaching_assistant: t('role.teaching_assistant'),
  scenario_author: t('role.scenario_author'),
  program_lead: t('role.program_lead'),
}

// UI-005. Three states, and the service is what tells them apart (tenancy.getInvitation):
//
//   valid     → the institution, the role, and one action;
//   mismatch  → INVITATION_EMAIL_MISMATCH: the link is for another address, so the way forward is
//               to sign out and sign in as that person — the invitation itself is not described,
//               since whoever is holding the link is not its recipient;
//   expired   → NOT_FOUND: spent, cancelled, or past seven days (08 §2.5).
//
// The page is only reachable with a session (proxy + ./viewer), so there is no signed-out state:
// an anonymous visitor is sent to /sign-in?next=/invitations/… and arrives back here afterwards.
export default async function AcceptInvitationPage({
  params,
}: PageProps<'/invitations/[invitationId]'>) {
  const [{ actor }, { invitationId }] = await Promise.all([getViewer(), params])

  let invitation: InvitationDetail | null = null
  let refusal: 'mismatch' | 'expired' | null = null
  try {
    invitation = await getInvitation(actor, invitationId)
  } catch (error) {
    if (!isAppError(error)) throw error
    if (error.code === 'INVITATION_EMAIL_MISMATCH') refusal = 'mismatch'
    else if (error.code === 'NOT_FOUND') refusal = 'expired'
    else throw error
  }

  if (refusal !== null) {
    const mismatch = refusal === 'mismatch'
    return (
      <>
        <PageHeader title={t('invitation.title')} />
        <Panel className="max-w-2xl">
          <EmptyState
            headingLevel={2}
            title={mismatch ? t('invitation.mismatchTitle') : t('invitation.expiredTitle')}
            body={
              mismatch
                ? t('invitation.mismatchBody', { email: actor.email })
                : t('invitation.expiredBody')
            }
            action={
              mismatch ? (
                <SwitchAccountButton />
              ) : (
                <Link href="/home" className={buttonVariants({ variant: 'secondary' })}>
                  {t('invitation.home')}
                </Link>
              )
            }
          />
        </Panel>
      </>
    )
  }

  if (!invitation) throw new Error('Unreachable: an invitation or a refusal.')

  return (
    <>
      <PageHeader title={t('invitation.title')} />
      <Panel
        id="invitation"
        title={t('invitation.heading', { name: invitation.organizationName })}
        headingLevel={2}
      >
        <div className="flex flex-col gap-4">
          <p className="text-ink text-body max-w-[72ch]">
            {t('invitation.body', { name: invitation.organizationName })}
          </p>
          <dl className="text-body flex flex-wrap items-baseline gap-x-2">
            <dt className="text-ink-muted text-meta font-medium">
              {t('invitation.roleLabel')}
              {':'}
            </dt>
            <dd className="text-ink">{ROLE_LABELS[invitation.role]}</dd>
          </dl>
          <AcceptInvitationButton
            invitationId={invitation.id}
            organizationName={invitation.organizationName}
          />
        </div>
      </Panel>
    </>
  )
}
