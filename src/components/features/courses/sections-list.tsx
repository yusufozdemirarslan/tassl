'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { EmptyState } from '@/components/layout/empty-state'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
import { DeferredFormFallback, useDeferredModule } from './deferred-form'

// UI-030 → Sections. The sections of one course with their counts and the way into each roster
// (UI-031, step 4.3), plus "New section". The counts are Mono with tabular figures so the column
// reads as a column; the table scrolls inside its own focusable region, named by its caption.
//
// The prop types are written out rather than imported from the courses module's schema: a client
// component never reaches into `schema.ts` (D-186), and what this list needs is four fields.
//
// The "New section" field and footer live in ./section-form-body and arrive when the dialog opens
// (B4): the table is what this sub-view paints, and react-hook-form plus the zod/mini schema are
// not part of reading it.

const loadBody = () => import('./section-form-body')

export type SectionRow = {
  id: string
  name: string
  memberCount: number
  assignmentCount: number
}

export type SectionsListProps = {
  courseId: string
  sections: readonly SectionRow[]
  /** An instructor who teaches the course: the only person offered "New section". */
  canManage: boolean
  /** Instructors and program leads may open a roster (UI-031); a student may not. */
  canViewRosters: boolean
}

/** The roster route lands in step 4.3, so its path is asserted until typegen has seen the file. */
function rosterHref(courseId: string, sectionId: string): Route {
  const href: string = `/courses/${courseId}/sections/${sectionId}/roster`
  return href as Route
}

export function SectionsList({ courseId, sections, canManage, canViewRosters }: SectionsListProps) {
  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div className="flex justify-start">
          <NewSectionDialog courseId={courseId} />
        </div>
      )}

      {sections.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title={t('courses.sectionsEmptyTitle')}
          body={t('courses.sectionsEmptyBody')}
        />
      ) : (
        <Table>
          <TableCaption>{t('courses.sectionsCaption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('courses.columnSection')}</TableHead>
              <TableHead scope="col" className="text-right">
                {t('courses.columnMembers')}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t('courses.columnAssignments')}
              </TableHead>
              {canViewRosters && <TableHead scope="col">{t('courses.columnRoster')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sections.map((section) => (
              <TableRow key={section.id}>
                <TableCell className="text-ink font-medium whitespace-normal">
                  {section.name}
                </TableCell>
                <TableCell className="text-right font-mono">{section.memberCount}</TableCell>
                <TableCell className="text-right font-mono">{section.assignmentCount}</TableCell>
                {canViewRosters && (
                  <TableCell>
                    <Link
                      href={rosterHref(courseId, section.id)}
                      prefetch={false}
                      aria-label={t('courses.openRoster', { name: section.name })}
                      className="text-primary focus-visible:outline-focus rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {t('courses.rosterLink')}
                    </Link>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function NewSectionDialog({ courseId }: { courseId: string }) {
  const [open, setOpen] = useState(false)
  const { loaded, status, request } = useDeferredModule(loadBody)
  const Body = loaded?.SectionFormBody

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) request()
      }}
    >
      <DialogTrigger render={<Button variant="secondary" />}>
        {t('courses.newSection')}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('courses.newSection')}</DialogTitle>
          <DialogDescription>{t('courses.newSectionDescription')}</DialogDescription>
        </DialogHeader>

        {Body ? (
          <Body courseId={courseId} onCreated={() => setOpen(false)} />
        ) : (
          <DeferredFormFallback status={status} />
        )}
      </DialogContent>
    </Dialog>
  )
}
