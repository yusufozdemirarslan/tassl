import type { Metadata } from 'next'
import type { Route } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  AssignmentForm,
  type PackageVersionOption,
} from '@/components/features/courses/assignment-form'
import { EmptyState } from '@/components/layout/empty-state'
import { LabelChip } from '@/components/layout/label-chip'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { getAssignment, getCourse } from '@/server/modules/courses'
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

  const assignment = await orNotFound(() => getAssignment(actor, assignmentId))
  const course = await orNotFound(() => getCourse(actor, assignment.courseId))

  const role = me.memberships.find(
    (membership) => membership.organizationId === course.organizationId,
  )?.role
  if (role !== 'instructor' && role !== 'program_lead') notFound()

  // Until Phase 5 gives the packages module a public read, the only confirmed version this screen
  // can name is the one the assignment already points at — with its own variant, and its clock only
  // when the assignment does not override it (`effectiveWorkingClockSeconds` resolves to the
  // package's value in exactly that case).
  const packageVersions: PackageVersionOption[] = [
    {
      id: assignment.packageVersionId,
      title: assignment.packageTitle,
      version: assignment.packageVersion,
      variants: [{ id: assignment.variantId, key: assignment.variantKey }],
      defaultWorkingClockSeconds:
        assignment.workingClockSeconds === null ? assignment.effectiveWorkingClockSeconds : null,
    },
  ]

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

        {/* The runs table (student, attempt, state, decisions made, export version, replay and the
            walkthrough delete) arrives with Phase 6, which is where runs first exist. */}
        <Panel id="assignment-runs" title={t('assignment.runsTitle')} headingLevel={2}>
          <EmptyState
            headingLevel={3}
            title={t('assignment.runsEmptyTitle')}
            body={t('assignment.runsEmptyBody')}
          />
        </Panel>
      </div>
    </>
  )
}
