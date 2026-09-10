'use client'

import { useId, useState, useTransition } from 'react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { t as bandT } from '@/lib/i18n/messages/band'
import { t } from '@/lib/i18n/messages/review'
import { toastSuccess } from '@/lib/toast'
import { bandHeldRunManuallyAction } from '@/server/modules/review/actions'
import { useRefresh } from '@/lib/hooks/use-refresh'

// UI-033 → the held-run form (FR-140, FR-004), shown only when `capabilities.canBandManually`.
//
// **All seven, or none.** A held run has no draft to fall back on for the dimensions the reviewer
// skipped, so a partial hand-banding would leave a run in `scored` with dimensions holding neither
// a band nor a reason — exactly the state FR-004 forbids. The form therefore refuses locally with
// the sentence rather than sending six and letting the service answer for the seventh.
//
// Nothing opens selected. There is no draft here — that is what "held" means — so a pre-selected
// option would be the screen guessing at a band for a run the pipeline could not read, which is the
// one thing a hand-banding must not do.

const DIMENSIONS = [
  { key: 'framing', label: () => bandT('band.dimension.framing') },
  { key: 'delegation', label: () => bandT('band.dimension.delegation') },
  { key: 'verification', label: () => bandT('band.dimension.verification') },
  { key: 'calibration', label: () => bandT('band.dimension.calibration') },
  { key: 'decision_quality', label: () => bandT('band.dimension.decision_quality') },
  { key: 'adaptation', label: () => bandT('band.dimension.adaptation') },
  { key: 'ownership', label: () => bandT('band.dimension.ownership') },
] as const

const OPTIONS = [
  { value: 'novice', label: () => bandT('band.novice') },
  { value: 'developing', label: () => bandT('band.developing') },
  { value: 'proficient', label: () => bandT('band.proficient') },
  { value: 'professional', label: () => bandT('band.professional') },
  { value: 'unassessed', label: () => t('review.decisionOptionUnassessed') },
] as const

type DimensionKey = (typeof DIMENSIONS)[number]['key']
type OptionValue = (typeof OPTIONS)[number]['value']

export type ManualBandsFormProps = { runId: string }

export function ManualBandsForm({ runId }: ManualBandsFormProps) {
  const refresh = useRefresh()
  const fieldId = useId()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [bands, setBands] = useState<Partial<Record<DimensionKey, OptionValue>>>({})

  return (
    <div className="flex flex-col gap-5">
      <p className="text-ink text-reading max-w-measure">{t('review.manualDescription')}</p>

      {DIMENSIONS.map((dimension) => {
        const legendId = `${fieldId}-${dimension.key}-legend`
        return (
          <div
            key={dimension.key}
            role="group"
            aria-labelledby={legendId}
            className="border-line flex flex-col gap-3 border-t pt-4"
          >
            <p id={legendId} className="text-ink text-body font-semibold">
              {dimension.label()}
            </p>
            <RadioGroup
              value={bands[dimension.key] ?? ''}
              onValueChange={(value) => {
                setBands((current) => ({ ...current, [dimension.key]: value as OptionValue }))
                setError(null)
              }}
              aria-labelledby={legendId}
              // `lg:gap-4`: the radio's hit area reaches 12 px past the control on each side, so
              // an 8 px gap lets one option's target overlap its neighbour's label.
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4"
            >
              {OPTIONS.map((option) => {
                const id = `${fieldId}-${dimension.key}-${option.value}`
                const labelId = `${id}-label`
                return (
                  <Field key={option.value} orientation="horizontal" className="min-h-10">
                    <RadioGroupItem id={id} value={option.value} aria-labelledby={labelId} />
                    <FieldLabel id={labelId} htmlFor={id} className="text-body font-normal">
                      {option.label()}
                    </FieldLabel>
                  </Field>
                )
              })}
            </RadioGroup>
          </div>
        )
      })}

      <FormAlert message={error} />

      <Button
        type="button"
        aria-disabled={pending ? true : undefined}
        aria-busy={pending}
        className="w-fit"
        onClick={() => {
          if (pending) return
          // The refusal names them. On a form of thirty-five radios, "one of the seven is
          // missing" is a sentence that sends the reader back to the top to count.
          const missing = DIMENSIONS.filter((dimension) => bands[dimension.key] === undefined)
          if (missing.length > 0) {
            setError(
              t('review.manualIncompleteNamed', {
                dimensions: missing.map((dimension) => dimension.label()).join(', '),
              }),
            )
            return
          }
          setError(null)
          startTransition(async () => {
            const result = await bandHeldRunManuallyAction({
              runId,
              bands: bands as Record<DimensionKey, OptionValue>,
            })
            if (!result.ok) {
              setError(result.error.message)
              return
            }
            toastSuccess(t('review.manualDone'))
            refresh()
            // The whole panel goes when the run leaves `held`, taking the focused control with it.
            document.getElementById('page-title')?.focus()
          })
        }}
      >
        {pending ? t('review.manualPending') : t('review.manualSubmit')}
      </Button>
    </div>
  )
}
