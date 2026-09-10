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
import { t } from '@/lib/i18n/t'
import type { ExportSummary } from '@/server/modules/records/schema'

// UI-033 → the export list beside the points (FR-184, FR-204, D-087).
//
// The ledger is append-only and the version is the provenance: an instructor who entered points
// from version 1 can read version 1 back after an override has produced version 2 and see exactly
// what they entered. So every version is listed with the reason it was written, newest first, and
// none of them is ever replaced.
//
// The download is a plain link to `GET /runs/{id}/exports/{version}`, not a button: it is a
// document at an address, so the browser's own save, open-in-new-tab and copy-link all work, and
// the route ships no JavaScript for it.
//
// The gradebook sentence is *not* repeated here. It belongs next to the number it is about, which
// on this screen is one panel up in the points summary; twice in one scroll is a sentence a reader
// stops seeing. UI-035, where this list is the whole screen, carries its own.

export type ExportsListProps = {
  runId: string
  exports: readonly ExportSummary[]
}

const REASON_LABELS: Record<ExportSummary['reason'], () => string> = {
  initial: () => t('review.exportReason.initial'),
  override: () => t('review.exportReason.override'),
  neutralization: () => t('review.exportReason.neutralization'),
  mapping_change: () => t('review.exportReason.mapping'),
  unassessed: () => t('review.exportReason.unassessed'),
}

export function ExportsList({ runId, exports }: ExportsListProps) {
  if (exports.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-h4">{t('review.exportsEmptyTitle')}</h3>
        <p className="text-ink-muted text-body max-w-measure">{t('review.exportsEmptyBody')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Table className="min-w-2xl">
        <TableCaption>{t('review.exportsCaption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('review.exportsColumnVersion')}</TableHead>
            <TableHead scope="col">{t('review.exportsColumnReason')}</TableHead>
            <TableHead scope="col">{t('review.exportsColumnCreated')}</TableHead>
            <TableHead scope="col">{t('review.exportsColumnFile')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {exports.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-mono tabular-nums">{row.version}</TableCell>
              <TableCell className="whitespace-normal">{REASON_LABELS[row.reason]()}</TableCell>
              <TableCell className="whitespace-normal">{formatDateTime(row.createdAt)}</TableCell>
              <TableCell>
                {/* The file name is named here as well as in the response header (D-719): an
                    engine that disregards `content-disposition` disregards its filename too. */}
                <a
                  href={`/api/v1/runs/${runId}/exports/${String(row.version)}`}
                  download={t('record.courseExportFileName', {
                    runId,
                    version: String(row.version),
                  })}
                  className="text-primary text-meta focus-visible:outline-focus inline-flex min-h-10 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {t('review.exportDownload', { version: row.version })}
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
