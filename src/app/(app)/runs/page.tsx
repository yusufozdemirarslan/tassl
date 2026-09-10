import type { Metadata } from 'next'
import { RunList } from '@/components/features/run/run-list'
import { toRunListRows } from '@/components/features/run/run-rows'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { listMyAssignments, type StudentAssignment } from '@/server/modules/courses'
import { listMyRunsForAssignments } from '@/server/modules/runs'
import { getViewer } from '../viewer'

export const metadata: Metadata = { title: t('run.listTitle') }

// UI-020 (FR-235). The student's own list: every assignment in their sections, and every attempt
// they have made on one.
//
// It is assignment-led rather than run-led, because the first thing a student comes here to do is
// start something that does not exist yet, and a list of runs cannot show them that.
// `listMyAssignments` supplies the assignments and their labels and owns the paging;
// `listMyRunsForAssignments` supplies the attempts *of the assignments that page returned*, and
// both are scoped to the actor by their own queries — neither can reach another student's work
// (08 §4).
//
// Two reads, joined here, rather than one endpoint that returns the join: they are the two lists
// 07 §3 documents, and a third shape built for this screen would be a third projection to keep
// inside the student view (12 §8). Only one of the two pages, though. Asking each for its own
// hundred rows and joining what came back left the join partial the moment a seat held more runs
// than assignments on screen (D-722).
//
// Timers are not materialized for a list, so a state here is at worst one poll stale; nothing is
// acted on from this screen except Start, which re-reads the run it creates.

/** Enough for any student's list in the pilot; the cursor below carries the rest (D-020). */
const PAGE_SIZE = 100

export default async function RunsPage({ searchParams }: PageProps<'/runs'>) {
  const [{ actor, me }, query] = await Promise.all([getViewer(), searchParams])

  if (me.memberships.length === 0) {
    return (
      <>
        <PageHeader title={t('run.listTitle')} />
        <Panel>
          <EmptyState
            headingLevel={2}
            title={t('run.noInstitutionTitle')}
            body={t('run.noInstitutionBody')}
          />
        </Panel>
      </>
    )
  }

  const raw = query.cursor
  const cursor = typeof raw === 'string' && raw.length > 0 ? raw : undefined

  // A hand-edited cursor is a bad address, not an incident: the first page is the honest answer.
  let assignments: { items: StudentAssignment[]; nextCursor: string | null }
  try {
    assignments = await listMyAssignments(actor, {
      limit: PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    })
  } catch (error) {
    if (!isAppError(error) || error.code !== 'VALIDATION_ERROR') throw error
    assignments = await listMyAssignments(actor, { limit: PAGE_SIZE })
  }

  // The attempts of the assignments on *this* page, not the newest hundred runs the seat holds
  // (D-722). Two lists paged independently do not join: past a hundred runs the older attempts fell
  // outside the runs window, and their assignments rendered as "Not started" with a "Start" that
  // then refused them, which is a dead end rather than a stale reading.
  const runs = await listMyRunsForAssignments(
    actor,
    assignments.items.map((assignment) => assignment.assignmentId),
  )
  const rows = toRunListRows(assignments.items, runs)

  const institution = me.memberships.find((row) => row.organizationId === me.activeOrganizationId)
  const eyebrow = institution?.name ?? me.memberships[0]?.name

  return (
    <>
      <PageHeader
        title={t('run.listTitle')}
        description={t('run.listDescription')}
        {...(eyebrow === undefined ? {} : { eyebrow })}
      />
      <Panel>
        {rows.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title={t('run.listEmptyTitle')}
            body={t('run.listEmptyBody')}
          />
        ) : (
          <RunList rows={rows} nextCursor={assignments.nextCursor} />
        )}
      </Panel>
    </>
  )
}
