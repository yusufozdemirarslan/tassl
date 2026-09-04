'use client'

import { useState } from 'react'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { boolean, maxLength, minLength, object, refine, string, trim, type output } from 'zod/mini'
import { LockIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormAlert, SubmitButton } from '@/components/features/account/form-feedback'
import { EmptyState } from '@/components/layout/empty-state'
import { LabelChip } from '@/components/layout/label-chip'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { t } from '@/lib/i18n/t'
import { createAssignmentAction, updateAssignmentAction } from '@/server/modules/courses/actions'
import type { AssignmentVariantOption, PackageVersionOption } from './package-version-option'

// UI-032's configuration form, used twice: the course detail's "New assignment" (step 4.2 renders
// it with a `sectionId`) and this assignment's own screen (`assignment`). Both write through the
// courses actions, so the rules — a confirmed version, a variant of that version, a clock of at
// least 60 seconds — are the service's, not this file's; the bounds restated here only tell the
// person sooner (D-186: a client component never imports the module's schema).
//
// `assignment_configured` is emitted by the service on both writes (17 §3.1), so this component
// fires no analytics of its own.
//
// Once a run that is not voided exists (`AssignmentView.inUse`) the setup is what that run was
// taken under: the package version, the variant, the clock, and the weight are disabled and the
// patch omits them entirely, because `updateAssignment` refuses a structural *key*, not a changed
// value (`ASSIGNMENT_IN_USE`). Name, walkthrough, and opening time stay open.

// The option shape is shared with the screens that build it (./package-version-option); it is
// re-exported here because this is where its consumers already look for it.
export type { AssignmentVariantOption, PackageVersionOption }

/** What the form needs of an existing assignment (`AssignmentView`, minus what it does not edit). */
export type EditableAssignment = {
  id: string
  label: string
  packageVersionId: string
  variantId: string
  workingClockSeconds: number | null
  weight: number | null
  isWalkthrough: boolean
  opensAt: string | null
  inUse: boolean
}

type AssignmentFormProps = {
  packageVersions: readonly PackageVersionOption[]
  /** The course's default run weight, shown under the weight field. */
  courseDefaultWeight: number
} & (
  | { sectionId: string; assignment?: undefined }
  | { sectionId?: undefined; assignment: EditableAssignment }
)

/** One version as the closed trigger and the open list both show it: its name, then its state. */
function VersionOption({ version }: { version: PackageVersionOption }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {t('assignment.packageOption', { title: version.title, version: version.version })}
      {version.calibrationStatus === 'uncalibrated' && <LabelChip kind="uncalibrated" />}
    </span>
  )
}

const VARIANT_LABELS: Record<AssignmentVariantOption['key'], string> = {
  defective: t('assignment.variantDefective'),
  sound: t('assignment.variantSound'),
}

const VARIANT_HINTS: Record<AssignmentVariantOption['key'], string> = {
  defective: t('assignment.variantDefectiveHint'),
  sound: t('assignment.variantSoundHint'),
}

/** Empty (follow the package) or whole seconds of at least a minute (10 §3). */
function isWorkingClock(value: string): boolean {
  if (value === '') return true
  const seconds = Number(value)
  return Number.isInteger(seconds) && seconds >= 60
}

/** Empty (follow the course) or a finite weight of zero or more. */
function isWeight(value: string): boolean {
  if (value === '') return true
  const weight = Number(value)
  return Number.isFinite(weight) && weight >= 0
}

/** Empty (open now) or a datetime-local value the browser can hand back. */
function isOpensAt(value: string): boolean {
  return value === '' || !Number.isNaN(Date.parse(toIsoUtc(value)))
}

/**
 * The datetime-local field reads and writes UTC wall time, the one zone this product formats in
 * (D-177), so a server render and its hydration always agree and nobody is shown a time whose zone
 * is unstated. The hint under the field says so.
 */
function toIsoUtc(value: string): string {
  return value.length === 16 ? `${value}:00Z` : `${value}Z`
}

