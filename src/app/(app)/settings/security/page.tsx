import type { Metadata } from 'next'
import { ChangePasswordForm } from '@/components/features/account/change-password-form'
import { SessionList } from '@/components/features/account/session-list'
import { SettingsNav } from '@/components/features/account/settings-nav'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { t } from '@/lib/i18n/t'
import { getViewer } from '../../viewer'

export const metadata: Metadata = { title: t('settings.tabSecurity') }

// UI-010 Security (08 §2.8). Two panels separated by whitespace — the password, and the devices
// that hold a session. Both talk to Better Auth from the browser, so the page itself only proves
// there is a session to talk about.
export default async function SettingsSecurityPage() {
  await getViewer()
  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <SettingsNav current="security" />
      <div className="flex flex-col gap-6">
        <Panel
          id="settings-password"
          title={t('settings.security.passwordTitle')}
          description={t('settings.security.passwordDescription')}
          headingLevel={2}
        >
          <ChangePasswordForm />
        </Panel>
        <Panel
          id="settings-sessions"
          title={t('settings.security.sessionsTitle')}
          description={t('settings.security.sessionsDescription')}
          headingLevel={2}
        >
          <SessionList />
        </Panel>
      </div>
    </>
  )
}
