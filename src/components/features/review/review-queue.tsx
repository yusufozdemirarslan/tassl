import Link from 'next/link'
import type { Route } from 'next'
import { RunStateChip } from '@/components/features/run/run-state-chip'
import { EmptyState } from '@/components/layout/empty-state'
import { IllustrativeSample } from '@/components/layout/illustrative-sample'
import { Panel } from '@/components/layout/panel'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { t } from '@/lib/i18n/t'
import type { RunStateValue } from '@/server/modules/runs/schema'

// `ReviewQueue` (09 §3, UI-034): the two lists, never mixed (FR-186, FR-254, D-035, D-096).
//
// **The illustrative half cannot be drawn unlabelled.** There is no path through this component
// that renders a sample row outside `IllustrativeSample`: the rows are handed to a private function
// that opens with the wrapper, and the wrapper is what carries the dashed border and the amber
// "Illustrative sample data" chip. That refusal is the point — the five groupings count no real run
// and describe no student, and a reviewer who read them as their own workload would be reading
// numbers this build does not compute.
//
// **The real half is this reviewer's own sections and nothing else.** The service scopes it; what
// this component adds is the divider and the link, so the two lists are read as two things.
//
// **No variant column**, for UI-032's reason: it would put "defective" or "sound" beside every
// student's name on a screen an instructor may project, and a student who reads "sound" can accept
// every claim without doing the work the run measures (12 §8, D-228). The replay carries it.
//
// It is a Server Component: every row is a link or a chip, so no reader pays a byte for it.

export type ReviewQueueSampleRow = {
  key: string
  heading: string
  body: string
  count: number
}

export type ReviewQueueRunRow = {
  id: string
  studentName: string
  attemptNo: number
  state: RunStateValue
  decisionsMade: number
  latestExportVersion: number | null
}

export type ReviewQueueProps = {
  /** D-035's fixture rows; an empty array means the flag is off and no panel is drawn. */
  illustrative: readonly ReviewQueueSampleRow[]
  runs: readonly ReviewQueueRunRow[]
}

export function ReviewQueue({ illustrative, runs }: ReviewQueueProps) {
  return (
    <div className="flex flex-col gap-6">
      {illustrative.length > 0 && <SampleGroupings rows={illustrative} />}

      <Panel
        id="review-queue-runs"
        title={t('review.queueRealTitle')}
        description={t('review.queueRealDescription')}
        headingLevel={2}
      >
        {runs.length === 0 ? (
          <EmptyState
            title={t('review.queueEmptyTitle')}
            body={t('review.queueEmptyBody')}
            headingLevel={3}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="overflow-x-auto">
              <Table className="min-w-3xl">
                <TableCaption>{t('review.queueCaption')}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t('review.queueColumnStudent')}</TableHead>
                    <TableHead scope="col">{t('review.queueColumnAttempt')}</TableHead>
                    <TableHead scope="col">{t('review.queueColumnState')}</TableHead>
                    <TableHead scope="col">{t('review.queueColumnDecisions')}</TableHead>
                    <TableHead scope="col">{t('review.queueColumnExport')}</TableHead>
                    <TableHead scope="col">
                      <span className="sr-only">{t('review.queueColumnOpen')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="whitespace-normal">{run.studentName}</TableCell>
                      <TableCell className="font-mono tabular-nums">{run.attemptNo}</TableCell>
                      <TableCell>
                        <RunStateChip state={run.state} />
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {t('review.queueDecisions', { made: run.decisionsMade })}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {run.latestExportVersion === null
                          ? t('review.queueNoExport')
                          : t('review.queueExportVersion', { version: run.latestExportVersion })}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/review/runs/${run.id}` as Route}
                          className="text-primary text-meta focus-visible:outline-focus inline-flex min-h-10 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          {t('review.queueOpen', { student: run.studentName })}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-ink-muted text-body max-w-measure">{t('review.queueVariantNote')}</p>
          </div>
        )}
      </Panel>
    </div>
  )
}

/**
 * The five groupings, and the only way this file draws one.
 *
 * Private on purpose: the wrapper is not something a caller supplies and therefore not something a
 * caller can forget (FR-254). `IllustrativeSample` throws on an empty label outside production and
 * renders the fixed chip in production, so the label is guaranteed on both paths.
 */
function SampleGroupings({ rows }: { rows: readonly ReviewQueueSampleRow[] }) {
  return (
    <IllustrativeSample label={t('review.queueSampleTitle')} headingLevel={2}>
      <div className="flex flex-col gap-4">
        <p className="text-ink text-body max-w-measure">{t('review.queueSampleNote')}</p>
        <ul className="flex flex-col gap-4">
          {rows.map((row) => (
            <li
              key={row.key}
              className="border-line flex flex-col gap-1 border-t pt-4 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-reading">{row.heading}</h3>
                <span className="text-ink-muted text-mono-sm font-mono tabular-nums">
                  <span className="sr-only">{t('review.queueSampleCountLabel')} </span>
                  {row.count}
                </span>
              </div>
              <p className="text-ink text-body max-w-measure">{row.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </IllustrativeSample>
  )
}
