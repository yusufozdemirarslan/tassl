import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { Route } from 'next'
import { DebriefSections } from '@/components/features/debrief/debrief-sections'
import { LabelChip } from '@/components/layout/label-chip'
import { PageHeader } from '@/components/layout/page-header'
import { buttonVariants } from '@/components/ui/button'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { getDebrief, type DebriefView } from '@/server/modules/debrief'
import { RunIdParamsSchema } from '@/server/modules/debrief/schema'
import { getViewer } from '../../../viewer'

export const metadata: Metadata = { title: t('debrief.metaTitle') }

// UI-028, the Run Debrief (FR-150 to FR-155).
//
// **One document, two readers** (FR-154). The run's own student and any reviewer of their section
// read exactly this page: the same sections in the same order from the same trace, and the same
// four graphs. The single difference is the form at the end — the two questions are the student's
// own reflection — and the *server* answers which reader this is (`questions.canAnswer`), because a
// screen that inferred it from a role would eventually infer it wrongly.
//
// **Two versions of the same page** (FR-150). Draft bands carry the amber chip and the sentence
// that says the instructor has not read the run yet; once every dimension carries a decision, the
// confirmed band replaces the draft *in place*, with the instructor's note. There is no second
// route and no second component, because the promise is that they are one page read twice.
//
// **Everything on it is a student payload.** The module's projection carries no `quotes`, no
// `evidenceEventSeqs` and no `decidedBy`, and the graphs come from `scoring.readGraphsForOwner`,
// which withholds FR-106's `speed_outlier` (D-438). This page picks nothing out of a wider object:
// what the service answers is what is drawn.
//
// **A run without a debrief is not an error boundary.** `DEBRIEF_NOT_AVAILABLE` means the bands
// have not been drafted yet, and the screen that says what the reader is waiting for is UI-027 — so
// the page sends them there rather than showing them a request id (D-465).

type DebriefPageProps = { params: Promise<{ runId: string }> }

/** `generateMetadata` and the render both need the debrief; `cache` makes that one read (D-178). */
const loadDebrief = cache(async (runId: string): Promise<DebriefView | 'missing' | 'not-yet'> => {
  const { actor } = await getViewer()
  try {
    return await getDebrief(actor, runId)
  } catch (error) {
    if (!isAppError(error)) throw error
    if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') return 'missing'
    if (error.code === 'DEBRIEF_NOT_AVAILABLE') return 'not-yet'
    throw error
  }
})

export default async function DebriefPage({ params }: DebriefPageProps) {
  const { runId } = await params
  // An id that is not a uuid never reaches the repository: a malformed address is a 404, not a
  // database cast error on the error boundary.
  if (!RunIdParamsSchema.safeParse({ runId }).success) notFound()

  const view = await loadDebrief(runId)
  if (view === 'missing') notFound()
  if (view === 'not-yet') redirect(`/runs/${runId}` as Route)

  const { labels, run } = view
  const confirmed = labels.version === 'confirmed'
  const reviewer = labels.viewer === 'reviewer'

  return (
    <>
      <PageHeader
        title={t('debrief.title')}
        description={t('debrief.description')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LabelChip kind={confirmed ? 'confirmed' : 'draft'} />
            {labels.uncalibrated && <LabelChip kind="uncalibrated" />}
            {labels.isWalkthrough && <LabelChip kind="walkthrough" />}
          </div>
        }
      />

      <div className="mb-6 flex flex-col gap-3">
        <p className="text-ink text-body max-w-measure">
          {confirmed ? t('debrief.version.confirmedNote') : t('debrief.version.draftNote')}
        </p>
        {labels.uncalibrated && (
          <p className="text-ink-muted text-body max-w-measure">{t('debrief.band.uncalibrated')}</p>
        )}
        {reviewer && (
          <p className="border-line bg-paper-sunken text-ink text-body max-w-measure rounded-md border p-3">
            <span className="mr-2 font-medium">{t('debrief.viewer.reviewer')}</span>
            {t('debrief.viewer.reviewerNote')}
          </p>
        )}
        {/* The Judgment Record opens at `confirmed` and is the student's own artifact; a reviewer
            reads the run through the replay, which carries everything this page does not. */}
        <div className="flex flex-wrap items-center gap-2">
          {!reviewer && confirmed && (
            <Link
              href={`/records/${run.id}` as Route}
              className={buttonVariants({ variant: 'secondary' })}
            >
              {t('debrief.openRecord')}
            </Link>
          )}
          {reviewer && (
            <Link
              href={`/review/runs/${run.id}` as Route}
              className={buttonVariants({ variant: 'secondary' })}
            >
              {t('debrief.openReplay')}
            </Link>
          )}
          <Link href={`/runs/${run.id}` as Route} className={buttonVariants({ variant: 'ghost' })}>
            {t('debrief.backToRun')}
          </Link>
        </div>
      </div>

      <DebriefSections view={view} />
    </>
  )
}
