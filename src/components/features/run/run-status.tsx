import Link from 'next/link'
import type { Route } from 'next'
import { EmptyState } from '@/components/layout/empty-state'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import { t } from '@/lib/i18n/messages/run'
import type { RunStateValue, RunStatus as RunStatusView } from '@/server/modules/runs/schema'

// UI-027 `/runs/[runId]`: what a student is told between the defense and the debrief.
//
// No 'use client' here on purpose: nothing holds state, so the status screen renders on the server
// and the browser is sent no JavaScript for it. The state chip it used to sit above now lives in
// `./run-state-chip`, because three of the chip's four readers are Client Components and every one
// of them was shipping this screen — the panel, the empty state, the link and fifteen sentences —
// to draw a chip (B4 / NFR-013, 16 §3.2).
//
// What is deliberately absent: any number. No composite score, no rank, no percentile, no queue
// position, no estimate of how long scoring will take (CLAUDE.md, FR-140). `held` is the one thing
// about scoring a student is told, and it is told as a sentence about a person reading their run.

type Message = { title: string; body: string }

/**
 * One sentence pair per resting state. `assigned` through `defense_pending` are not here: the page
 * that renders this redirects an active run to the route it belongs on before it gets this far
 * (09 §UI-027), so they would be sentences nobody can reach.
 */
function messageFor(state: RunStateValue, underReview: boolean): Message {
  if (underReview) {
    return {
      title: t('run.statusUnderReviewTitle'),
      body: t('run.statusUnderReviewBody'),
    }
  }
  switch (state) {
    case 'scored':
      return { title: t('run.statusScoredTitle'), body: t('run.statusScoredBody') }
    case 'confirmed':
      return { title: t('run.statusConfirmedTitle'), body: t('run.statusConfirmedBody') }
    case 'recorded':
      return { title: t('run.statusRecordedTitle'), body: t('run.statusRecordedBody') }
    case 'defense_complete':
      return {
        title: t('run.statusDefenseCompleteTitle'),
        body: t('run.statusDefenseCompleteBody'),
      }
    case 'voided':
      return { title: t('run.statusVoidedTitle'), body: t('run.statusVoidedBody') }
    case 'under_appeal':
      return { title: t('run.statusAppealTitle'), body: t('run.statusAppealBody') }
    case 'abandoned':
    case 'defense_missed':
    case 'expired':
      return { title: t('run.statusEndedTitle'), body: t('run.statusEndedBody') }
    default:
      // Every active state, and the moment between the defense landing and the scoring job being
      // picked up. The page polls; this is what it says while it waits.
      return { title: t('run.statusScoringTitle'), body: t('run.statusScoringBody') }
  }
}

export type RunStatusProps = {
  status: RunStatusView
  /**
   * Where the student goes on from here, when there is anywhere: the debrief once the run is
   * scored, the Judgment Record once it is recorded. Both are routes of later phases, so the page
   * decides whether they exist yet and this component only draws what it is given.
   */
  links?: { debrief?: string | undefined; record?: string | undefined }
}

export function RunStatus({ status, links = {} }: RunStatusProps) {
  const { run, underReview } = status
  const { title, body } = messageFor(run.state, underReview)

  return (
    <Panel id="run-status">
      {/* The page's h1 is "Run status"; this is the h2 under it, and it is the state's own
          sentence rather than a second copy of the title (DESIGN.md §Empty and error states). */}
      <EmptyState
        headingLevel={2}
        title={title}
        body={body}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {links.debrief !== undefined && (
              <Link href={links.debrief as Route} className={buttonVariants({})}>
                {t('run.statusOpenDebrief')}
              </Link>
            )}
            {links.record !== undefined && (
              <Link
                href={links.record as Route}
                className={buttonVariants({ variant: 'secondary' })}
              >
                {t('run.statusOpenRecord')}
              </Link>
            )}
            <Link href="/runs" className={buttonVariants({ variant: 'ghost' })}>
              {t('run.statusBackToRuns')}
            </Link>
          </div>
        }
      />
      {/* The poll in the RunFrame is what moves this page on; a student who is not watching it
          should be told when it does. The region carries the heading's own sentence, so it
          announces exactly once — on the render where the state changed. */}
      <p aria-live="polite" className="sr-only">
        {title}
      </p>
    </Panel>
  )
}
