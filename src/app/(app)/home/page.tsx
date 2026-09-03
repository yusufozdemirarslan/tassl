import type { Metadata } from 'next'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { t } from '@/lib/i18n/t'
import { INSTITUTIONS } from '../shell-data'

export const metadata: Metadata = { title: t('home.title') }

// UI-009. The role panels arrive with their data in Phases 3 to 6; Phase 1 ships the empty state.
// Without a membership the panel explains how one arrives (an emailed invitation); with one, that
// nothing is assigned yet. The empty state's single action (start, continue, read debrief) is
// data-driven and lands with the runs list in Phase 6, so no placeholder action is shown here.
// Outline: h1 (page title) → h2 (panel) → h3 (empty state).
export default function HomePage() {
  const hasMembership = INSTITUTIONS.length > 0
  return (
    <>
      <PageHeader title={t('home.title')} description={t('home.description')} />
      <Panel id="home-runs" title={t('home.runsTitle')} headingLevel={2}>
        <EmptyState
          headingLevel={3}
          title={hasMembership ? t('home.emptyTitle') : t('home.noMembershipsTitle')}
          body={hasMembership ? t('home.emptyBody') : t('home.noMemberships')}
        />
      </Panel>
    </>
  )
}
