import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Route } from 'next'
import { AssignmentsList } from '@/components/features/courses/assignments-list'
import { MappingEditor } from '@/components/features/courses/mapping-editor'
import { PolicyForm } from '@/components/features/courses/policy-form'
import { SectionsList } from '@/components/features/courses/sections-list'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { cn } from '@/lib/cn'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import type { SessionUser } from '@/server/auth/types'
import { getCourse, type CourseView } from '@/server/modules/courses'
import { CourseIdParamsSchema } from '@/server/modules/courses/schema'
import { getViewer } from '../../viewer'

export const metadata: Metadata = { title: t('courses.title') }

// UI-030, the detail half: one course and the four things a course is — its sections, its
// assignments, its policy and weights, and its band-to-points mapping.
//
// The four are sub-views reached by a link (`?tab=…`) rather than a client tab widget, for the same
// reason UI-010's three sections are three routes: each one is an address a person can send, reload,
// and go back from, the whole screen stays a server component, and "keyboard operable" costs
// nothing because a link already is. The current one carries `aria-current="page"`.
//
// A course the reader may not see is the not-found page, never the error boundary: `getCourse`
// answers NOT_FOUND for another institution's id and FORBIDDEN for a course in this institution
// that the reader holds no membership in (08 §4), and both mean the same thing to the reader.

const TABS = ['sections', 'assignments', 'policy', 'mapping'] as const
type Tab = (typeof TABS)[number]

const TAB_LABELS: Record<Tab, string> = {
  sections: t('courses.tabSections'),
  assignments: t('courses.tabAssignments'),
  policy: t('courses.tabPolicy'),
  mapping: t('courses.tabMapping'),
}

const PANEL_TITLES: Record<Tab, string> = {
  sections: t('courses.sectionsTitle'),
  assignments: t('courses.assignmentsTitle'),
  policy: t('courses.policyTitle'),
  mapping: t('courses.mappingTitle'),
}

const PANEL_DESCRIPTIONS: Record<Tab, string> = {
  sections: t('courses.sectionsDescription'),
  assignments: t('courses.assignmentsDescription'),
  policy: t('courses.policyDescription'),
  mapping: t('courses.mappingDescription'),
}

function tabHref(courseId: string, tab: Tab): Route {
  const href: string = `/courses/${courseId}?tab=${tab}`
  return href as Route
}

function readTab(value: string | string[] | undefined): Tab {
  return TABS.find((tab) => tab === value) ?? 'sections'
}

/** NOT_FOUND and FORBIDDEN are both "there is nothing here for you"; anything else is an incident. */
async function readCourse(actor: SessionUser, courseId: string): Promise<CourseView | null> {
  try {
    return await getCourse(actor, courseId)
  } catch (error) {
    if (!isAppError(error)) throw error
    if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') return null
    throw error
  }
}

export default async function CourseDetailPage({
  params,
  searchParams,
}: PageProps<'/courses/[courseId]'>) {
  const [{ actor, me }, { courseId }, query] = await Promise.all([
    getViewer(),
    params,
    searchParams,
  ])

  // An id that is not a uuid never reaches the repository: a malformed address is a 404, not a
  // database cast error on the error boundary.
  if (!CourseIdParamsSchema.safeParse({ courseId }).success) notFound()

  const course = await readCourse(actor, courseId)
  if (!course) notFound()

  const role = me.memberships.find((row) => row.organizationId === course.organizationId)?.role

  // A courtesy gate only: `requireCourseInstructor` re-checks that the actor actually teaches this
  // course, and every refusal comes back through the action envelope (08 §5).
  const canManage = role === 'instructor'
  const canReview = role === 'instructor' || role === 'program_lead'
  const tab = readTab(query.tab)

  return (
    <>
      <PageHeader
        title={course.name}
        description={t('courses.termLine', { term: course.term })}
        eyebrow={
          <Link
            href="/courses"
            className="text-primary focus-visible:outline-focus rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t('courses.backToCourses')}
          </Link>
        }
      />

      <nav aria-label={t('courses.viewsLabel')} className="mb-6">
        <ul className="bg-paper-sunken flex w-fit max-w-full flex-wrap gap-1 rounded-md p-1">
          {TABS.map((key) => {
            const active = key === tab
            return (
              <li key={key}>
                <Link
                  href={tabHref(courseId, key)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'text-meta focus-visible:outline-focus flex h-10 items-center rounded-md px-3 font-medium transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:-outline-offset-2',
                    active
                      ? 'border-line bg-paper-raised text-ink border'
                      : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {TAB_LABELS[key]}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <Panel
        id={`course-${tab}`}
        title={PANEL_TITLES[tab]}
        description={PANEL_DESCRIPTIONS[tab]}
        headingLevel={2}
      >
        {tab === 'sections' && (
          <SectionsList
            courseId={course.id}
            sections={course.sections}
            canManage={canManage}
            canViewRosters={canReview}
          />
        )}
        {tab === 'assignments' && (
          <AssignmentsList assignments={course.assignments} canConfigure={canReview} />
        )}
        {tab === 'policy' && (
          <PolicyForm
            courseId={course.id}
            outsideAiPolicy={course.outsideAiPolicy}
            defaultRunWeight={course.defaultRunWeight}
            taughtConcepts={course.taughtConcepts}
            readOnly={!canManage}
          />
        )}
        {tab === 'mapping' && (
          <MappingEditor courseId={course.id} mapping={course.mapping} readOnly={!canManage} />
        )}
      </Panel>
    </>
  )
}
