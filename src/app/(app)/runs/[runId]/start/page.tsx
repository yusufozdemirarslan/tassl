import type { Metadata } from 'next'
import type { Route } from 'next'
import { notFound, redirect } from 'next/navigation'
import { PolicyDisplay } from '@/components/features/run/policy-display'
import { PageHeader } from '@/components/layout/page-header'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { getPolicyDisplay } from '@/server/modules/courses'
import { getRunView } from '../run-view'
import { getViewer } from '../../../viewer'

export const metadata: Metadata = { title: t('run.startMetaTitle') }

// UI-021 (FR-201): the policy display. The last screen before a run that counts, and the only one
// whose job is to make sure the student was told.
//
// The state gate is `assigned` and nothing else. Acknowledging is what moves the run on, and the
// transition table refuses a second acknowledgement (`ILLEGAL_TRANSITION`), so a run that has
// already been through here is sent to where it now is rather than being shown the display again
// with a button that cannot work.
//
// The values come from `courses.getPolicyDisplay` — the same function `acknowledgePolicy` reads
// when it writes the `policy_displayed` event — so the trace records what was on this screen rather
// than a second reading of the course (10 §6).

export default async function RunStartPage({ params }: PageProps<'/runs/[runId]/start'>) {
  const { runId } = await params
  const { status } = await getRunView(runId)

  if (status.run.state !== 'assigned') redirect(status.run.links.next as Route)

  const { actor } = await getViewer()
  let policy
  try {
    policy = await getPolicyDisplay(actor, status.run.assignmentId)
  } catch (error) {
    // A reviewer can read this run but is not the student who takes it; the display is the
    // student's screen, and an assignment they cannot read is a 404 like any other.
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound()
    throw error
  }

  return (
    <>
      <PageHeader title={t('run.startTitle')} description={t('run.startDescription')} />
      <PolicyDisplay
        runId={status.run.id}
        policy={{
          outsideAiPolicy: policy.outsideAiPolicy,
          weight: policy.weight,
          mapping: policy.mapping,
          runType: policy.runType,
          workingClockSeconds: policy.workingClockSeconds,
          uncalibrated: policy.uncalibrated,
        }}
      />
    </>
  )
}
