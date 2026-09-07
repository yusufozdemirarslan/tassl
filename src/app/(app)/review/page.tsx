import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  ReviewQueue,
  type ReviewQueueRunRow,
  type ReviewQueueSampleRow,
} from '@/components/features/review/review-queue'
import { PageHeader } from '@/components/layout/page-header'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { getQueue } from '@/server/modules/review'
import { getViewer } from '../viewer'

export const metadata: Metadata = { title: t('review.queueTitle') }

// UI-034, the review queue (FR-186, FR-254, D-035, D-096).
//
// Two lists that are never mixed: the five illustrative groupings of PRD §7.17, which count no real
// run, and the runs of this reviewer's own sections that have bands to decide. The component keeps
// them apart and keeps the mandatory label on the first; this page reads them and nothing else.
//
// **An actor who reviews no section has no queue, not an empty one.** `getQueue` answers FORBIDDEN
// rather than an empty list, for the reason the service states: an empty answer would put the
// illustrative sample in front of a student, and FR-254's label cannot help there — the rows are
// about reading other people's runs. The refusal renders the not-found page, so the address tells a
// student nothing either (08 §4).
export default async function ReviewQueuePage() {
  const { actor } = await getViewer()

  let queue
  try {
    queue = await getQueue(actor)
  } catch (error) {
    if (isAppError(error) && (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')) notFound()
    throw error
  }

  return (
    <>
      <PageHeader title={t('review.queueTitle')} description={t('review.queueDescription')} />
      <ReviewQueue
        illustrative={queue.illustrative as unknown as ReviewQueueSampleRow[]}
        runs={queue.runs.map((run): ReviewQueueRunRow => ({
          id: run.id,
          studentName: run.studentName,
          attemptNo: run.attemptNo,
          state: run.state,
          decisionsMade: run.decisionsMade,
          latestExportVersion: run.latestExportVersion,
        }))}
      />
    </>
  )
}
