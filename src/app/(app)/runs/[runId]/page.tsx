import type { Metadata } from 'next'
import type { Route } from 'next'
import { redirect } from 'next/navigation'
import { RunStatus } from '@/components/features/run/run-status'
import { PageHeader } from '@/components/layout/page-header'
import { t } from '@/lib/i18n/t'
import type { RunStateValue } from '@/server/modules/runs/schema'
import { getRunView } from './run-view'

export const metadata: Metadata = { title: t('run.statusTitle') }

// UI-027 `/runs/[runId]` (FR-140). The screen for a run that is between the student's last move and
// their instructor's next one: being scored, held for review, scored, confirmed, recorded, voided.
//
// A run that is still live is not one of those, and this is not where it is taken: the state names
// its own route (`RunSummary.links.next`), so an active run is sent there. `defense_complete` is
// the one state that is both finished and not yet anything, and it stays here, which is where the
// poll in the RunFrame is watching for scoring to end.
//
// The debrief (UI-028) and the Judgment Record (UI-029) are the screens this one leads to, and both
// land in Phase 11. Until they exist the sentence stands on its own rather than offering a link
// into a 404: what the student is told is true either way, and a promise the build cannot keep is
// worse than a missing button.
const ACTIVE_STATES: readonly RunStateValue[] = [
  'assigned',
  'readiness',
  'framing',
  'working',
  'paused',
  'decision_locked',
  'turn_open',
  'turn_locked',
  'defense_pending',
]

export default async function RunStatusPage({ params }: PageProps<'/runs/[runId]'>) {
  const { runId } = await params
  const { status } = await getRunView(runId)

  if (ACTIVE_STATES.includes(status.run.state)) redirect(status.run.links.next as Route)

  return (
    <>
      <PageHeader title={t('run.statusTitle')} />
      <RunStatus status={status} />
    </>
  )
}
