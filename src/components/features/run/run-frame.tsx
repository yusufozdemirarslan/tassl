'use client'

import { useCallback, useId, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDownIcon } from 'lucide-react'
import { LabelChip } from '@/components/layout/label-chip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useRunPoll } from '@/lib/hooks/use-run-poll'
import { t } from '@/lib/i18n/messages/run'
import type { RunStateValue, RunSummary } from '@/server/modules/runs/schema'
import { Clock } from './clock'
import { RunStateChip } from './run-state-chip'

// UI-027, the base. The band that sits above every `/runs/[runId]` screen: which assignment this
// is, where the run has got to, how long is left, the locked frame within reach, and the place a
// declaration of outside-tool use is written.
//
// It is the one client component on a run page that is always mounted, so it is where the poll
// lives (09 §8): every five seconds it asks `GET /api/v1/runs/{runId}` with `If-None-Match`, and
// when the answer carries a state the screen was not built for it refreshes the server render,
// which is what moves a student whose clock ran out from `/work` to `/locked` without them doing
// anything. Nothing here decides that a timer fired — the server does, on the read the poll makes
// (D-042).
//
// The frame and the declaration are slots rather than components this file builds. `FramePanel` is
// the locked frame's own component and the declaration is `declareOutsideTool`, which lands with
// the reliance phase; the disclosure around the first and the seat for the second are here, so
// every run screen gets them in the same place at the same size the moment they exist. A slot that
// is not passed draws nothing at all: a "Frame" button on a run with no frame would be a control
// that opens an empty box.
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
  /**
   * The locked frame, when there is one (`FramePanel`). The disclosure draws only with it, and what
   * is passed is the frame's *content*: this band is already a panel, and DESIGN.md's One-Layer
   * Rule puts sections inside a panel, never another panel.
   */
  frame?: ReactNode
  /** `DeclarationControl`, when the run is in a state that accepts one. */
  declaration?: ReactNode
  children: ReactNode
}

export function RunFrame({ run, label, frame, declaration, children }: RunFrameProps) {
  const router = useRouter()
  const framePanelId = useId()
  const [frameOpen, setFrameOpen] = useState(false)

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
      <section
        aria-label={t('run.frameRegion')}
        className="border-line bg-paper-raised flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border p-4"
      >
        <div className="flex min-w-0 flex-1 basis-64 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-ink text-body min-w-0 font-medium break-words">
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

          {frame !== undefined && (
            <Button
              type="button"
              variant="secondary"
              aria-expanded={frameOpen}
              aria-controls={framePanelId}
              onClick={() => {
                setFrameOpen((open) => !open)
              }}
            >
              <ChevronDownIcon
                aria-hidden="true"
                className={cn(
                  'size-4 transition-transform duration-150 ease-out',
                  frameOpen && 'rotate-180',
                )}
              />
              {t('run.frameToggle')}
            </Button>
          )}

          {declaration}
        </div>

        {frame !== undefined && (
          <div
            id={framePanelId}
            hidden={!frameOpen}
            className="border-line basis-full border-t pt-4"
          >
            {frame}
          </div>
        )}
      </section>

      {children}
    </div>
  )
}
