'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { enum as enumOf, object, refine, string, type output } from 'zod/mini'
import { toast } from 'sonner'
import { FormAlert, SubmitButton } from '@/components/features/account/form-feedback'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/lib/i18n/t'
import { updateCoursePolicyAction } from '@/server/modules/courses/actions'

// UI-030 → Policy (FR-205, PRD §7.19). Three things a course decides about every run under it:
//
//   the outside-AI policy — Open, Declared, In-Environment Only, each with the plain-language
//     sentence the instructor is choosing between. Tassl displays the policy at run start (FR-201)
//     and never enforces it: it does not detect, infer, or estimate undeclared use, and a
//     declaration never lowers a band or a point (FR-062). The legend says so, because a policy
//     control that looks like an enforcement control is a lie about the product.
//   the default run weight — what one Decision Run is worth in the instructor's own gradebook.
//   the taught concepts — one per line; scenario matching reads them (PRD §7.18).
//
// The band mapping is the sibling sub-view (MappingEditor): it is the one field of this action that
// a confirmed run freezes, so it is saved on its own and refused on its own.

const OUTSIDE_AI_POLICIES = ['open', 'declared', 'in_environment_only'] as const
type OutsideAiPolicy = (typeof OUTSIDE_AI_POLICIES)[number]

const CONCEPT_MAX_LENGTH = 120
const CONCEPT_MAX_COUNT = 50

/** A weight is a non-negative finite number; zero is a course that grades no run from Tassl. */
const NUMBER_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)$/
const looksNumeric = (value: string): boolean => NUMBER_PATTERN.test(value.trim())