function toLocalField(iso: string | null): string {
  return iso === null ? '' : iso.slice(0, 16)
}

const assignmentSchema = object({
  label: string().check(
    trim(),
    minLength(1, { error: t('assignment.validation.label') }),
    maxLength(200, { error: t('assignment.validation.labelTooLong') }),
  ),
  packageVersionId: string().check(minLength(1, { error: t('assignment.validation.package') })),
  variantId: string().check(minLength(1, { error: t('assignment.validation.variant') })),
  workingClockSeconds: string().check(
    refine(isWorkingClock, { error: t('assignment.validation.clock') }),
  ),
  weight: string().check(refine(isWeight, { error: t('assignment.validation.weight') })),
  isWalkthrough: boolean(),
  opensAt: string().check(refine(isOpensAt, { error: t('assignment.validation.opensAt') })),
})

type AssignmentValues = output<typeof assignmentSchema>

export function AssignmentForm({
  packageVersions,
  courseDefaultWeight,
  sectionId,
  assignment,
}: AssignmentFormProps) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const locked = assignment?.inUse === true

  const first = packageVersions[0]
  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AssignmentValues>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: assignment
      ? {
          label: assignment.label,
          packageVersionId: assignment.packageVersionId,
          variantId: assignment.variantId,
          workingClockSeconds:
            assignment.workingClockSeconds === null ? '' : String(assignment.workingClockSeconds),
          weight: assignment.weight === null ? '' : String(assignment.weight),
          isWalkthrough: assignment.isWalkthrough,
          opensAt: toLocalField(assignment.opensAt),
        }
      : {
          label: '',
          packageVersionId: first?.id ?? '',
          variantId: first?.variants[0]?.id ?? '',
          workingClockSeconds: '',
          weight: '',
          isWalkthrough: false,
          opensAt: '',
        },
  })

  // `useWatch` rather than the form's `watch()`: the subscription is a hook the compiler can
  // reason about, and only this field's changes re-render the form.
  const selectedVersionId = useWatch({ control, name: 'packageVersionId' })
  const selectedVersion =
    packageVersions.find((version) => version.id === selectedVersionId) ?? first

  // The one state the form cannot be in: an institution with no confirmed package version. It is
  // where every institution starts, so it is a state, not an error (the fixture package is Phase 5).
  if (packageVersions.length === 0 || selectedVersion === undefined) {
    return (
      <EmptyState
        headingLevel={3}
        title={t('assignment.noPackagesTitle')}
        body={t('assignment.noPackagesBody')}
      />
    )
  }

  const versionItems = packageVersions.map((version) => ({
    value: version.id,
    label: t('assignment.packageOption', { title: version.title, version: version.version }),
  }))

  async function onSubmit(values: AssignmentValues): Promise<void> {
    setFormError(null)
    const opensAt = values.opensAt === '' ? null : new Date(toIsoUtc(values.opensAt)).toISOString()
    // Structural keys are omitted while a run exists: `updateAssignment` refuses their presence.
    const structural = locked
      ? {}
      : {
          packageVersionId: values.packageVersionId,
          variantId: values.variantId,
          workingClockSeconds:
            values.workingClockSeconds === '' ? null : Number(values.workingClockSeconds),
          weight: values.weight === '' ? null : Number(values.weight),
        }

    if (assignment) {
      const result = await updateAssignmentAction({
        assignmentId: assignment.id,
        label: values.label,
        isWalkthrough: values.isWalkthrough,
        opensAt,
        ...structural,
      })
      if (!result.ok) {
        setFormError(result.error.message)
        return
      }
      reset(values)
      toast.success(t('assignment.saved'))
      router.refresh()
      return
    }

    const result = await createAssignmentAction({
      sectionId,
      label: values.label,
      isWalkthrough: values.isWalkthrough,
      opensAt,
      ...structural,
    })
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    toast.success(t('assignment.created', { label: result.data.label }))
    router.push(`/assignments/${result.data.id}` as Route)
    router.refresh()
  }

  const lockedNoteId = 'assignment-locked'
  /** Every disabled control points at the note that says why, alongside its own hint or error. */
  const describedBy = (...ids: (string | false | null)[]): string =>
    ids.filter((id): id is string => typeof id === 'string').join(' ')

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
      <div className="flex max-w-[64ch] flex-col gap-5">
        <Field data-invalid={errors.label ? 'true' : undefined}>
          <FieldLabel htmlFor="assignment-label">{t('assignment.labelLabel')}</FieldLabel>
          <Input
            id="assignment-label"
            aria-invalid={errors.label ? true : undefined}
            // The hint says what the field is for; the error says what is wrong with this value.
            // A reader who hears only the second is told to fix something they were never told.
            aria-describedby={describedBy(
              'assignment-label-hint',
              Boolean(errors.label) && 'assignment-label-error',
            )}
            {...register('label')}
          />
          <FieldDescription id="assignment-label-hint">
            {t('assignment.labelHint')}
          </FieldDescription>
          <FieldError id="assignment-label-error">{errors.label?.message}</FieldError>
        </Field>

        {locked && (
          <div
            id={lockedNoteId}
            className="border-line bg-paper-sunken text-ink text-body flex items-start gap-2 rounded-md border p-3"
          >
            <LockIcon aria-hidden="true" className="text-ink-muted mt-0.5 size-4 shrink-0" />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-medium">{t('assignment.lockedTitle')}</p>
              <p className="max-w-[60ch]">{t('assignment.lockedBody')}</p>
            </div>
          </div>
        )}

        <Field data-invalid={errors.packageVersionId ? 'true' : undefined}>
          <FieldLabel htmlFor="assignment-package">{t('assignment.packageLabel')}</FieldLabel>
          <Controller
            control={control}
            name="packageVersionId"
            render={({ field }) => (
              <Select
                items={versionItems}
                value={field.value}
                disabled={locked}
                onValueChange={(value: string | null) => {
                  // Base UI can report an empty selection; the field then holds '' and the schema
                  // asks for a version rather than the form silently keeping the old one.
                  field.onChange(value ?? '')
                  const next = packageVersions.find((version) => version.id === value)
                  setValue('variantId', next?.variants[0]?.id ?? '', { shouldValidate: true })
                }}
              >
                <SelectTrigger
                  id="assignment-package"
                  className="w-full"
                  disabled={locked}
                  aria-describedby={describedBy('assignment-package-hint', locked && lockedNoteId)}
                >
                  {/* The closed trigger says what the open list says, chip included: a version's
                      calibration state is part of what it is, not a detail of the menu. */}
                  <SelectValue>
                    {(value: unknown) => {
                      const chosen = packageVersions.find((version) => version.id === value)
                      return chosen ? <VersionOption version={chosen} /> : null
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {packageVersions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      <VersionOption version={version} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription id="assignment-package-hint">
            {t('assignment.packageHint')}
          </FieldDescription>
          <FieldError id="assignment-package-error">{errors.packageVersionId?.message}</FieldError>
        </Field>

        <FieldSet data-invalid={errors.variantId ? 'true' : undefined}>
          <FieldLegend variant="label">{t('assignment.variantLegend')}</FieldLegend>
          <Controller
            control={control}
            name="variantId"
            render={({ field }) => (
              <RadioGroup
                aria-label={t('assignment.variantLegend')}
                value={field.value}
                disabled={locked}
                onValueChange={(value: unknown) => field.onChange(String(value))}
              >
                {selectedVersion.variants.map((variant) => (
                  <Field key={variant.id} orientation="horizontal">
                    <RadioGroupItem
                      id={`assignment-variant-${variant.key}`}
                      value={variant.id}
                      disabled={locked}
                      aria-labelledby={`assignment-variant-${variant.key}-label`}
                      aria-describedby={describedBy(
                        `assignment-variant-${variant.key}-hint`,
                        locked && lockedNoteId,
                      )}
                    />
                    <FieldContent>
                      <FieldLabel
                        id={`assignment-variant-${variant.key}-label`}
                        htmlFor={`assignment-variant-${variant.key}`}
                      >
                        {VARIANT_LABELS[variant.key]}
                      </FieldLabel>
                      <FieldDescription id={`assignment-variant-${variant.key}-hint`}>
                        {VARIANT_HINTS[variant.key]}
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                ))}
              </RadioGroup>
            )}
          />
          <FieldError id="assignment-variant-error">{errors.variantId?.message}</FieldError>
        </FieldSet>

        <Field data-invalid={errors.workingClockSeconds ? 'true' : undefined}>
          <FieldLabel htmlFor="assignment-clock">{t('assignment.clockLabel')}</FieldLabel>
          <Input
            id="assignment-clock"
            type="number"
            inputMode="numeric"
            min={60}
            step={1}
            className="font-mono tabular-nums"
            disabled={locked}
            aria-invalid={errors.workingClockSeconds ? true : undefined}
            aria-describedby={describedBy(
              errors.workingClockSeconds ? 'assignment-clock-error' : 'assignment-clock-hint',
              locked && lockedNoteId,
            )}
            {...register('workingClockSeconds')}
          />
          <FieldDescription id="assignment-clock-hint">
            {selectedVersion.defaultWorkingClockSeconds === null
              ? t('assignment.clockHint')
              : t('assignment.clockDefault', {
                  seconds: selectedVersion.defaultWorkingClockSeconds,
                })}
          </FieldDescription>
          <FieldError id="assignment-clock-error">{errors.workingClockSeconds?.message}</FieldError>
        </Field>

        <Field data-invalid={errors.weight ? 'true' : undefined}>
          <FieldLabel htmlFor="assignment-weight">{t('assignment.weightLabel')}</FieldLabel>
          <Input
            id="assignment-weight"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            className="font-mono tabular-nums"
            disabled={locked}
            aria-invalid={errors.weight ? true : undefined}
            aria-describedby={describedBy(
              errors.weight ? 'assignment-weight-error' : 'assignment-weight-hint',
              locked && lockedNoteId,
            )}
            {...register('weight')}
          />
          <FieldDescription id="assignment-weight-hint">
            {t('assignment.weightDefault', { weight: courseDefaultWeight })}
          </FieldDescription>
          <FieldError id="assignment-weight-error">{errors.weight?.message}</FieldError>
        </Field>

        <Field orientation="horizontal">
          <Controller
            control={control}
            name="isWalkthrough"
            render={({ field }) => (
              <Switch
                id="assignment-walkthrough"
                checked={field.value}
                aria-labelledby="assignment-walkthrough-label"
                aria-describedby="assignment-walkthrough-hint"
                onCheckedChange={(checked: boolean) => field.onChange(checked)}
              />
            )}
          />
          <FieldContent>
            <FieldLabel id="assignment-walkthrough-label" htmlFor="assignment-walkthrough">
              {t('assignment.walkthroughLabel')}
            </FieldLabel>
            <FieldDescription id="assignment-walkthrough-hint">
              {t('assignment.walkthroughHint')}
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field data-invalid={errors.opensAt ? 'true' : undefined}>
          <FieldLabel htmlFor="assignment-opens-at">{t('assignment.opensAtLabel')}</FieldLabel>
          <Input
            id="assignment-opens-at"
            type="datetime-local"
            className="font-mono tabular-nums"
            aria-invalid={errors.opensAt ? true : undefined}
            aria-describedby={
              errors.opensAt ? 'assignment-opens-at-error' : 'assignment-opens-at-hint'
            }
            {...register('opensAt')}
          />
          <FieldDescription id="assignment-opens-at-hint">
            {t('assignment.opensAtHint')}
          </FieldDescription>
          <FieldError id="assignment-opens-at-error">{errors.opensAt?.message}</FieldError>
        </Field>

        <FormAlert message={formError} />

        <SubmitButton pending={isSubmitting}>
          {assignment ? t('assignment.saveSubmit') : t('assignment.createSubmit')}
        </SubmitButton>
      </div>
    </form>
  )
}
