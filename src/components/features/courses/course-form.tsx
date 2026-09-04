'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { t } from '@/lib/i18n/t'
import { DeferredFormFallback, useDeferredModule } from './deferred-form'

// UI-030 → "New course". Two fields, because those are the two a course cannot exist without: the
// policy, the weight, the taught concepts, and the band mapping are set on the course that results
// (PolicyForm, MappingEditor), where each one can be read beside what it affects. The institution's
// default mapping is what the new course carries until then (10 §3 `createCourse`).
//
// The fields themselves live in ./course-form-body and arrive when the dialog opens (B4): the
// courses list paints a table and this button, and until the button is pressed react-hook-form and
// the zod/mini schema are 32 KB the reader never runs. The trigger, the frame, the title and the
// description stay here, so the control is keyboard operable and the dialog names itself
// immediately either way.

const loadBody = () => import('./course-form-body')

export function CourseForm({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false)
  const { loaded, status, request } = useDeferredModule(loadBody)
  const Body = loaded?.CourseFormBody

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) request()
      }}
    >
      <DialogTrigger render={<Button variant="primary" />}>{t('courses.newCourse')}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('courses.newCourse')}</DialogTitle>
          <DialogDescription>{t('courses.newCourseDescription')}</DialogDescription>
        </DialogHeader>

        {Body ? (
          <Body orgId={orgId} onCreated={() => setOpen(false)} />
        ) : (
          <DeferredFormFallback status={status} />
        )}
      </DialogContent>
    </Dialog>
  )
}
