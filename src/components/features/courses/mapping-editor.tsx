'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { object, refine, string, type output } from 'zod/mini'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormAlert, SubmitButton } from '@/components/features/account/form-feedback'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldContent, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { t } from '@/lib/i18n/messages/courses'
import { changeMappingAction, previewMappingChangeAction } from '@/server/modules/courses/actions'

// UI-030 → Mapping, in the two steps FR-206 takes it in (PRD §7.19, D-095).
//
// The four numbers a confirmed band is worth in this course: four positive, finite numbers, which
// `MappingSchema` states server-side and this form restates with zod/mini so the person is told
// before the round trip (D-186 — a client component never imports a module's schema.ts, so the
// bound is written out here rather than shared).
//
// **Preview, then apply, and never one without the other** (D-472). PRD §7.19's edge says what has
// to happen when a course changes what a band is worth after runs have been confirmed: the
// instructor is shown which exported points will change, the change is recorded as instructor-set
// with its date, and every confirmed run is recomputed and re-exported. So the first control writes
// nothing — it is the question "what would this do" — and the second is refused by the service
// without `confirm: true`, which is the box beside it. The bands do not move: a mapping change is
// the course changing what a band is worth, not Tassl changing what the run recorded.
//
// **A preview belongs to the numbers it was taken of.** Editing any of the four after a preview
// clears it, because an Apply that shipped numbers the table was not about would be the one failure
// mode this screen exists to prevent.
//
// There is no separate "Save mapping": `changeMapping` is the one path, and it is correct on a
// course with no confirmed run too — the preview is empty, nothing is re-exported, and the mapping
// is set for the runs that follow. Two controls for one act would be two chances to pick the wrong
// one.

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

type Mapping = { novice: number; developing: number; proficient: number; professional: number }

/** One row of `MappingChangePreview.affected`, restated (a client component takes no schema.ts). */
type PreviewRow = {
  runId: string
  assignmentId: string
  assignmentLabel: string
  studentId: string
  pointsNow: number | null
  pointsAfter: number | null
  changed: boolean
}

type Preview = {
  /** The four numbers this preview was taken of, so a later edit can invalidate it. */
  of: Mapping
  affected: readonly PreviewRow[]
  changedCount: number
}

export type MappingEditorProps = {
  courseId: string
  /** The course's current mapping; the same four keys the service reads and writes. */
  mapping: Mapping
  /** True for a reader who may see the course but not change it (a program lead, a student). */
  readOnly?: boolean
}

const toNumbers = (values: MappingValues): Mapping => ({
  novice: Number(values.novice),
  developing: Number(values.developing),
  proficient: Number(values.proficient),
  professional: Number(values.professional),
})

const sameMapping = (a: Mapping, b: Mapping): boolean =>
  a.novice === b.novice &&
  a.developing === b.developing &&
  a.proficient === b.proficient &&
  a.professional === b.professional

/** A run with no assessed dimension has no figure under either mapping (FR-202). */
const points = (value: number | null): string =>
  value === null ? t('courses.mappingPreviewNoPoints') : value.toFixed(3)

