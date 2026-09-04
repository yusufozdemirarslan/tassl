import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { CourseForm } from '@/components/features/courses/course-form'
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
import { t } from '@/lib/i18n/t'
import { listCourses, type CourseSummary } from '@/server/modules/courses'
import { getViewer } from '../viewer'

export const metadata: Metadata = { title: t('courses.title') }

// UI-030, the list half. The scope is the session's active institution — the same tenant the shell's
// switcher names — and `listCourses` decides what "the courses" means for the person asking:
// instructors and program leads see every course of the institution, everyone else sees the ones
// they hold a section membership in (10 §3). So a student who reaches /courses reads their
// enrolment rather than a refusal, and the "New course" control is offered only to an instructor,
// which is the one organization role `createCourse` accepts.
//
// `course_created` (AN-002) is emitted by the service; this screen fires no analytics of its own.

const courseHref = (courseId: string): Route => {
  const href: string = `/courses/${courseId}`
  return href as Route
}

const moreHref = (cursor: string): Route => {
  const href: string = `/courses?cursor=${encodeURIComponent(cursor)}`
  return href as Route
}

export default async function CoursesPage({ searchParams }: PageProps<'/courses'>) {
  const [{ actor, me }, query] = await Promise.all([getViewer(), searchParams])

  // The institution the session is working in; the shell resolves the same one for the switcher.
  const membership =
    me.memberships.find((row) => row.organizationId === me.activeOrganizationId) ??
    me.memberships[0]

  if (!membership) {
    return (
      <>
        <PageHeader title={t('courses.title')} />
        <Panel>
          <EmptyState
            headingLevel={2}
            title={t('courses.noInstitutionTitle')}
            body={t('courses.noInstitutionBody')}
          />
        </Panel>
      </>
    )
  }

  const raw = query.cursor
  const cursor = typeof raw === 'string' && raw.length > 0 ? raw : undefined

  // A hand-edited cursor is a bad address, not an incident: the first page is the honest answer.
  let page: { items: CourseSummary[]; nextCursor: string | null }
  try {
    page = await listCourses(actor, membership.organizationId, cursor ? { cursor } : {})
  } catch (error) {
    if (!isAppError(error) || error.code !== 'VALIDATION_ERROR') throw error
    page = await listCourses(actor, membership.organizationId, {})
  }

  const canCreate = membership.role === 'instructor'
  const newCourse = canCreate ? <CourseForm orgId={membership.organizationId} /> : undefined

  return (
    <>
      <PageHeader
        title={t('courses.title')}
        description={t('courses.description')}
        eyebrow={membership.name}
        {...(page.items.length > 0 && newCourse ? { actions: newCourse } : {})}
      />
      <Panel>
        {page.items.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title={t('courses.emptyTitle')}
            body={t('courses.emptyBody')}
            {...(newCourse ? { action: newCourse } : {})}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <Table>
              <TableCaption>{t('courses.listCaption')}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t('courses.columnName')}</TableHead>
                  <TableHead scope="col">{t('courses.columnTerm')}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t('courses.columnSections')}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {t('courses.columnAssignments')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((course) => (
                  <TableRow key={course.id}>
                    <TableCell className="whitespace-normal">
                      <Link
                        href={courseHref(course.id)}
                        aria-label={t('courses.openCourse', { name: course.name })}
                        className="text-primary focus-visible:outline-focus rounded-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        {course.name}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-normal">{course.term}</TableCell>
                    <TableCell className="text-right font-mono">{course.sectionCount}</TableCell>
                    <TableCell className="text-right font-mono">{course.assignmentCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {page.nextCursor !== null && (
              <Link
                href={moreHref(page.nextCursor)}
                className={buttonVariants({ variant: 'secondary', className: 'w-fit' })}
              >
                {t('courses.showMore')}
              </Link>
            )}
          </div>
        )}
      </Panel>
    </>
  )
}
