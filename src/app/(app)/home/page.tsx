import type { Metadata } from 'next'
import { HomeRunsPanel } from '@/components/features/home/runs-panel'
import { toRunListRows } from '@/components/features/run/run-rows'
import { PageHeader } from '@/components/layout/page-header'
import { t } from '@/lib/i18n/t'
import { listMyAssignments } from '@/server/modules/courses'
import { listMyRuns } from '@/server/modules/runs'
import { getViewer } from '../viewer'

export const metadata: Metadata = { title: t('home.title') }

// UI-009. The header names the institution the session is working in; the panels below it are the
// role panels, each of which lands with the data it reports:
//
//   "Your runs"  → the assignment list and its next action (Phase 6, step 6.5)
//   "Review"     → scored runs awaiting a decision and held runs (Phase 11, step 11.1)
//   "Packages"   → drafts awaiting confirmation and generation in progress (Phase 5, step 5.4)
//   "Courses"    → the instructor's courses (Phase 4, step 4.2)
//
// Only "Your runs" is rendered today: a panel whose data does not exist yet would either be an
// empty state about nothing or a promise the build cannot keep. The loading state for all of them
// is ./loading.tsx (the shell skeleton) and the error state is ./error.tsx, so every panel added
// here inherits both.
//
// The two reads are the same pair `/runs` makes, and both are scoped to the actor by their own
// queries: another student's work is not reachable from either (08 §4). Both answer an empty page
// for a session with no institution yet, which is why neither is guarded here.

/** Enough to fill the panel and to know whether there is more behind the link. */
const HOME_LIMIT = 20

export default async function HomePage() {
  const { actor, me } = await getViewer()

  const [assignments, runs] = await Promise.all([
    listMyAssignments(actor, { limit: HOME_LIMIT }),
    listMyRuns(actor, { limit: HOME_LIMIT }),
  ])

  const institution = me.memberships.find((m) => m.organizationId === me.activeOrganizationId)
  const eyebrow = institution?.name ?? me.memberships[0]?.name

  return (
    <>
      <PageHeader
        title={t('home.title')}
        description={t('home.description')}
        {...(eyebrow === undefined ? {} : { eyebrow })}
      />
      <HomeRunsPanel
        hasMembership={me.memberships.length > 0}
        rows={toRunListRows(assignments.items, runs.items)}
      />
    </>
  )
}
