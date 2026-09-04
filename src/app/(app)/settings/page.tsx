import type { Metadata } from 'next'
import { ProfileForm } from '@/components/features/account/profile-form'
import { SettingsNav } from '@/components/features/account/settings-nav'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { t } from '@/lib/i18n/t'
import { getViewer } from '../viewer'

export const metadata: Metadata = { title: t('settings.title') }

// UI-010 Profile (SYS-003). One h1 for all three sections; the section links carry aria-current and
// the panel below them is the section's own h2.
export default async function SettingsProfilePage() {
  const { me } = await getViewer()
  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <SettingsNav current="profile" />
      <Panel
        id="settings-profile"
        title={t('settings.profileTitle')}
        description={t('settings.profileDescription')}
        headingLevel={2}
      >
        <ProfileForm name={me.name} email={me.email} />
      </Panel>
    </>
  )
}
