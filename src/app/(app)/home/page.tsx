import type { Metadata } from 'next'
import {
  HomeCoursesPanel,
  HomePackagesPanel,
  HomeReviewPanel,
  type HomeCourseRow,
  type HomePackageRow,
  type HomeReviewRow,
} from '@/components/features/home/role-panels'
import { HomeRunsPanel } from '@/components/features/home/runs-panel'
import { toRunListRows } from '@/components/features/run/run-rows'
import { PageHeader } from '@/components/layout/page-header'
import { permittedRailKeys } from '@/components/layout/rail-items'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import type { SessionUser } from '@/server/auth/types'
import { listCourses, listMyAssignments } from '@/server/modules/courses'
import { getQueue } from '@/server/modules/review'
import { listMyRuns } from '@/server/modules/runs'
import { listPackages } from '@/server/modules/scenarios'
import { getViewer } from '../viewer'

export const metadata: Metadata = { title: t('home.title') }

// UI-009. The header names the institution the session is working in; the panels below it are the
// role panels, each of which lands with the data it reports:
//
//   "Your runs"  → the assignment list and its next action (Phase 6, step 6.5)
//   "Review"     → runs with bands to decide and runs nothing could place (Phase 11, step 11.1)
//   "Packages"   → versions still being confirmed (Phase 5, step 5.4)
//   "Courses"    → the instructor's courses (Phase 4, step 4.2)
//
// **A panel is drawn for the seat that has the data and for nobody else.** Each read is made behind
// the same guard its destination uses, and a refusal is `null` rather than an empty list: a student
// gets one panel, an instructor gets four, and nobody is shown an empty box about a thing they
// cannot do. The three reads are made in parallel and none of them can fail the page — a service
// that refuses is a seat that has no panel, and any other error is the error boundary's.
//
// The loading state for all of them is ./loading.tsx (the shell skeleton) and the error state is
// ./error.tsx, so every panel inherits both.

/** Enough to fill the panel and to know whether there is more behind the link. */
const HOME_LIMIT = 20

/** A list this seat may not read is no panel, never an empty one. */
async function orNoPanel<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    if (isAppError(error) && (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')) return null
    throw error
  }
}

/** The runs of this reviewer's own sections that need a decision or a hand (FR-186, FR-140). */
async function reviewRows(actor: SessionUser): Promise<HomeReviewRow[] | null> {
  const queue = await orNoPanel(() => getQueue(actor))
  if (queue === null) return null
  return queue.runs.map((run) => ({
    id: run.id,
    studentName: run.studentName,
    state: run.state,
    decisionsMade: run.decisionsMade,
    needsHand: run.scoringStatus === 'held',
  }))
}

/** Versions whose elements are still being confirmed (FR-192); a confirmed shelf needs no panel row. */
async function packageRows(
  actor: SessionUser,
  organizationId: string | undefined,
  offered: boolean,
): Promise<HomePackageRow[] | null> {
  if (!offered || organizationId === undefined) return null
  const page = await orNoPanel(() => listPackages(actor, organizationId, { limit: HOME_LIMIT }))
  if (page === null) return null
  return page.items.flatMap((row) =>
    row.latestVersion === null || row.latestVersion.status !== 'draft'
      ? []
      : [
          {
            id: row.id,
            title: row.title,
            versionId: row.latestVersion.id,
            version: row.latestVersion.version,
          },
        ],
  )
}

/**
 * The instructor's own courses.
 *
 * `offered` is the rail's own predicate rather than a second one: `listCourses` answers a *student*
 * their enrolled courses, which is right for `/courses` and wrong for a panel UI-009 gives to the
 * seat that runs them. The rail is where "who is offered Courses" is decided, and reading it here
 * keeps the home page and the navigation from disagreeing about the same person.
 */
async function courseRows(
  actor: SessionUser,
  organizationId: string | undefined,
  offered: boolean,
): Promise<HomeCourseRow[] | null> {
  if (!offered || organizationId === undefined) return null
  const page = await orNoPanel(() => listCourses(actor, organizationId, { limit: HOME_LIMIT }))
  if (page === null) return null
  return page.items.map((course) => ({
    id: course.id,
    name: course.name,
    term: course.term,
    sectionCount: course.sectionCount,
    assignmentCount: course.assignmentCount,
  }))
}

export default async function HomePage() {
  const { actor, me } = await getViewer()

  const institution = me.memberships.find((m) => m.organizationId === me.activeOrganizationId)
  const eyebrow = institution?.name ?? me.memberships[0]?.name
  const organizationId = institution?.organizationId ?? me.memberships[0]?.organizationId
  const offered = permittedRailKeys({
    roles: me.memberships.map((membership) => membership.role),
    platformRole: me.platformRole,
  })

  const [assignments, runs, review, packages, courses] = await Promise.all([
    listMyAssignments(actor, { limit: HOME_LIMIT }),
    listMyRuns(actor, { limit: HOME_LIMIT }),
    reviewRows(actor),
    packageRows(actor, organizationId, offered.includes('packages')),
    courseRows(actor, organizationId, offered.includes('courses')),
  ])

  return (
    <>
      <PageHeader
        title={t('home.title')}
        description={t('home.description')}
        {...(eyebrow === undefined ? {} : { eyebrow })}
      />
      <div className="flex flex-col gap-6">
        <HomeRunsPanel
          hasMembership={me.memberships.length > 0}
          rows={toRunListRows(assignments.items, runs.items)}
        />
        {review !== null && <HomeReviewPanel rows={review} />}
        {packages !== null && <HomePackagesPanel rows={packages} />}
        {courses !== null && <HomeCoursesPanel rows={courses} />}
      </div>
    </>
  )
}
