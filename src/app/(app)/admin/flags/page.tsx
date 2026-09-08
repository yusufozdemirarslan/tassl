import type { Metadata } from 'next'
import { AdminNav } from '@/components/features/admin/admin-nav'
import { FlagTable } from '@/components/features/admin/flag-table'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { t } from '@/lib/i18n/t'
import { getFlags } from '@/server/modules/admin'
import { getViewer } from '../../viewer'

export const metadata: Metadata = { title: t('admin.flags.title') }

// UI-050 → flags (SYS-006). The screen exists to answer one question honestly: what is this
// deployment running with right now? So the provider row is `effectiveLlmProvider()` and not
// `LLM_PROVIDER` — with FEATURE_AI off the two disagree, and the one that decides is the first.
export default async function AdminFlagsPage() {
  const { actor } = await getViewer()
  const flags = getFlags(actor)

  return (
    <>
      <PageHeader title={t('admin.flags.title')} description={t('admin.flags.description')} />
      <AdminNav current="flags" />
      <div className="flex flex-col gap-6">
        {/* The page h1 already names the screen, so the panel carries no second copy of it. */}
        <Panel id="admin-flags">
          <FlagTable flags={flags} />
        </Panel>
        <Panel
          id="admin-provider"
          title={t('admin.flags.providerTitle')}
          description={t('admin.flags.providerDescription')}
          headingLevel={2}
        >
          <p className="text-ink text-mono max-w-measure font-mono">{flags.effectiveLlmProvider}</p>
          {flags.effectiveLlmProvider === 'mock' && (
            <p className="text-ink-muted text-body max-w-measure mt-3">
              {t('admin.flags.providerMockNote')}
            </p>
          )}
        </Panel>
      </div>
    </>
  )
}
