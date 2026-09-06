'use client'

import { useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { LabelChip } from '@/components/layout/label-chip'
import { useRunPoll } from '@/lib/hooks/use-run-poll'
import { t } from '@/lib/i18n/messages/run'
import type { RunStateValue, RunSummary } from '@/server/modules/runs/schema'
import { Clock } from './clock'
import { RunStateChip } from './run-state-chip'

// UI-027, the base. The band that sits above every `/runs/[runId]` screen: which assignment this
// is, where the run has got to, and how long is left.
//
// It is the one client component on a run page that is always mounted, so it is where the poll
// lives (09 §8): every five seconds it asks `GET /api/v1/runs/{runId}` with `If-None-Match`, and
// when the answer carries a state the screen was not built for it refreshes the server render,
// which is what moves a student whose clock ran out from `/work` to `/locked` without them doing
// anything. Nothing here decides that a timer fired — the server does, on the read the poll makes
// (D-042).
//
// **The band is sticky, because a student under a clock should never have to look for the clock**
// (D-311). The working screen is many viewports tall, and `clock.tsx` marks the last five minutes
// amber and the last minute red — a *visual* signal, which a band that scrolled away fired
// off-screen for exactly the sighted students it is for. `role="status"` covered the other half of
// the room and nobody else. It sticks at every width rather than from `md`, because a phone is
// where the page is tallest; what keeps that honest is that the band is three things on one line —
// the label, the state chip and the clock — and nothing else. It carries no disclosure and no form,
// so it cannot grow under the student while they scroll.
//
// **The frame and the declaration are not slots here, and the two components that would have
// filled them are drawn as panels on the screens that have them** (D-312). `FramePanel` is already
// the workspace's own "The frame you locked" panel and the locked screen's, and
// `DeclarationControl` is a panel whose FR-061/FR-062 sentence — a declaration never lowers a band
// — has to be on screen *before* the control is pressed, which a button in a band cannot carry.
// Slots that no caller passed described a band that did not exist; UI-023's tree is corrected with
// the row.
//
// The assignment label arrives as a string, and only as a string. The view it is read from
// (`courses.AssignmentView`) also carries `variantKey` — which defect, if any, was planted in this
// student's scenario — and this is a client component, so anything handed to it is in the page
// source. The layout picks the label off on the server and passes nothing else (12 §8, CLAUDE.md).

/**
 * States in which something can change without the student touching anything: a clock running out,
 * the Turn falling due, its window closing. Outside them the poll is switched off — a run waiting
 * on its own student, or one that has finished, has nothing to tell the page every five seconds.
 */
const SELF_MOVING_STATES: readonly RunStateValue[] = [
  'readiness',
  'working',
  'paused',
  'decision_locked',
  'turn_open',
]

/** Whether this run can move on its own: a timer is pending, or a scoring job is in flight. */
export function isSelfMoving(run: RunSummary): boolean {
  if (SELF_MOVING_STATES.includes(run.state)) return true
  return run.scoringStatus === 'queued' || run.scoringStatus === 'running'
}

export type RunFrameProps = {
  /** The run as the server rendered it; the poll takes over from here. */
  run: RunSummary
  /** The assignment's label — the student's name for this run. Never the assignment view itself. */
  label: string
  children: ReactNode
}

export function RunFrame({ run, label, children }: RunFrameProps) {
  const router = useRouter()

  // A poll that finds the run somewhere else re-renders the tree on the server, and the page for
  // the state it is now in decides where the student belongs. Scoring is watched with it, because
  // the status screen's whole content is that one field. Nothing else is worth a re-render: the
  // clock is already counting from the deadline this poll anchored.
  const onChange = useCallback(
    (next: RunSummary, previous: RunSummary) => {
      if (next.state === previous.state && next.scoringStatus === previous.scoringStatus) return
      router.refresh()
    },
    [router],
  )

  const live = useRunPoll<RunSummary>({
    runId: run.id,
    initial: run,
    enabled: isSelfMoving(run),
    onChange,
  })

  return (
    <div className="flex flex-col gap-6">
      {/* The paper ground travels with the band, pulled out to `main`'s own gutter, so the panels
          below scroll *under* it rather than through the 24 px gap beside it. `top-0` is the top of
          the scrolling viewport: the app header is not sticky, so nothing sits above this. */}
      <div className="bg-paper sticky top-0 z-30 -mx-4 px-4 pt-2 pb-1 md:-mx-6 md:px-6 md:pt-3">
        <section
          aria-label={t('run.frameRegion')}
          className="border-line bg-paper-raised flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border p-3 md:p-4"
        >
          <div className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-ink text-body min-w-0 truncate font-medium">
              <span className="sr-only">{t('run.frameAssignmentLabel')} </span>
              {label}
            </span>
            {live.isWalkthrough && <LabelChip kind="walkthrough" />}
            {/* `held` is read off the polled run rather than taken as a prop: it is the one field
                that can change while the page sits still, and the chip is what says so (FR-140). */}
            <RunStateChip state={live.state} underReview={live.scoringStatus === 'held'} />
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Clock clock={live.clock} />
          </div>
        </section>
      </div>

      {children}
    </div>
  )
}
