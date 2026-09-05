import type { Metadata } from 'next'
import type { Route } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ConceptMap } from '@/components/features/run/concept-map'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { getReadinessResult, type ReadinessResult } from '@/server/modules/runs'
import { getRunView } from '../../run-view'
import { getViewer } from '../../../../viewer'

export const metadata: Metadata = { title: t('readiness.resultMetaTitle') }

// UI-022's result page: the concept map the Readiness Check closes with (FR-012, FR-014).
//
// **The screen a student most expects a score on, and the one that must not have one.** There is no
// total, no count, no percentage, no threshold and no rank here or in the shape it is drawn from —
// `ReadinessResult` carries named concepts and whether the check completed, and the per-concept
// counts stay in the row the reviewer's replay reads (CLAUDE.md, PRD §7.1, `runs/readiness.ts`).
//
// It is the step between the check and the workspace, so it renders in `framing` and nowhere else:
// a check still open belongs on the check, and a run that has moved on has this reading behind it.
// Both are sent to the state's own next route rather than being shown a page about a moment that
// has passed.
//
// Everything here renders on the server. Nothing on this page is interactive except one link, so
// the browser is sent no JavaScript for it.

export default async function ReadinessResultPage({
  params,
}: PageProps<'/runs/[runId]/readiness/result'>) {
  const { runId } = await params
  const { status } = await getRunView(runId)
  const next = status.run.links.next as Route

  if (status.run.state !== 'framing') redirect(next)

  const { actor } = await getViewer()
  let result: ReadinessResult | null
  try {
    result = await getReadinessResult(actor, runId)
  } catch (error) {
    // The reviewer who may read this run is not the student who took the check (08 §4).
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound()
    throw error
  }

  // A run reaches `framing` only by closing its check, which writes the result in the same
  // transaction; if that is somehow untrue, the scenario is still where the student belongs.
  if (result === null) redirect(next)

  return (
    <>
      <PageHeader
        title={t('readiness.resultTitle')}
        description={t('readiness.resultDescription')}
      />

      <div className="flex flex-col gap-6">
        {/* FR-018: a check that expired with items unanswered, or was skipped after a failed
            submit, closed without reading everything. Saying so is the whole of the consequence. */}
        {result.skipped && (
          <Panel
            id="readiness-incomplete"
            title={t('readiness.resultIncompleteTitle')}
            headingLevel={2}
          >
            <p className="text-ink-muted text-reading max-w-[72ch]">
              {t('readiness.resultIncompleteBody')}
            </p>
          </Panel>
        )}

        <Panel
          id="readiness-concepts"
          title={t('readiness.resultPanel')}
          headingLevel={2}
          padding="reading"
        >
          {result.concepts.length === 0 ? (
            <EmptyState body={t('readiness.resultEmptyBody')} />
          ) : (
            <ConceptMap concepts={result.concepts} />
          )}
        </Panel>

        {/* The route comes from the run's own state, not from this screen's idea of what follows. */}
        <div>
          <Link href={next} className={buttonVariants({})}>
            {t('readiness.openScenario')}
          </Link>
        </div>
      </div>
    </>
  )
}
