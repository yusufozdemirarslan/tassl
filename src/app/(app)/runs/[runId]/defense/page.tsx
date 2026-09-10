import type { Metadata } from 'next'
import type { Route } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { DefenseArtifacts } from '@/components/features/run/defense-artifacts'
import { DefenseInterview } from '@/components/features/run/deferred-panels'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { openDefense, type DefenseView } from '@/server/modules/defense'
import { getViewer } from '../../../viewer'
import { getRunView } from '../run-view'

export const metadata: Metadata = { title: t('defense.metaTitle') }

// UI-026 `/runs/[runId]/defense` (FR-120 to FR-126): six to nine typed questions about the run the
// student has just made, answered with nothing in front of them but their own work.
//
// **What is absent is the screen.** There is no assistant, no Evidence Room, no claim card, no
// Delegation Log, no trace and no route to any of them — PRD §7.12 makes the defense the one stage
// with no AI assistance in it, and a screen that kept a door open would be a different assessment.
// This is not the page choosing to hide them: `trace.requireOwnerReadAccess` seals the trace in
// `defense_pending` (D-279) and `getRunWorkspace` refuses outside its four states, so there is no
// second tab that hands the room back. The rail above is left alone for the reason `layout.tsx`
// gives — it is how a student leaves a run they opened by mistake — and it leads to the runs list,
// not into this run.
//
// **The interview is the act and the artifacts are the reference**, so the columns are that way
// round and they split at `2xl` and at no width below it (D-310). The defense is *entirely*
// writing — long answers in textareas — which makes it the screen where the reading measure matters
// most: below 1536 the questions run full width with the measure clamping the prose, and from 1536
// the artifacts sit beside at a width that still holds their own.
//
// **One read** (D-341). `openDefense` selects the questions the first time it is called and is
// idempotent afterwards (FR-121, FR-126), and it carries the artifacts with them because all four
// are `runs.getDecision`'s — the frozen record UI-024 already reads. `defense_complete` is a state
// it still answers in, so the poll's refresh after the completion does not race the redirect.
//
// The guard below no longer routes the completing press — `DefenseInterview` navigates to the route
// the completing call reported, so the destination cannot be overtaken by the scoring job (D-720).
// It stays as the answer for a page that *arrives* here with the run elsewhere: a second tab, a
// bookmark, a back press.

export default async function RunDefensePage({ params }: PageProps<'/runs/[runId]/defense'>) {
  const { runId } = await params
  const { status } = await getRunView(runId)
  const next = status.run.links.next as Route

  // The one state this screen draws (09 §1). `turn_locked` names this route as its own next step
  // and a run cannot rest there — the response and the implicit hold both pass through it inside
  // one transaction (10 §8) — so redirecting a run in it to `links.next` would send it here again.
  // That one row goes to the status screen instead, which is the honest answer for a run nobody
  // can act on.
  if (status.run.state !== 'defense_pending') {
    redirect(status.run.state === 'turn_locked' ? (`/runs/${runId}` as Route) : next)
  }

  const { actor } = await getViewer()
  let defense: DefenseView
  try {
    defense = await openDefense(actor, runId)
  } catch (error) {
    if (!isAppError(error)) throw error
    // The defense finished in another tab, or the run moved under the read. The run's own next
    // step is the answer, not an error boundary.
    if (error.code === 'DEFENSE_NOT_OPEN' || error.code === 'ILLEGAL_TRANSITION') redirect(next)
    if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') notFound()
    throw error
  }

  return (
    <>
      <PageHeader title={t('defense.title')} description={t('defense.description')} />

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] 2xl:items-start">
        <Panel
          id="defense-questions"
          title={t('defense.questionsTitle')}
          description={t('defense.noRoomNote')}
          headingLevel={2}
          padding="reading"
          className="min-w-0"
        >
          {defense.questions.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title={t('defense.emptyTitle')}
              body={t('defense.emptyBody')}
              // Heading, sentence, action (DESIGN.md §Empty states). `completeDefense` refuses a
              // defense with no questions, so the run cannot leave `defense_pending` from here and
              // an empty state with no way out would strand the student on it (D-354).
              action={
                <Link href="/runs" className={buttonVariants({ variant: 'secondary' })}>
                  {t('defense.emptyAction')}
                </Link>
              }
            />
          ) : (
            <DefenseInterview runId={status.run.id} questions={defense.questions} />
          )}
        </Panel>

        {/* The student's own work, beside the questions about it. An `aside` because it is what
            they answer *from* rather than the answering (09 §6). */}
        <aside aria-label={t('defense.artifactsRegion')} className="flex min-w-0 flex-col gap-6">
          <DefenseArtifacts artifacts={defense.artifacts} />
        </aside>
      </div>
    </>
  )
}
