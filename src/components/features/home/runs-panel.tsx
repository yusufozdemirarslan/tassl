import { EmptyState } from '@/components/layout/empty-state'
import { Panel } from '@/components/layout/panel'
import { t } from '@/lib/i18n/t'

// UI-009 "Your runs". The panel's own data — the next action per assignment (Start, Continue, Read
// debrief) — arrives with the runs list in Phase 6, step 6.5; until then the two honest states are
// the ones this build can tell apart: a person with no institution yet, and a member with nothing
// assigned. Neither carries a placeholder action, because the action is data (which run, which
// state) and inventing one would be a lie about what is waiting.
//
// Outline: the page h1, this panel's h2, the empty state's h3.
export function HomeRunsPanel({ hasMembership }: { hasMembership: boolean }) {
  return (
    <Panel id="home-runs" title={t('home.runsTitle')} headingLevel={2}>
      <EmptyState
        headingLevel={3}
        title={hasMembership ? t('home.emptyTitle') : t('home.noMembershipsTitle')}
        body={hasMembership ? t('home.emptyBody') : t('home.noMemberships')}
      />
    </Panel>
  )
}