/** One concept per line; blank lines are not concepts. */
export function parseConcepts(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

const policySchema = object({
  outsideAiPolicy: enumOf(OUTSIDE_AI_POLICIES),
  defaultRunWeight: string().check(
    refine((value: string) => looksNumeric(value), { error: t('courses.validation.weight') }),
    refine((value: string) => !looksNumeric(value) || Number(value) >= 0, {
      error: t('courses.validation.weightNegative'),
    }),
  ),
  taughtConcepts: string().check(
    refine((value: string) => parseConcepts(value).length <= CONCEPT_MAX_COUNT, {
      error: t('courses.validation.conceptsTooMany'),
    }),
    refine(
      (value: string) =>
        parseConcepts(value).every((concept) => concept.length <= CONCEPT_MAX_LENGTH),
      { error: t('courses.validation.concept') },
    ),
  ),
})

type PolicyValues = output<typeof policySchema>

const POLICY_OPTIONS = [
  {
    value: 'open',
    label: t('courses.policyOpen'),
    description: t('courses.policyOpenDescription'),
  },
  {
    value: 'declared',
    label: t('courses.policyDeclared'),
    description: t('courses.policyDeclaredDescription'),
  },
  {
    value: 'in_environment_only',
    label: t('courses.policyInEnvironment'),
    description: t('courses.policyInEnvironmentDescription'),
  },
] as const satisfies ReadonlyArray<{ value: OutsideAiPolicy; label: string; description: string }>

export type PolicyFormProps = {
  courseId: string
  outsideAiPolicy: OutsideAiPolicy
  defaultRunWeight: number
  taughtConcepts: readonly string[]
  /** True for a reader who may see the course but not change it (a program lead, a student). */
  readOnly?: boolean
}

export function PolicyForm({
  courseId,
  outsideAiPolicy,
  defaultRunWeight,
  taughtConcepts,
  readOnly = false,
}: PolicyFormProps) {
  const router = useRouter()
  const fieldId = useId()
  const [formError, setFormError] = useState<string | null>(null)

  const defaults: PolicyValues = {
    outsideAiPolicy,
    defaultRunWeight: String(defaultRunWeight),
    taughtConcepts: taughtConcepts.join('\n'),
  }

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PolicyValues>({ resolver: zodResolver(policySchema), defaultValues: defaults })

  const legendId = `${fieldId}-policy-legend`
  const legendNoteId = `${fieldId}-policy-note`
  const weightId = `${fieldId}-weight`
  const conceptsId = `${fieldId}-concepts`

  async function onSubmit(values: PolicyValues): Promise<void> {
    setFormError(null)
    const result = await updateCoursePolicyAction({
      courseId,
      outsideAiPolicy: values.outsideAiPolicy,
      defaultRunWeight: Number(values.defaultRunWeight),
      taughtConcepts: parseConcepts(values.taughtConcepts),
    })
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    reset({
      outsideAiPolicy: result.data.outsideAiPolicy,
      defaultRunWeight: String(result.data.defaultRunWeight),
      taughtConcepts: result.data.taughtConcepts.join('\n'),
    })
    toast.success(t('courses.policySaved'))
    router.refresh()
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
      <div className="flex flex-col gap-6">
        <FieldSet>
          <FieldLegend id={legendId} variant="label">
            {t('courses.policyLegend')}
          </FieldLegend>
          <FieldDescription id={legendNoteId}>{t('courses.policyNotEnforced')}</FieldDescription>
          <Controller
            control={control}
            name="outsideAiPolicy"
            render={({ field }) => (
              <RadioGroup
                name={field.name}
                value={field.value}
                disabled={readOnly}
                aria-labelledby={legendId}
                aria-describedby={legendNoteId}
                onValueChange={(next) => field.onChange(next as OutsideAiPolicy)}
                className="max-w-[72ch]"
              >
                {POLICY_OPTIONS.map((option) => {
                  const itemId = `${fieldId}-${option.value}`
                  return (
                    <FieldLabel key={option.value} htmlFor={itemId}>
                      <Field orientation="horizontal">
                        <RadioGroupItem
                          id={itemId}
                          value={option.value}
                          aria-labelledby={`${itemId}-title`}
                          aria-describedby={`${itemId}-description`}
                        />
                        <FieldContent>
                          <FieldTitle id={`${itemId}-title`}>{option.label}</FieldTitle>
                          <FieldDescription id={`${itemId}-description`}>
                            {option.description}
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldLabel>
                  )
                })}
              </RadioGroup>
            )}
          />
        </FieldSet>

        <Field className="max-w-[32ch]" data-invalid={errors.defaultRunWeight ? 'true' : undefined}>
          <FieldLabel htmlFor={weightId}>{t('courses.weightLabel')}</FieldLabel>
          <Input
            id={weightId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className="font-mono"
            disabled={readOnly}
            aria-invalid={errors.defaultRunWeight ? true : undefined}
            aria-describedby={
              errors.defaultRunWeight ? `${weightId}-error ${weightId}-hint` : `${weightId}-hint`
            }
            {...register('defaultRunWeight')}
          />
          <FieldError id={`${weightId}-error`}>{errors.defaultRunWeight?.message}</FieldError>
          <FieldDescription id={`${weightId}-hint`}>
            {t('courses.weightDescription')}
          </FieldDescription>
        </Field>

        <Field className="max-w-[72ch]" data-invalid={errors.taughtConcepts ? 'true' : undefined}>
          <FieldLabel htmlFor={conceptsId}>{t('courses.conceptsLabel')}</FieldLabel>
          <Textarea
            id={conceptsId}
            rows={5}
            disabled={readOnly}
            aria-invalid={errors.taughtConcepts ? true : undefined}
            aria-describedby={
              errors.taughtConcepts
                ? `${conceptsId}-error ${conceptsId}-hint`
                : `${conceptsId}-hint`
            }
            {...register('taughtConcepts')}
          />
          <FieldError id={`${conceptsId}-error`}>{errors.taughtConcepts?.message}</FieldError>
          <FieldDescription id={`${conceptsId}-hint`}>
            {t('courses.conceptsDescription')}
          </FieldDescription>
        </Field>

        <FormAlert message={formError} />

        {readOnly ? (
          <p className="text-ink-muted text-body max-w-[60ch]">{t('courses.readOnlyNote')}</p>
        ) : (
          <SubmitButton pending={isSubmitting}>
            {isSubmitting ? t('courses.policyPending') : t('courses.policySubmit')}
          </SubmitButton>
        )}
      </div>
    </form>
  )
}
