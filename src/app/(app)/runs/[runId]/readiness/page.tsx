import type { Metadata } from 'next'
import type { Route } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ReadinessCheck } from '@/components/features/run/readiness-check'
import { PageHeader } from '@/components/layout/page-header'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { getReadiness, type ReadinessView } from '@/server/modules/runs'
import { getRunView } from '../run-view'
import { getViewer } from '../../../viewer'

export const metadata: Metadata = { title: t('readiness.metaTitle') }

// UI-022 (FR-010 to FR-018): the Readiness Check. Sixteen items, eight minutes, and the first
// screen of the run where a clock is running.
//
// **The state decides which screen a student is on, never this page.** `readiness` is the one state
// the check can be taken in. A run that has not reached it yet goes to its own next step; a run that
// has closed it is in `framing`, and the step between the check and the workspace is the result, so
// that is where it goes — including the case this page exists to handle, an eight minutes that ran
// out while the student was reading. `getRunStatus` materializes the expiry on the read above, so
// by the time this function decides, the auto-submit has already happened (10 §8 branch 1, D-042).
//
// **The clock is handed over as a reading, computed here.** `getReadiness` answers `expiresAt`, an
// instant the server set; subtracting the server's own `Date.now()` from it once, on the server,
// makes the number the first paint shows identical to the HTML it hydrates and leaves the browser
// with nothing to work out (`use-clock.ts`). Nothing computes eight minutes from a start time
// anywhere in the client.
//
// The reviewer who can read this run cannot take its check: `getReadiness` requires the run's owner,
// and a refusal there is a 404 like any other run screen a reader has no business on (08 §4).

const resultRoute = (runId: string): Route => `/runs/${runId}/readiness/result` as Route

export default async function ReadinessPage({ params }: PageProps<'/runs/[runId]/readiness'>) {
  const { runId } = await params
  const { status } = await getRunView(runId)

  if (status.run.state === 'framing') redirect(resultRoute(runId))
  if (status.run.state !== 'readiness') redirect(status.run.links.next as Route)

  const { actor } = await getViewer()
  let view: ReadinessView
  try {
    view = await getReadiness(actor, runId)
  } catch (error) {
    if (!isAppError(error)) throw error
    // The check closed between the read above and this one — the clock, or a submit in another tab.
    if (error.code === 'ILLEGAL_TRANSITION') redirect(resultRoute(runId))
    if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') notFound()
    throw error
  }

  return (
    <>
      <PageHeader title={t('readiness.title')} description={t('readiness.description')} />
      <ReadinessCheck
        runId={runId}
        items={view.items}
        remainingMs={Math.max(0, new Date(view.expiresAt).getTime() - Date.now())}
      />
    </>
  )
}
