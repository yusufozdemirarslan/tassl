import Link from 'next/link'
import type { Route } from 'next'
import { LabelChip } from '@/components/layout/label-chip'
import { Badge } from '@/components/ui/badge'
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
import { t } from '@/lib/i18n/t'
import type {
  CalibrationStatusValue,
  PackageStatusValue,
  PackageSummaryView,
  PackageWarningValue,
} from '@/server/modules/scenarios/schema'

// UI-040. The institution's packages, one row per family: what it is called, the family key an
// import and an export travel under, the newest version with the two chips that say how far it has
// got, and the family-level warnings `listPackages` returns.
//
// The row's way through is the latest version view (UI-044), because that is the screen that says
// what the version holds and, while it is a draft, leads on to the confirmation workspace. A family
// with no version cannot happen — `createPackageFromSeed` writes version 1 in the same transaction
// as the package — but the view type allows it, so the row states it rather than linking nowhere.
//
// Nothing here is interactive, so the whole table stays a server component: what the route ships to
// the browser is the shell and the rail, not this.

export type PackagesTableProps = {
  packages: readonly PackageSummaryView[]
  /** The cursor of the next page, or null on the last one (D-020). */
  nextCursor: string | null
}

/** Version views land with this same step; the path is asserted until typegen has seen the route. */
function versionHref(packageId: string, versionId: string): Route {
  const href: string = `/packages/${packageId}/versions/${versionId}`
  return href as Route
}

function moreHref(cursor: string): Route {
  const href: string = `/packages?cursor=${encodeURIComponent(cursor)}`
  return href as Route
}

/**
 * Draft and confirmed are the two states this build writes, and both are label chips already.
 * Retired is in the enum and nothing sets it yet, so it takes the neutral chip: an amber or green
 * wash would claim a meaning the state does not have.
 */
function StatusChip({ status }: { status: PackageStatusValue }) {
  if (status === 'draft') return <LabelChip kind="draft" />
  if (status === 'confirmed') return <LabelChip kind="confirmed" />
  return <Badge variant="secondary">{t('packages.statusRetired')}</Badge>
}

/**
 * Every version in this build is uncalibrated, because no cohort has run one yet. An amber chip on
 * every row of the column marks nothing — and it costs the two amber facts that do mean something,
 * a draft status and a warning to act on, the contrast they are drawn in. So calibration takes the
 * neutral wash `DESIGN.md` §Chips allows a label chip (`--paper-sunken`, the strong color in the
 * icon), and amber stays with state that is still moving. The word is on the chip either way.
 */
function CalibrationChip({ status }: { status: CalibrationStatusValue }) {
  if (status === 'uncalibrated') {
    return (
      <LabelChip
        kind="uncalibrated"
        className="bg-paper-sunken border-line-strong [&_svg]:text-ink-muted"
      />
    )
  }
  return <Badge variant="secondary">{t('packages.calibrated')}</Badge>
}

const WARNING_LABELS: Record<PackageWarningValue, string> = {
  FAMILY_LACKS_ETHICAL_DEFECT: t('packages.warningEthicalShortcut'),
}

/**
 * The authoring warnings of FR-190, in `LabelChip`'s own warning kind. It never wraps: at the width
 * this column gets, "No ethical-shortcut defect" broke over two lines in every row and a 20 px chip
 * set the height of the whole table. The table is wider than the phone either way, and the scroll
 * region is what that is for. What the author should do about it is one sentence under the table,
 * where there is room to say it once instead of in every row.
 */
function WarningChip({ warning }: { warning: PackageWarningValue }) {
  return <LabelChip kind="warning" label={WARNING_LABELS[warning]} className="whitespace-nowrap" />
}

export function PackagesTable({ packages, nextCursor }: PackagesTableProps) {
  const anyWarning = packages.some((row) => row.warnings.length > 0)

  return (
    <div className="flex flex-col gap-4">
      {/* Six columns of identifiers and chips do not fit a phone; the table keeps its width and
          the scroll region moves, which is what the region in `Table` exists for. The floor is
          wide enough for the warning chip to stay on one line. */}
      <Table className="min-w-4xl">
        {/* The caption sits under the table, directly above the note below it, so it starts where
            that note starts rather than at the first column's 8 px gutter. */}
        <TableCaption className="px-0">{t('packages.listCaption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('packages.columnPackage')}</TableHead>
            <TableHead scope="col">{t('packages.columnFamily')}</TableHead>
            <TableHead scope="col">{t('packages.columnLatestVersion')}</TableHead>
            <TableHead scope="col">{t('packages.columnStatus')}</TableHead>
            <TableHead scope="col">{t('packages.columnCalibration')}</TableHead>
            <TableHead scope="col">{t('packages.columnWarnings')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {packages.map((pkg) => {
            const latest = pkg.latestVersion
            return (
              <TableRow key={pkg.id}>
                <TableCell className="whitespace-normal">
                  {latest ? (
                    <Link
                      href={versionHref(pkg.id, latest.id)}
                      aria-label={t('packages.openVersion', {
                        title: pkg.title,
                        version: latest.version,
                      })}
                      className="text-primary focus-visible:outline-focus rounded-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {pkg.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{pkg.title}</span>
                  )}
                </TableCell>

                <TableCell className="font-mono">{pkg.familyKey}</TableCell>

                <TableCell className="whitespace-normal">
                  {latest ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono">
                        {t('packages.versionNumber', { version: latest.version })}
                      </span>
                      {pkg.versionCount > 1 && (
                        <span className="text-ink-muted text-meta">
                          {t('packages.versionCount', { count: pkg.versionCount })}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-ink-muted">{t('packages.noVersion')}</span>
                  )}
                </TableCell>

                <TableCell>
                  {latest ? <StatusChip status={latest.status} /> : <NoValue />}
                </TableCell>

                <TableCell>
                  {latest ? <CalibrationChip status={latest.calibrationStatus} /> : <NoValue />}
                </TableCell>

                <TableCell className="whitespace-normal">
                  {pkg.warnings.length === 0 ? (
                    <NoValue label={t('packages.warningsNone')} />
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {pkg.warnings.map((warning) => (
                        <WarningChip key={warning} warning={warning} />
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {anyWarning && (
        <p className="text-ink-muted text-body max-w-[72ch]">
          {t('packages.warningEthicalShortcutHelp')}
        </p>
      )}

      {nextCursor !== null && (
        <Link
          href={moreHref(nextCursor)}
          className={buttonVariants({ variant: 'secondary', className: 'w-fit' })}
        >
          {t('packages.showMore')}
        </Link>
      )}
    </div>
  )
}

/** An em dash reads as "nothing here" to the eye; the label is what a screen reader is given. */
function NoValue({ label }: { label?: string }) {
  return (
    <>
      <span aria-hidden="true" className="text-ink-faint">
        —
      </span>
      {label && <span className="sr-only">{label}</span>}
    </>
  )
}
