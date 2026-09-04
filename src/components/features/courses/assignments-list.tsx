import Link from 'next/link'
import type { Route } from 'next'
import { EmptyState } from '@/components/layout/empty-state'
import { LabelChip } from '@/components/layout/label-chip'
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

// UI-030 → Assignments. The course's assignments with the state summary this build can tell the
// truth about — the run type, whether the assignment is open or still scheduled, the working clock,
// and the walkthrough label — and the way through to the configuration screen (UI-032, step 4.4).
// The runs behind an assignment arrive in Phase 6; nothing here stands in for them.
//
// No interaction, so no client bundle: a server component that renders links and text.

export type AssignmentRow = {
  id: string
  label: string
  runType: 'decision' | 'critique'
  /** Null means the package's own clock; UI-032 resolves it, this list names it. */
  workingClockSeconds: number | null
  isWalkthrough: boolean
  /** ISO; null means the assignment is open as soon as it exists. */
  opensAt: string | null
}

export type AssignmentsListProps = {
  assignments: readonly AssignmentRow[]
  /** Only a reviewer may open the configuration screen (09 §1); everyone else reads the label. */
  canConfigure: boolean
}

const RUN_TYPE_LABELS: Record<AssignmentRow['runType'], string> = {
  decision: t('courses.runTypeDecision'),
  critique: t('courses.runTypeCritique'),
}

/** The assignment route lands in step 4.4, so its path is asserted until typegen has seen it. */
function assignmentHref(assignmentId: string): Route {
  const href: string = `/assignments/${assignmentId}`
  return href as Route
}

/** Open, or scheduled with the moment it opens; the timestamp is UTC everywhere (D-177). */
function stateOf(opensAt: string | null): string {
  if (opensAt === null) return t('courses.stateOpen')
  const opens = new Date(opensAt)
  if (!Number.isNaN(opens.getTime()) && opens.getTime() <= Date.now()) {
    return t('courses.stateOpen')
  }
  return t('courses.stateScheduled', { date: formatDateTime(opensAt) })
}

function clockOf(seconds: number | null): string {
  if (seconds === null) return t('courses.clockPackageDefault')
  return t('courses.clockMinutes', { minutes: Math.round(seconds / 60) })
}

export function AssignmentsList({ assignments, canConfigure }: AssignmentsListProps) {
  if (assignments.length === 0) {
    return (
      <EmptyState
        headingLevel={3}
        title={t('courses.assignmentsEmptyTitle')}
        body={t('courses.assignmentsEmptyBody')}
      />
    )
  }

  return (
    <Table>
      <TableCaption>{t('courses.assignmentsCaption')}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t('courses.columnAssignment')}</TableHead>
          <TableHead scope="col">{t('courses.columnType')}</TableHead>
          <TableHead scope="col">{t('courses.columnState')}</TableHead>
          <TableHead scope="col">{t('courses.columnClock')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assignments.map((assignment) => (
          <TableRow key={assignment.id}>
            <TableCell className="whitespace-normal">
              <div className="flex flex-wrap items-center gap-2">
                {canConfigure ? (
                  <Link
                    href={assignmentHref(assignment.id)}
                    prefetch={false}
                    aria-label={t('courses.configureAssignment', { label: assignment.label })}
                    className="text-primary focus-visible:outline-focus rounded-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {assignment.label}
                  </Link>
                ) : (
                  <span className="text-ink font-medium">{assignment.label}</span>
                )}
                {assignment.isWalkthrough && <LabelChip kind="walkthrough" />}
              </div>
            </TableCell>
            <TableCell>{RUN_TYPE_LABELS[assignment.runType]}</TableCell>
            <TableCell>{stateOf(assignment.opensAt)}</TableCell>
            <TableCell className="font-mono">{clockOf(assignment.workingClockSeconds)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
