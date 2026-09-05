'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { FormAlert } from '@/components/features/account/form-feedback'
import { LabelChip } from '@/components/layout/label-chip'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/messages/run'
import { startRunAction } from '@/server/modules/runs/actions'
import type { RunStateValue } from '@/server/modules/runs/schema'
import type { RunListRow } from './run-rows'
import { RunStateChip } from './run-state-chip'

// UI-020 (FR-235). One row per attempt, and one row per assignment nobody has attempted yet, with
// the single thing to do about it on the right.
//
// It is a client component for one control: Start writes a run and has to send the student to the
// screen the new run's state names, which a link cannot do because the run does not exist until the
// press. Everything else on the row is a link or a chip, and the rows are handed over as plain
// data — the page reads the assignment list and the run list on the server and joins them, so
// nothing about a scenario, a variant or a package reaches the browser (12 §8).
//
// A voided attempt stays on the list, struck through. It happened, and hiding it would leave a
// student who was told their run was voided with nothing on the screen that says so; what they do
// about it is the re-offer, which is its own attempt on the same assignment (FR-183).

export type RunListProps = {
  rows: readonly RunListRow[]
  /** The cursor of the next page of assignments, or null on the last one (D-020). */
  nextCursor: string | null
}

/**
 * What the student does next, per state. The wording is the step, not the screen: "Respond to the
 * Turn" is what is being asked of them, and `links.next` is where it happens.
 */
const NEXT_ACTION: Record<RunStateValue, (() => string) | null> = {
  assigned: () => t('run.actionContinue'),
  readiness: () => t('run.actionContinue'),
  framing: () => t('run.actionContinue'),
  working: () => t('run.actionContinue'),
  paused: () => t('run.actionContinue'),
  decision_locked: () => t('run.actionContinue'),
  turn_open: () => t('run.actionRespondToTurn'),
  turn_locked: () => t('run.actionDefend'),
  defense_pending: () => t('run.actionDefend'),
  defense_complete: () => t('run.actionOpenRun'),
  scored: () => t('run.actionReadDebrief'),
  confirmed: () => t('run.actionReadDebrief'),
  recorded: () => t('run.actionOpenRecord'),
  // A voided attempt has no next step of its own; the re-offer, when there is one, is its own run.
  voided: null,
  abandoned: () => t('run.actionOpenRun'),
  defense_missed: () => t('run.actionOpenRun'),
  under_appeal: () => t('run.actionOpenRun'),
  expired: () => t('run.actionOpenRun'),
}

function moreHref(cursor: string): Route {
  const href: string = `/runs?cursor=${encodeURIComponent(cursor)}`
  return href as Route
}

export function RunList({ rows, nextCursor }: RunListProps) {
  const [failure, setFailure] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <FormAlert message={failure} />

      {/* Four columns of label, chip and control need more room than a phone has; the table keeps
          its width and the scroll region moves, which is what the region in `Table` exists for. */}
      <Table className="min-w-2xl">
        <TableCaption className="px-0">{t('run.listCaption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('run.columnAssignment')}</TableHead>
            <TableHead scope="col">{t('run.columnAttempt')}</TableHead>
            <TableHead scope="col">{t('run.columnState')}</TableHead>
            <TableHead scope="col">{t('run.columnNext')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const voided = row.run?.state === 'voided'
            return (
              <TableRow key={row.key}>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        voided ? 'text-ink-muted font-medium line-through' : 'text-ink font-medium'
                      }
                    >
                      {row.assignmentLabel}
                    </span>
                    {row.isWalkthrough && <LabelChip kind="walkthrough" />}
                  </div>
                  {voided && <p className="text-ink-muted text-meta mt-1">{t('run.voidedRow')}</p>}
                  {row.run?.underReview && (
                    <p className="text-ink-muted text-meta mt-1">{t('run.underReviewRow')}</p>
                  )}
                </TableCell>

                <TableCell className="text-mono tabular font-mono">
                  {row.run === null ? (
                    <span className="text-ink-muted font-sans">{t('run.attemptNone')}</span>
                  ) : (
                    row.run.attemptNo
                  )}
                </TableCell>

                <TableCell>
                  {row.run === null ? (
                    <RunStateChip state="assigned" />
                  ) : (
                    <RunStateChip state={row.run.state} underReview={row.run.underReview} />
                  )}
                </TableCell>

                <TableCell className="whitespace-normal">
                  <NextAction row={row} onFailure={setFailure} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {nextCursor !== null && (
        <Link
          href={moreHref(nextCursor)}
          className={buttonVariants({ variant: 'secondary', className: 'w-fit' })}
        >
          {t('run.listShowMore')}
        </Link>
      )}
    </div>
  )
}

function NextAction({
  row,
  onFailure,
}: {
  row: RunListRow
  onFailure: (message: string | null) => void
}) {
  if (row.run === null) {
    if (row.opensAt !== null) {
      return (
        <span className="text-ink-muted text-body">
          {t('run.opensAt', { when: formatDateTime(row.opensAt) })}
        </span>
      )
    }
    return (
      <StartRunButton
        assignmentId={row.assignmentId}
        label={row.assignmentLabel}
        onFailure={onFailure}
      />
    )
  }

  if (row.run.state === 'voided') {
    if (row.reoffer === null) {
      return <span className="text-ink-muted text-body">{t('run.reofferPending')}</span>
    }
    return (
      <Link
        href={row.reoffer.href as Route}
        className={buttonVariants({ variant: 'secondary', className: 'w-fit' })}
      >
        {t('run.reoffered', { number: row.reoffer.attemptNo })}
      </Link>
    )
  }

  const action = NEXT_ACTION[row.run.state]
  if (action === null || row.run.nextHref === null) {
    return <NoAction />
  }

  return (
    <Link
      href={row.run.nextHref as Route}
      aria-label={t('run.actionName', { action: action(), label: row.assignmentLabel })}
      className={buttonVariants({ className: 'w-fit' })}
    >
      {action()}
    </Link>
  )
}

/**
 * Start is a write, so it is a button and not a link: the run does not exist until the press, and
 * where the student goes afterwards is the new run's own `links.next` rather than an address this
 * screen guessed.
 */
function StartRunButton({
  assignmentId,
  label,
  onFailure,
}: {
  assignmentId: string
  label: string
  onFailure: (message: string | null) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      type="button"
      aria-label={t('run.actionStartName', { label })}
      aria-disabled={pending ? true : undefined}
      aria-busy={pending}
      className="w-fit"
      onClick={() => {
        if (pending) return
        onFailure(null)
        startTransition(async () => {
          const result = await startRunAction({ assignmentId })
          if (result.ok) {
            router.push(result.data.links.next as Route)
            return
          }
          onFailure(result.error.message || t('run.startFailed'))
        })
      }}
    >
      {pending ? t('run.actionStarting') : t('run.actionStart')}
    </Button>
  )
}

/**
 * Nothing to do on this row. The dash is for the eye alone — the state chip in the cell before it
 * is what a screen reader has already been given, and a second reading of it here would be noise.
 */
function NoAction() {
  return (
    <span aria-hidden="true" className="text-ink-faint">
      —
    </span>
  )
}
