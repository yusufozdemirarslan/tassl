import type { Metadata } from 'next'
import { DeleteAccountDialog } from '@/components/features/account/delete-account-dialog'
import { ExportDataPanel } from '@/components/features/account/export-data-panel'
import { SettingsNav } from '@/components/features/account/settings-nav'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { t } from '@/lib/i18n/t'
import { getViewer } from '../../viewer'

export const metadata: Metadata = { title: t('settings.tabData') }

// UI-010 Data (SYS-004). What leaves (the export) and what ends (the account), in that order: the
// download is offered before the deletion, so nobody deletes an account whose data they wanted.
export default async function SettingsDataPage() {
  const { me } = await getViewer()
  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <SettingsNav current="data" />
      <div className="flex flex-col gap-6">
        <Panel
          id="settings-export"
          title={t('settings.data.exportTitle')}
          description={t('settings.data.exportDescription')}
          headingLevel={2}
        >
          <ExportDataPanel />
        </Panel>
        <Panel
          id="settings-delete"
          title={t('settings.data.deleteTitle')}
          description={t('settings.data.deleteDescription')}
          headingLevel={2}
        >
          <DeleteAccountDialog email={me.email} />
        </Panel>
      </div>
    </>
  )
}
