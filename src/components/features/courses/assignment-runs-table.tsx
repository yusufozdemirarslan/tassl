'use client'

import { useState } from 'react'
import { Trash2Icon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { RunStateChip } from '@/components/features/run/run-state-chip'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDeferredModule } from '@/lib/hooks/use-deferred-module'
import { t } from '@/lib/i18n/messages/run'
import type { RunStateValue } from '@/server/modules/runs/schema'

// UI-032, the runs half: every run taken on this assignment, for a reviewer of its section.
//
// Every string on this screen is the run's own vocabulary, so the run namespace is the whole of what
// it reads. It used to bind `scopedT(run, ui)` and never name a `ui.*` key, which is the one way
// D-221 can be got wrong: a namespace is an object literal, so a `t` bound to one that is never read
// still ships all of its strings to the browser (16 §3.4).

// The confirmation itself is in ./assignment-run-delete-dialog and arrives on the press that opens
// it (B4): the table paints rows, and Base UI's alert dialog, the delete action and the toaster
// behind it are weight nobody spends until a reviewer decides to remove a walkthrough run. The
// import can fail, and a control that does nothing is worse than no control, so the failure is said
// above the table — where every other refusal on this screen is said — and the next press retries.
const loadDialog = () => import('./assignment-run-delete-dialog')

// Two columns that could have been here and are not.
//
// **The variant.** `RunReviewSummary` carries it — a re-offer runs on the other variant of the
// family, so a run's variant cannot be read off its assignment (FR-183) — and the replay is where
// a reviewer reads it. A column of it on the configuration screen would put "defective" or "sound"
// beside every student's name on the screen an instructor is most likely to project in class, and
// a student who reads "sound" can accept every claim and band Professional without doing the work
// the run measures (12 §8, D-228).
//
// **The replay link.** UI-032 offers one and `/review/runs/[runId]` is Phase 11's screen. A link
// into a route that does not exist is a 404 with the instructor's name on it, so the column says
// where the replay will be instead, once, under the table.

export type AssignmentRunRow = {
  id: string
  studentName: string
  attemptNo: number
  state: RunStateValue
  underReview: boolean
  /** How far the seven band decisions have got (FR-182); zero until the run is scored. */
  decisionsMade: number
  /** The newest course export written for this run, or null when none has been (FR-204). */
  latestExportVersion: number | null
}

export type AssignmentRunsTableProps = {
  runs: readonly AssignmentRunRow[]
  /**
   * Only a run on a walkthrough assignment can be deleted; a run that counts is voided instead,
   * which keeps the record (D-104). The service refuses either way — this is what stops the
   * control being offered where it cannot act.
   */
  canDelete: boolean
}

export function AssignmentRunsTable({ runs, canDelete }: AssignmentRunsTableProps) {
  const [pendingDelete, setPendingDelete] = useState<AssignmentRunRow | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const { loaded, status, request } = useDeferredModule(loadDialog)
  const Confirm = loaded?.AssignmentRunDeleteDialog

  // A confirmation that never arrives must not leave the reviewer looking at a press that did
  // nothing, so the reason is said above the table, where every other refusal on this screen is
  // said. It is read from the import's own status rather than copied into state: a failed import is
  // not a fact about the run, and the next press is what asks for the module again.
  const confirmUnavailable = pendingDelete !== null && status === 'failed'

  return (
    <div className="flex flex-col gap-4">
      <FormAlert message={confirmUnavailable ? t('run.reviewDeleteUnavailable') : failure} />

      <Table className="min-w-3xl">
        <TableCaption className="px-0">{t('run.reviewCaption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('run.reviewColumnStudent')}</TableHead>
            <TableHead scope="col">{t('run.reviewColumnAttempt')}</TableHead>
            <TableHead scope="col">{t('run.reviewColumnState')}</TableHead>
            <TableHead scope="col">{t('run.reviewColumnDecisions')}</TableHead>
            <TableHead scope="col">{t('run.reviewColumnExport')}</TableHead>
            {canDelete && <TableHead scope="col">{t('run.reviewColumnActions')}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium whitespace-normal">{row.studentName}</TableCell>
              <TableCell className="text-mono tabular font-mono">{row.attemptNo}</TableCell>
              <TableCell>
                <RunStateChip state={row.state} underReview={row.underReview} />
              </TableCell>
              <TableCell className="text-mono tabular font-mono">
                {t('run.reviewDecisions', { count: row.decisionsMade })}
              </TableCell>
              <TableCell className="text-mono tabular font-mono">
                {row.latestExportVersion === null ? (
                  <span className="text-ink-muted font-sans">{t('run.reviewNoExport')}</span>
                ) : (
                  t('run.reviewExportVersion', { version: row.latestExportVersion })
                )}
              </TableCell>
              {canDelete && (
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('run.reviewWalkthroughDeleteName', { name: row.studentName })}
                    aria-busy={pendingDelete?.id === row.id && status === 'loading'}
                    onClick={() => {
                      setFailure(null)
                      setPendingDelete(row)
                      request()
                    }}
                  >
                    <Trash2Icon aria-hidden="true" className="size-4" />
                    {t('run.reviewWalkthroughDelete')}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <p className="text-ink-muted text-body max-w-[72ch]">{t('run.reviewReplayNote')}</p>

      {pendingDelete !== null && Confirm !== undefined && (
        <Confirm
          runId={pendingDelete.id}
          onClose={() => {
            setPendingDelete(null)
          }}
          onFailure={setFailure}
        />
      )}
    </div>
  )
}
