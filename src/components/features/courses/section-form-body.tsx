'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { maxLength, minLength, object, string, trim, type output } from 'zod/mini'
import { toast } from 'sonner'
import { FormAlert, SubmitButton } from '@/components/features/account/form-feedback'
import { Button } from '@/components/ui/button'
import { DialogClose, DialogFooter } from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { t } from '@/lib/i18n/messages/courses'
import { createSectionAction } from '@/server/modules/courses/actions'

// UI-030 → Sections → "New section", the half that only exists while the dialog is open.
// `SectionsList` holds the table and the trigger; this module holds the one field and the footer,
// and is imported when the dialog opens (B4, see ./deferred-form). The dialog unmounts on close, so
// every open starts from an empty field and no refusal.
//
// The bound is the one `CreateSectionSchema` states server-side, restated with zod/mini so the
// browser is told sooner without pulling the module schema across the boundary (D-186).

const SECTION_NAME_MAX = 100

const sectionSchema = object({
  name: string().check(
    trim(),
    minLength(1, { error: t('courses.validation.sectionName') }),
    maxLength(SECTION_NAME_MAX, { error: t('courses.validation.sectionNameTooLong') }),
  ),
})

type SectionValues = output<typeof sectionSchema>

export function SectionFormBody({
  courseId,
  onCreated,
}: {
  courseId: string
  onCreated: () => void
}) {
  const router = useRouter()
  const fieldId = useId()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SectionValues>({
    resolver: zodResolver(sectionSchema),
    defaultValues: { name: '' },
  })

  const nameId = `${fieldId}-section-name`

  async function onSubmit(values: SectionValues): Promise<void> {
    setFormError(null)
    const result = await createSectionAction({ courseId, name: values.name })
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    onCreated()
    toast.success(t('courses.sectionCreated', { name: result.data.name }))
    router.refresh()
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
      <div className="flex flex-col gap-5">
        <Field data-invalid={errors.name ? 'true' : undefined}>
          <FieldLabel htmlFor={nameId}>{t('courses.sectionNameLabel')}</FieldLabel>
          <Input
            id={nameId}
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${nameId}-error` : undefined}
            {...register('name')}
          />
          <FieldError id={`${nameId}-error`}>{errors.name?.message}</FieldError>
        </Field>

        <FormAlert message={formError} />
      </div>

      <DialogFooter className="mt-6">
        <DialogClose render={<Button variant="secondary" disabled={isSubmitting} />}>
          {t('courses.cancel')}
        </DialogClose>
        <SubmitButton pending={isSubmitting}>
          {isSubmitting ? t('courses.sectionPending') : t('courses.sectionSubmit')}
        </SubmitButton>
      </DialogFooter>
    </form>
  )
}
