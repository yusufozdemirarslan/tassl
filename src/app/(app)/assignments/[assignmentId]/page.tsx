import type { Metadata } from 'next'
import type { Route } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AssignmentForm } from '@/components/features/courses/assignment-form'
import { AssignmentRunsTable } from '@/components/features/courses/assignment-runs-table'
import {
  toPackageVersionOptions,
  type PackageVersionOption,
} from '@/components/features/courses/package-version-option'
import { EmptyState } from '@/components/layout/empty-state'
import { LabelChip } from '@/components/layout/label-chip'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import {
  getAssignment,
  getCourse,
  listAssignmentRuns,
  listConfirmedPackageVersions,
} from '@/server/modules/courses'
import { AssignmentIdParamsSchema } from '@/server/modules/courses/schema'
import { getViewer } from '../../viewer'

export const metadata: Metadata = { title: t('assignment.title') }

// UI-032, configuration half. The runs table is Phase 6 (step 6.x, `listAssignmentRuns` and
// `deleteWalkthroughRunAction`), so its panel renders the honest empty state rather than a
// placeholder table: what a run row says — state, decisions made, export version — is data this
// build does not have yet.
//
// Who may open it: the service lets any member of the assignment's section read it (a student needs
// it for the run start screen, UI-021), but this screen is the instructor's configuration surface,
// so a viewer who is neither an instructor nor a program lead of the institution gets the
// not-found page. That is a courtesy check on top of the service's own: every action behind this
// form re-checks the course instructor server-side (08 §5).

/** A resource the viewer may not see renders the not-found page, never the error boundary. */
async function orNotFound<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound()
    throw error
  }
}

export default async function AssignmentPage({ params }: PageProps<'/assignments/[assignmentId]'>) {
  const [{ actor, me }, { assignmentId }] = await Promise.all([getViewer(), params])

  // An id that is not a uuid never reaches the repository: a malformed address is a 404, not a
  // database cast error on the error boundary.
  if (!AssignmentIdParamsSchema.safeParse({ assignmentId }).success) notFound()

  const assignment = await orNotFound(() => getAssignment(actor, assignmentId))
  const course = await orNotFound(() => getCourse(actor, assignment.courseId))

  const role = me.memberships.find(
    (membership) => membership.organizationId === course.organizationId,
  )?.role
  if (role !== 'instructor' && role !== 'program_lead') notFound()

  // Every confirmed version of the institution, so the screen can re-point the assignment at
  // another one and offer that version's own variants — which is what UI-032 is for.
  const confirmed = toPackageVersionOptions(
    await listConfirmedPackageVersions(actor, course.organizationId),
  )
  // A version that has since been retired keeps the assignments already on it, and the select still
  // has to be able to name what this one points at. Nothing is calibrated in this build (PRD §7.19),
  // which is what the chip on that row says.
  const current: PackageVersionOption = {
    id: assignment.packageVersionId,
    title: assignment.packageTitle,
    version: assignment.packageVersion,
    calibrationStatus: 'uncalibrated',
    // The reader here is an instructor or a program lead, so the view names the variant; a student
    // reading the same assignment is told what they are taking and not what it is (D-254).
    variants:
      assignment.variantKey === null
        ? []
        : [{ id: assignment.variantId, key: assignment.variantKey }],
    defaultWorkingClockSeconds:
      assignment.workingClockSeconds === null ? assignment.effectiveWorkingClockSeconds : null,
  }
  const packageVersions = confirmed.some((option) => option.id === assignment.packageVersionId)
    ? confirmed
    : [current, ...confirmed]

  // Every run taken on this assignment, for the reviewer's table below the form (UI-032). The
  // student's own list is `/runs`, which is a different projection for a different reader (08 §4).
  const runs = await listAssignmentRuns(actor, assignmentId, { limit: 100 })

  return (
    <>
      <PageHeader
        title={assignment.label}
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {t('assignment.context', {
                course: assignment.courseName,
                section: assignment.sectionName,
              })}
            </span>
            {assignment.isWalkthrough && <LabelChip kind="walkthrough" />}
          </span>
        }
        actions={
          // `/courses/[courseId]` is UI-030's route (step 4.2); the cast keeps this file from
          // depending on the moment that page's types are generated.
          <Link
            href={`/courses/${assignment.courseId}` as Route}
            className={buttonVariants({ variant: 'secondary' })}
          >
            {t('assignment.backToCourse')}
          </Link>
        }
      />

      <div className="flex flex-col gap-6">
        <Panel
          id="assignment-configuration"
          title={t('assignment.configureTitle')}
          description={t('assignment.configureDescription')}
          headingLevel={2}
        >
          <AssignmentForm
            packageVersions={packageVersions}
            courseDefaultWeight={course.defaultRunWeight}
            assignment={{
              id: assignment.id,
              label: assignment.label,
              packageVersionId: assignment.packageVersionId,
              variantId: assignment.variantId,
              workingClockSeconds: assignment.workingClockSeconds,
              weight: assignment.weight,
              isWalkthrough: assignment.isWalkthrough,
              opensAt: assignment.opensAt,
              inUse: assignment.inUse,
            }}
          />
        </Panel>

        {/* UI-032's runs half. `listAssignmentRuns` refuses anyone who is not a reviewer of the
            section, and the check above has already narrowed this screen to an instructor or a
            program lead; the projection it returns is the reviewer's, which no student receives.
            The delete is offered on a walkthrough assignment alone — a run that counts is voided
            instead, which keeps the record (D-104). */}
        <Panel id="assignment-runs" title={t('assignment.runsTitle')} headingLevel={2}>
          {runs.items.length === 0 ? (
            <EmptyState
              headingLevel={3}
              title={t('assignment.runsEmptyTitle')}
              body={t('assignment.runsEmptyBody')}
            />
          ) : (
            <AssignmentRunsTable
              canDelete={assignment.isWalkthrough}
              runs={runs.items.map((row) => ({
                id: row.id,
                studentName: row.studentName,
                attemptNo: row.attemptNo,
                state: row.state,
                underReview: row.scoringStatus === 'held',
                decisionsMade: row.decisionsMade,
                latestExportVersion: row.latestExportVersion,
              }))}
            />
          )}
        </Panel>
      </div>
    </>
  )
}
