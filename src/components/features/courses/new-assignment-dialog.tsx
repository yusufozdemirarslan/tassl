'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { assignment } from '@/lib/i18n/messages/assignment'
import { courses } from '@/lib/i18n/messages/courses'
import { scopedT } from '@/lib/i18n/scoped'
import { DeferredFormFallback, useDeferredModule } from './deferred-form'
import type { PackageVersionOption } from './package-version-option'

// UI-030 → Assignments → "New assignment" (step 4.4): the only way an assignment is created, so
// UI-032's screen is reachable without the API. The trigger, the dialog frame and its title stay in
// the entry bundle; the section select and the configuration form arrive on the press that needs
// them (B4, ./deferred-form), exactly as "New section" does.
//
// Two states where the control cannot act, and both say why on the screen rather than by silently
// vanishing: a course with no section (an assignment belongs to one) and an institution with no
// confirmed package version (an assignment runs on one). The button keeps its accessible name and
// `aria-disabled`, so it is still reachable by keyboard and the reason is read with it.

// The dialog is a course sub-view (courses) that explains, when it cannot act, what an assignment
// needs before it can exist (assignment).
const t = scopedT(assignment, courses)

const loadBody = () => import('./new-assignment-body')

export type NewAssignmentDialogProps = {
  sections: readonly { id: string; name: string }[]
  packageVersions: readonly PackageVersionOption[]
  courseDefaultWeight: number
}

export function NewAssignmentDialog({
  sections,
  packageVersions,
  courseDefaultWeight,
}: NewAssignmentDialogProps) {
  const reasonId = useId()
  const [open, setOpen] = useState(false)
  const { loaded, status, request } = useDeferredModule(loadBody)
  const Body = loaded?.NewAssignmentBody

  const blockedReason =
    sections.length === 0
      ? t('courses.newAssignmentNoSections')
      : packageVersions.length === 0
        ? t('assignment.noPackagesBody')
        : null

  if (blockedReason !== null) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          variant="secondary"
          className="w-fit"
          aria-disabled="true"
          aria-describedby={reasonId}
        >
          {t('courses.newAssignment')}
        </Button>
        <p id={reasonId} className="text-ink-muted text-body max-w-[60ch]">
          {blockedReason}
        </p>
      </div>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) request()
      }}
    >
      <DialogTrigger render={<Button variant="secondary" />}>
        {t('courses.newAssignment')}
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('courses.newAssignment')}</DialogTitle>
          <DialogDescription>{t('courses.newAssignmentDescription')}</DialogDescription>
        </DialogHeader>

        {Body ? (
          <Body
            sections={sections}
            packageVersions={packageVersions}
            courseDefaultWeight={courseDefaultWeight}
          />
        ) : (
          <DeferredFormFallback status={status} />
        )}
      </DialogContent>
    </Dialog>
  )
}
