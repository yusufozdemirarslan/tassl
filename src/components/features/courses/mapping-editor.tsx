'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { object, refine, string, type output } from 'zod/mini'
import { toast } from 'sonner'
import { FormAlert, SubmitButton } from '@/components/features/account/form-feedback'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { t } from '@/lib/i18n/t'
import { updateCoursePolicyAction } from '@/server/modules/courses/actions'

// UI-030 → Mapping. The four numbers a confirmed band is worth in this course (PRD §7.19, 10 §17):
// the rule is four positive, finite numbers, which `MappingSchema` states server-side and this form
// restates with zod/mini so the person is told before the round trip (D-186 — a client component
// never imports a module's schema.ts, so the bound is written out here rather than shared).
//
// One control, which acts: Save mapping — `updateCoursePolicy`, which accepts a mapping only while
// the course has no confirmed run. When one exists the service answers MAPPING_CHANGE_UNCONFIRMED
// and that envelope message is what the person reads; this form does not guess at the confirmed
// count, because the count is the service's to know.
//
// There is no "Apply to confirmed runs" button. Re-pointing runs that are already confirmed means
// previewing the affected runs and re-exporting each of them (FR-206), which Phase 11 delivers as
// one thing: the preview table, the "I understand every confirmed run will be re-exported"
// acknowledgement, and the applied toast. A control that is present but can never act is a promise
// the screen cannot keep, so until then only the sentence beneath the form is here.

/** Points as they are typed: an optional sign, digits, and an optional decimal part. */
const NUMBER_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)$/

const looksNumeric = (value: string): boolean => NUMBER_PATTERN.test(value.trim())

/**
 * Two checks rather than one, so the message names what is actually wrong. Both run (zod/mini
 * refinements do not abort the chain), so the second guards on the first: "abc" is not a number
 * and is not also reported as not positive.
 */
const pointField = string().check(
  refine((value: string) => looksNumeric(value), { error: t('courses.validation.point') }),
  refine((value: string) => !looksNumeric(value) || Number(value) > 0, {
    error: t('courses.validation.pointPositive'),
  }),
)

const mappingSchema = object({
  novice: pointField,
  developing: pointField,
  proficient: pointField,
  professional: pointField,
})

type MappingValues = output<typeof mappingSchema>

/** The band order is the Appendix A order, lowest first; it is the order the editor shows. */
const BANDS = [
  { key: 'novice', label: t('courses.mappingNovice') },
  { key: 'developing', label: t('courses.mappingDeveloping') },
  { key: 'proficient', label: t('courses.mappingProficient') },
  { key: 'professional', label: t('courses.mappingProfessional') },
] as const satisfies ReadonlyArray<{ key: keyof MappingValues; label: string }>

export type MappingEditorProps = {
  courseId: string
  /** The course's current mapping; the same four keys the service reads and writes. */
  mapping: { novice: number; developing: number; proficient: number; professional: number }
  /** True for a reader who may see the course but not change it (a program lead, a student). */
  readOnly?: boolean
}

export function MappingEditor({ courseId, mapping, readOnly = false }: MappingEditorProps) {
  const router = useRouter()
  const fieldId = useId()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MappingValues>({
    resolver: zodResolver(mappingSchema),
    defaultValues: {
      novice: String(mapping.novice),
      developing: String(mapping.developing),
      proficient: String(mapping.proficient),
      professional: String(mapping.professional),
    },
  })

  async function onSubmit(values: MappingValues): Promise<void> {
    setFormError(null)
    const result = await updateCoursePolicyAction({
      courseId,
      mapping: {
        novice: Number(values.novice),
        developing: Number(values.developing),
        proficient: Number(values.proficient),
        professional: Number(values.professional),
      },
    })
    if (!result.ok) {
      // MAPPING_CHANGE_UNCONFIRMED (a confirmed run exists) and MAPPING_INVALID both arrive here;
      // the envelope message is the sentence, verbatim, rather than a second wording of the rule.
      setFormError(result.error.message)
      return
    }
    reset({
      novice: String(result.data.mapping.novice),
      developing: String(result.data.mapping.developing),
      proficient: String(result.data.mapping.proficient),
      professional: String(result.data.mapping.professional),
    })
    toast.success(t('courses.mappingSaved'))
    router.refresh()
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
      <div className="flex flex-col gap-5">
        {/* Four numbers on one scale, so they are set side by side and each control is the width of
            the number it holds; the field around it keeps the room its label and its error need. */}
        <div className="grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
          {BANDS.map(({ key, label }) => {
            const message = errors[key]?.message
            const inputId = `${fieldId}-${key}`
            const errorId = `${inputId}-error`
            return (
              <Field key={key} data-invalid={message ? 'true' : undefined}>
                <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
                <Input
                  id={inputId}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="max-w-24 font-mono tabular-nums"
                  disabled={readOnly}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? errorId : undefined}
                  {...register(key)}
                />
                <FieldError id={errorId}>{message}</FieldError>
              </Field>
            )
          })}
        </div>

        <FormAlert message={formError} />

        {readOnly ? (
          <p className="text-ink-muted text-body max-w-[60ch]">{t('courses.readOnlyNote')}</p>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <SubmitButton pending={isSubmitting}>
              {isSubmitting ? t('courses.mappingPending') : t('courses.mappingSubmit')}
            </SubmitButton>
            <p className="text-ink-muted text-body max-w-[60ch]">{t('courses.mappingApplyNote')}</p>
          </div>
        )}
      </div>
    </form>
  )
}
