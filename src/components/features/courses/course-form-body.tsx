'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { maxLength, minLength, object, string, trim, type output } from 'zod/mini'
import { toast } from 'sonner'
import { FormAlert, SubmitButton } from '@/components/features/account/form-feedback'
import { Button } from '@/components/ui/button'
import { DialogClose, DialogFooter } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { t } from '@/lib/i18n/messages/courses'
import { createCourseAction } from '@/server/modules/courses/actions'

// UI-030 → "New course", the half that only exists while the dialog is open. `CourseForm` holds
// the trigger, the frame, the title and the description; this module holds the two fields and the
// footer, and is imported when the dialog opens (B4, see ./deferred-form). The dialog unmounts on
// close, so every open starts from empty fields and no refusal — which is what the explicit reset
// used to do here.
//
// The bounds below are the ones `CreateCourseSchema` states server-side, restated with zod/mini so
// the browser is told sooner without pulling the module schema across the boundary (D-186).
//
// `course_created` (AN-002) is emitted by the service after the row exists; this form fires nothing.

const NAME_MAX = 200
const TERM_MAX = 100

const courseSchema = object({
  name: string().check(
    trim(),
    minLength(1, { error: t('courses.validation.name') }),
    maxLength(NAME_MAX, { error: t('courses.validation.nameTooLong') }),
  ),
  term: string().check(
    trim(),
    minLength(1, { error: t('courses.validation.term') }),
    maxLength(TERM_MAX, { error: t('courses.validation.termTooLong') }),
  ),
})

type CourseValues = output<typeof courseSchema>

export function CourseFormBody({ orgId, onCreated }: { orgId: string; onCreated: () => void }) {
  const router = useRouter()
  const fieldId = useId()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CourseValues>({
    resolver: zodResolver(courseSchema),
    defaultValues: { name: '', term: '' },
  })

  const nameId = `${fieldId}-name`
  const termId = `${fieldId}-term`

  async function onSubmit(values: CourseValues): Promise<void> {
    setFormError(null)
    const result = await createCourseAction({ orgId, name: values.name, term: values.term })
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    onCreated()
    toast.success(t('courses.created', { name: result.data.name }))
    // The course exists but carries nothing yet, so the useful place to land is the course itself,
    // where the policy, the weight, and the mapping are set.
    const href: string = `/courses/${result.data.id}`
    router.push(href as Route)
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
      <div className="flex flex-col gap-5">
        <Field data-invalid={errors.name ? 'true' : undefined}>
          <FieldLabel htmlFor={nameId}>{t('courses.nameLabel')}</FieldLabel>
          <Input
            id={nameId}
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${nameId}-error` : undefined}
            {...register('name')}
          />
          <FieldError id={`${nameId}-error`}>{errors.name?.message}</FieldError>
        </Field>

        <Field data-invalid={errors.term ? 'true' : undefined}>
          <FieldLabel htmlFor={termId}>{t('courses.termLabel')}</FieldLabel>
          <Input
            id={termId}
            autoComplete="off"
            aria-invalid={errors.term ? true : undefined}
            aria-describedby={errors.term ? `${termId}-error ${termId}-hint` : `${termId}-hint`}
            {...register('term')}
          />
          <FieldError id={`${termId}-error`}>{errors.term?.message}</FieldError>
          <FieldDescription id={`${termId}-hint`}>{t('courses.termHint')}</FieldDescription>
        </Field>

        <FormAlert message={formError} />
      </div>

      <DialogFooter className="mt-6">
        <DialogClose render={<Button variant="secondary" disabled={isSubmitting} />}>
          {t('courses.cancel')}
        </DialogClose>
        <SubmitButton pending={isSubmitting}>
          {isSubmitting ? t('courses.createPending') : t('courses.createSubmit')}
        </SubmitButton>
      </DialogFooter>
    </form>
  )
}
