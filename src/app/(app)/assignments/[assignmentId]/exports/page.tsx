import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Route } from 'next'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { isAppError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/t'
import { getAssignment, listAssignmentRuns } from '@/server/modules/courses'
import { AssignmentIdParamsSchema } from '@/server/modules/courses/schema'
import { listCourseExports } from '@/server/modules/records'
import type { ExportSummary } from '@/server/modules/records/schema'
import { getViewer } from '../../../viewer'

export const metadata: Metadata = { title: t('review.assignmentExportsTitle') }

// UI-035, the assignment's export history (FR-204, FR-184, D-087).
//
// **The ledger is append-only and the version is the provenance.** An instructor who entered points
// from version 1 can read version 1 back after an override has produced version 2, and see exactly
// what they entered. So every version is listed with the reason it was written, newest first, and
// none of them is ever replaced.
//
// **The gradebook sentence is on this screen**, once, above the table it is about: Tassl places
// bands and holds no grade, and the numbers in these files are entered in the gradebook of record by
// a person. The replay's own export list omits it because that screen already carries it beside the
// points; here the table is the whole screen and the sentence belongs to it.
//
// The student seat is joined in from the assignment's runs rather than carried on the export
// summary: an export row names a run, and a table of uuids is a table nobody can read. The variant
// is deliberately absent for UI-032's reason (12 §8, D-228).
//
// Every download is a plain link to `GET /runs/{id}/exports/{version}`, so the browser's own save,
// open-in-new-tab and copy-link all work and the route ships no JavaScript.

/** Enough to hold a section's term without a cursor control; more is one page-size change away. */
const EXPORT_LIMIT = 100

/** A resource the viewer may not see renders the not-found page, never the error boundary. */
async function orNotFound<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound()
    throw error
  }
}

const REASON_LABELS: Record<ExportSummary['reason'], string> = {
  initial: t('review.exportReason.initial'),
  override: t('review.exportReason.override'),
  neutralization: t('review.exportReason.neutralization'),
  mapping_change: t('review.exportReason.mapping'),
  unassessed: t('review.exportReason.unassessed'),
}

export default async function AssignmentExportsPage({
  params,
}: PageProps<'/assignments/[assignmentId]/exports'>) {
  const [{ actor }, { assignmentId }] = await Promise.all([getViewer(), params])

  // An id that is not a uuid never reaches the repository: a malformed address is a 404, not a
  // database cast error on the error boundary.
  if (!AssignmentIdParamsSchema.safeParse({ assignmentId }).success) notFound()

  const assignment = await orNotFound(() => getAssignment(actor, assignmentId))
  // `listCourseExports` is the guard that matters: a reviewer of the assignment's section only.
  const exports = await orNotFound(() =>
    listCourseExports(actor, assignmentId, { limit: EXPORT_LIMIT }),
  )
  const runs = await orNotFound(() => listAssignmentRuns(actor, assignmentId, { limit: 100 }))
  const seatOf = new Map(runs.items.map((run) => [run.id, run.studentName]))

  return (
    <>
      <PageHeader
        title={t('review.assignmentExportsTitle')}
        description={t('review.assignmentExportsDescription')}
        eyebrow={
          <Link
            href={`/assignments/${assignmentId}` as Route}
            className="text-primary focus-visible:outline-focus rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t('review.assignmentExportsBack')}
          </Link>
        }
        actions={<span className="text-ink-muted text-meta">{assignment.label}</span>}
      />

      <Panel
        id="assignment-exports"
        headingLevel={2}
        title={t('review.assignmentExportsPanelTitle')}
      >
        {/* The one sentence this screen exists to carry, above the numbers it is about (UI-035). */}
        <p className="border-line bg-paper-sunken text-ink text-body max-w-measure mb-4 rounded-md border p-3">
          {t('review.assignmentExportsGradebook')}
        </p>

        {exports.items.length === 0 ? (
          <EmptyState
            title={t('review.assignmentExportsEmptyTitle')}
            body={t('review.assignmentExportsEmptyBody')}
            headingLevel={3}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-3xl">
              <TableCaption>{t('review.assignmentExportsCaption')}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t('review.assignmentExportsColumnStudent')}</TableHead>
                  <TableHead scope="col">{t('review.exportsColumnVersion')}</TableHead>
                  <TableHead scope="col">{t('review.exportsColumnReason')}</TableHead>
                  <TableHead scope="col">{t('review.exportsColumnCreated')}</TableHead>
                  <TableHead scope="col">{t('review.assignmentExportsColumnRun')}</TableHead>
                  <TableHead scope="col">{t('review.exportsColumnFile')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exports.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-normal">
                      {seatOf.get(row.runId) ?? ''}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">{row.version}</TableCell>
                    <TableCell className="whitespace-normal">{REASON_LABELS[row.reason]}</TableCell>
                    <TableCell className="whitespace-normal">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/review/runs/${row.runId}` as Route}
                        className="text-primary text-meta focus-visible:outline-focus inline-flex min-h-10 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        {t('review.assignmentExportsRunLink')}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <a
                        href={`/api/v1/runs/${row.runId}/exports/${String(row.version)}`}
                        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                        download
                      >
                        {t('review.exportDownload', { version: row.version })}
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </>
  )
}