export function MappingEditor({ courseId, mapping, readOnly = false }: MappingEditorProps) {
  const router = useRouter()
  const fieldId = useId()
  const acknowledgeId = `${fieldId}-acknowledge`
  const [formError, setFormError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [applying, setApplying] = useState(false)
  const [needsAcknowledgement, setNeedsAcknowledgement] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    getValues,
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

  // A preview taken of numbers the form no longer holds is stale, and the Apply beside it would
  // ship the previewed pair rather than the typed one. Saying so is better than silently applying
  // either.
  const stale = preview !== null && !sameMapping(preview.of, toNumbers(getValues()))

  /** Any edit invalidates a preview: it was a picture of four different numbers. */
  function dropPreview(): void {
    if (preview !== null) setPreview(null)
    if (needsAcknowledgement) setNeedsAcknowledgement(false)
    setAcknowledged(false)
  }

  async function onPreview(values: MappingValues): Promise<void> {
    setFormError(null)
    const proposed = toNumbers(values)
    const result = await previewMappingChangeAction({ courseId, mapping: proposed })
    if (!result.ok) {
      // MAPPING_INVALID and FORBIDDEN both arrive here; the envelope message is the sentence,
      // verbatim, rather than a second wording of the rule.
      setFormError(result.error.message)
      return
    }
    setAcknowledged(false)
    setNeedsAcknowledgement(false)
    setPreview({
      of: proposed,
      affected: result.data.affected,
      changedCount: result.data.changedCount,
    })
  }

  function apply(): void {
    if (applying || preview === null || stale) return
    if (!acknowledged) {
      setNeedsAcknowledgement(true)
      return
    }
    setFormError(null)
    setApplying(true)
    const proposed = preview.of
    void changeMappingAction({ courseId, mapping: proposed, confirm: true }).then(
      (result) => {
        setApplying(false)
        if (!result.ok) {
          setFormError(result.error.message)
          return
        }
        toast.success(t('courses.mappingApplied', { changed: preview.changedCount }))
        setPreview(null)
        setAcknowledged(false)
        reset({
          novice: String(result.data.mapping.novice),
          developing: String(result.data.mapping.developing),
          proficient: String(result.data.mapping.proficient),
          professional: String(result.data.mapping.professional),
        })
        router.refresh()
      },
      () => {
        setApplying(false)
        setFormError(t('courses.mappingApplyNote'))
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <form noValidate onSubmit={(event) => void handleSubmit(onPreview)(event)}>
        <div className="flex flex-col gap-5">
          {/* Four numbers on one scale, so they are set side by side and each control is the width
              of the number it holds; the field around it keeps the room its label and its error
              need. */}
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
                    {...register(key, { onChange: dropPreview })}
                  />
                  <FieldError id={errorId}>{message}</FieldError>
                </Field>
              )
            })}
          </div>

          <FormAlert message={formError} />

          {readOnly ? (
            <p className="text-ink-muted text-body max-w-measure">{t('courses.readOnlyNote')}</p>
          ) : (
            <div className="flex flex-col items-start gap-2">
              <SubmitButton pending={isSubmitting}>
                {isSubmitting ? t('courses.mappingPending') : t('courses.mappingSubmit')}
              </SubmitButton>
              <p className="text-ink-muted text-body max-w-measure">
                {t('courses.mappingApplyNote')}
              </p>
            </div>
          )}
        </div>
      </form>

      {!readOnly && preview !== null && (
        <section
          aria-labelledby={`${fieldId}-preview-title`}
          className="border-line flex flex-col gap-4 border-t pt-6"
        >
          <h3 id={`${fieldId}-preview-title`} className="text-h4">
            {t('courses.mappingPreviewTitle')}
          </h3>

          {stale ? (
            <p className="border-amber bg-amber-soft text-ink text-body max-w-measure rounded-md border p-3">
              {t('courses.mappingPreviewStale')}
            </p>
          ) : sameMapping(preview.of, mapping) ? (
            <p className="text-ink text-body max-w-measure">{t('courses.mappingPreviewSame')}</p>
          ) : null}

          {preview.affected.length === 0 ? (
            <p className="text-ink text-body max-w-measure">{t('courses.mappingPreviewNone')}</p>
          ) : (
            <>
              <p className="text-ink text-body max-w-measure">
                {t('courses.mappingPreviewCount', {
                  changed: preview.changedCount,
                  total: preview.affected.length,
                })}
              </p>
              <div className="overflow-x-auto">
                <Table className="min-w-2xl">
                  <TableCaption>{t('courses.mappingPreviewCaption')}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">
                        {t('courses.mappingPreviewColumnAssignment')}
                      </TableHead>
                      <TableHead scope="col">{t('courses.mappingPreviewColumnNow')}</TableHead>
                      <TableHead scope="col">{t('courses.mappingPreviewColumnAfter')}</TableHead>
                      <TableHead scope="col">{t('courses.mappingPreviewColumnChange')}</TableHead>
                      <TableHead scope="col">{t('courses.mappingPreviewColumnRun')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.affected.map((row) => (
                      <TableRow key={row.runId}>
                        <TableCell className="whitespace-normal">{row.assignmentLabel}</TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {points(row.pointsNow)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {points(row.pointsAfter)}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {row.changed
                            ? t('courses.mappingPreviewChanged')
                            : t('courses.mappingPreviewUnchanged')}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/review/runs/${row.runId}` as Route}
                            className="text-primary text-meta focus-visible:outline-focus inline-flex min-h-10 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                          >
                            {t('courses.mappingPreviewOpenRun')}
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-ink-muted text-body max-w-measure">
                {t('courses.mappingPreviewSeatNote')}
              </p>
            </>
          )}

          <div className="flex flex-col items-start gap-3">
            <Field
              orientation="horizontal"
              data-invalid={needsAcknowledgement ? 'true' : undefined}
            >
              <Checkbox
                id={acknowledgeId}
                checked={acknowledged}
                aria-labelledby={`${acknowledgeId}-label`}
                aria-invalid={needsAcknowledgement ? true : undefined}
                aria-describedby={needsAcknowledgement ? `${acknowledgeId}-error` : undefined}
                onCheckedChange={(next: boolean) => {
                  setAcknowledged(next)
                  if (next) setNeedsAcknowledgement(false)
                }}
              />
              <FieldContent>
                <FieldLabel id={`${acknowledgeId}-label`} htmlFor={acknowledgeId}>
                  {t('courses.mappingAcknowledge')}
                </FieldLabel>
                {needsAcknowledgement && (
                  <FieldError id={`${acknowledgeId}-error`}>
                    {t('courses.mappingAcknowledgeRequired')}
                  </FieldError>
                )}
              </FieldContent>
            </Field>
            <Button
              type="button"
              onClick={apply}
              aria-disabled={applying || stale ? true : undefined}
              aria-busy={applying}
            >
              {applying && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
              {applying ? t('courses.mappingApplyPending') : t('courses.mappingApply')}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
