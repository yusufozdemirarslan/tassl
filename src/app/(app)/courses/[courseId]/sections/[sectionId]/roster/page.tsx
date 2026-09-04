import type { Metadata } from 'next'
import type { Route } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SectionRoster } from '@/components/features/courses/section-roster'
import { PageHeader } from '@/components/layout/page-header'
import { buttonVariants } from '@/components/ui/button'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import type { SessionUser } from '@/server/auth/types'
import { getCourse, listSectionMembers, type SectionMember } from '@/server/modules/courses'
import { getViewer } from '../../../../../viewer'

export const metadata: Metadata = { title: t('roster.title') }

// UI-031 (SYS-005). The roster is what a run's reviewer scope is read from, so the service already
// limits it to the course's instructor and the institution's program lead; a viewer outside that
// set gets NOT_FOUND or FORBIDDEN here and lands on the in-shell not-found page rather than on the
// error boundary (08 §4: a resource you may not see does not exist).
//
// The whole roster is read here rather than paged in the screen: `listSectionMembers` is a cursor
// list, and an instructor reading a class list wants the class, not page one of it. The read is
// capped so a pathological section cannot hold the request open, and the cap says so on the screen.

const PAGE_SIZE = 100
const MAX_PAGES = 10

/** A resource the viewer may not see renders the not-found page, never the error boundary. */
async function orNotFound<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound()
    throw error
  }
}

async function readRoster(
  actor: SessionUser,
  sectionId: string,
): Promise<{ members: SectionMember[]; truncated: boolean }> {
  const members: SectionMember[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listSectionMembers(
      actor,
      sectionId,
      cursor === null ? { limit: PAGE_SIZE } : { cursor, limit: PAGE_SIZE },
    )
    members.push(...result.items)
    if (result.nextCursor === null) return { members, truncated: false }
    cursor = result.nextCursor
  }
  return { members, truncated: true }
}

export default async function SectionRosterPage({
  params,
}: PageProps<'/courses/[courseId]/sections/[sectionId]/roster'>) {
  const [{ actor }, { courseId, sectionId }] = await Promise.all([getViewer(), params])

  const course = await orNotFound(() => getCourse(actor, courseId))
  const section = course.sections.find((row) => row.id === sectionId)
  // A section id that belongs to another course is not this course's roster.
  if (!section) notFound()

  const { members, truncated } = await orNotFound(() => readRoster(actor, sectionId))

  return (
    <>
      <PageHeader
        title={t('roster.title')}
        description={t('roster.description')}
        eyebrow={t('roster.context', { course: course.name, section: section.name })}
        actions={
          // `/courses/[courseId]` is UI-030's route (step 4.2); the cast keeps this file from
          // depending on the moment that page's types are generated.
          <Link
            href={`/courses/${course.id}` as Route}
            className={buttonVariants({ variant: 'secondary' })}
          >
            {t('roster.backToCourse')}
          </Link>
        }
      />
      <SectionRoster
        sectionId={section.id}
        sectionName={section.name}
        organizationId={course.organizationId}
        members={members}
        truncated={truncated}
      />
    </>
  )
}
