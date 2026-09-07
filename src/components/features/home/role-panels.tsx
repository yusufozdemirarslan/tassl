import Link from 'next/link'
import type { Route } from 'next'
import { RunStateChip } from '@/components/features/run/run-state-chip'
import { EmptyState } from '@/components/layout/empty-state'
import { LabelChip } from '@/components/layout/label-chip'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import { t } from '@/lib/i18n/t'
import type { RunStateValue } from '@/server/modules/runs/schema'

// UI-009's three role panels: Review, Packages, Courses.
//
// **A panel is drawn for the seat that has the data and for nobody else.** The home page reads each
// list behind the same guard the destination uses and passes `null` when the service refuses, and a
// `null` list renders nothing at all — not an empty panel. An empty panel is a promise about
// something this person cannot do, and three of them on a student's home page would be a home page
// about somebody else.
//
// **Rows are the smallest thing that answers "what needs me".** Five rows and a link, because the
// screen behind each panel is the one that holds the whole list; a home page that reproduced it
// would be a second implementation of the same table with its own idea of the next action.
//
// Server Components, all three: every row is a link or a chip.

/** As many rows as fit above the fold without the panel becoming the page (`HomeRunsPanel`'s five). */
const HOME_ROWS = 5

export type HomeReviewRow = {
  id: string
  studentName: string
  state: RunStateValue
  decisionsMade: number
  /** True when nothing could place the run's bands and a faculty seat has to set them (FR-140). */
  needsHand: boolean
}

export function HomeReviewPanel({ rows }: { rows: readonly HomeReviewRow[] }) {
  const shown = rows.slice(0, HOME_ROWS)
  return (
    <Panel
      id="home-review"
      title={t('home.reviewTitle')}
      headingLevel={2}
      actions={
        <Link href="/review" className={buttonVariants({ variant: 'secondary' })}>
          {t('home.reviewMore')}
        </Link>
      }
    >
      {shown.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title={t('home.reviewEmptyTitle')}
          body={t('home.reviewEmptyBody')}
        />
      ) : (
        <ul className="flex flex-col">
          {shown.map((row) => (
            <li
              key={row.id}
              className="border-line flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-ink text-body font-medium">{row.studentName}</span>
                <RunStateChip state={row.state} />
                {row.needsHand && <LabelChip kind="unreviewed" label={t('home.reviewHeld')} />}
                <span className="text-ink-muted text-meta font-mono tabular-nums">
                  {t('home.reviewDecisions', { made: row.decisionsMade })}
                </span>
              </span>
              <Link
                href={`/review/runs/${row.id}` as Route}
                className="text-primary text-meta focus-visible:outline-focus inline-flex min-h-10 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {t('home.reviewOpen', { student: row.studentName })}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export type HomePackageRow = {
  id: string
  title: string
  versionId: string
  version: number
}

export function HomePackagesPanel({ rows }: { rows: readonly HomePackageRow[] }) {
  const shown = rows.slice(0, HOME_ROWS)
  return (
    <Panel
      id="home-packages"
      title={t('home.packagesTitle')}
      headingLevel={2}
      actions={
        <Link href="/packages" className={buttonVariants({ variant: 'secondary' })}>
          {t('home.packagesMore')}
        </Link>
      }
    >
      {shown.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title={t('home.packagesEmptyTitle')}
          body={t('home.packagesEmptyBody')}
        />
      ) : (
        <ul className="flex flex-col">
          {shown.map((row) => (
            <li
              key={row.versionId}
              className="border-line flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-ink text-body font-medium">{row.title}</span>
                <LabelChip kind="draft" />
                <span className="text-ink-muted text-meta font-mono tabular-nums">
                  {t('home.packagesDraftVersion', { version: row.version })}
                </span>
              </span>
              <Link
                href={`/packages/${row.id}/versions/${row.versionId}/confirm` as Route}
                className="text-primary text-meta focus-visible:outline-focus inline-flex min-h-10 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {t('home.packagesOpen', { title: row.title })}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export type HomeCourseRow = {
  id: string
  name: string
  term: string
  sectionCount: number
  assignmentCount: number
}

export function HomeCoursesPanel({ rows }: { rows: readonly HomeCourseRow[] }) {
  const shown = rows.slice(0, HOME_ROWS)
  return (
    <Panel
      id="home-courses"
      title={t('home.coursesTitle')}
      headingLevel={2}
      actions={
        <Link href="/courses" className={buttonVariants({ variant: 'secondary' })}>
          {t('home.coursesMore')}
        </Link>
      }
    >
      {shown.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title={t('home.coursesEmptyTitle')}
          body={t('home.coursesEmptyBody')}
        />
      ) : (
        <ul className="flex flex-col">
          {shown.map((row) => (
            <li
              key={row.id}
              className="border-line flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-ink text-body font-medium">{row.name}</span>
                <span className="text-ink-muted text-meta">{row.term}</span>
                <span className="text-ink-muted text-meta font-mono tabular-nums">
                  {t('home.coursesCounts', {
                    sections: row.sectionCount,
                    assignments: row.assignmentCount,
                  })}
                </span>
              </span>
              <Link
                href={`/courses/${row.id}` as Route}
                className="text-primary text-meta focus-visible:outline-focus inline-flex min-h-10 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {t('home.coursesOpen', { name: row.name })}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
