'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlertIcon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/lib/i18n/messages/review'
import { toastSuccess } from '@/lib/toast'
import { voidRunAction } from '@/server/modules/review/actions'

// UI-033 → `VoidDialog` (FR-002, FR-008, FR-183, D-120).
//
// A void is the one act on this screen that cannot be taken back, so it is asked for in a dialog
// and it is asked for in two parts: the enum an analytics query can group by, and the sentence the
// instructor actually wants to write. D-120 is exactly that split — `runs.void_reason` holds one of
// four values and the note goes to the `run_voided` event, where the replay reads it and no
// aggregate does.
//
// **A re-offer runs the other variant of the family by default** (FR-183). The select is an
// override, not a requirement: an instructor voiding a run because the material misbehaved should
// not have to know which variant the student drew in order to give them another go.
//
// The controls here are ink on a control hairline, with the destructive fill on the one press that
// voids. The screen's teal belongs to the band decision (DESIGN.md: one accent, on the act the
// visitor came to take), and a destructive control that shouted would be the loudest thing on a
// screen whose purpose is to confirm seven bands.

const REASONS = [
  { value: 'unscoreable', label: () => t('review.voidReason.unscoreable') },
  { value: 'scoring_held', label: () => t('review.voidReason.held') },
  { value: 'walkthrough', label: () => t('review.voidReason.walkthrough') },
  { value: 'other', label: () => t('review.voidReason.other') },
] as const

export type VoidDialogProps = {
  runId: string
  /** The two variants of this package family, so the re-offer can name one. */
  variants: readonly { id: string; key: 'defective' | 'sound' }[]
  /**
   * True when a course export already names this run. Voiding withdraws that figure, and an
   * instructor who has already entered it in the gradebook of record has to take it back out —
   * which the dialog says here, at the press, rather than in the banner afterwards.
   */
  exported: boolean
}

const VARIANT_LABELS: Record<'defective' | 'sound', () => string> = {
  defective: () => t('review.voidVariantDefective'),
  sound: () => t('review.voidVariantSound'),
}

export function VoidDialog({ runId, variants, exported }: VoidDialogProps) {
  const router = useRouter()
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<(typeof REASONS)[number]['value']>('unscoreable')
  const [note, setNote] = useState('')
  const [reoffer, setReoffer] = useState(false)
  const [variantId, setVariantId] = useState('')

  const reasonLegendId = `${fieldId}-reason`
  const noteId = `${fieldId}-note`
  const noteHintId = `${fieldId}-note-hint`
  const reofferId = `${fieldId}-reoffer`
  const reofferLabelId = `${fieldId}-reoffer-label`
  const reofferHintId = `${fieldId}-reoffer-hint`
  const variantSelectId = `${fieldId}-variant`

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setOpen(true)
        }}
      >
        {t('review.voidOpen')}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && pending) return
          setOpen(next)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('review.voidDialogTitle')}</DialogTitle>
            <DialogDescription>{t('review.voidDialogBody')}</DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex flex-col gap-5">
            {exported && (
              <p className="border-amber bg-amber-soft text-ink text-body max-w-measure flex items-start gap-2 rounded-md border p-3">
                <TriangleAlertIcon
                  aria-hidden="true"
                  className="text-amber mt-0.5 size-4 shrink-0"
                />
                <span>{t('review.voidExportedWarning')}</span>
              </p>
            )}

            <div role="group" aria-labelledby={reasonLegendId} className="flex flex-col gap-3">
              <p id={reasonLegendId} className="text-ink text-meta font-medium">
                {t('review.voidReasonLegend')}
              </p>
              <RadioGroup
                value={reason}
                onValueChange={(value) => {
                  setReason(value as (typeof REASONS)[number]['value'])
                }}
                aria-labelledby={reasonLegendId}
              >
                {REASONS.map((option) => {
                  const id = `${fieldId}-${option.value}`
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

            <Field>
              <FieldLabel htmlFor={noteId}>{t('review.voidNoteLabel')}</FieldLabel>
              <Textarea
                id={noteId}
                rows={3}
                value={note}
                aria-describedby={noteHintId}
                onChange={(event) => {
                  setNote(event.target.value)
                }}
              />
              <p id={noteHintId} className="text-ink-muted text-meta max-w-measure">
                {t('review.voidNoteHint')}
              </p>
            </Field>

            <div className="flex flex-col gap-3">
              <Field orientation="horizontal" className="min-h-10">
                <Checkbox
                  id={reofferId}
                  checked={reoffer}
                  aria-labelledby={reofferLabelId}
                  aria-describedby={reofferHintId}
                  onCheckedChange={(next) => {
                    setReoffer(next === true)
                  }}
                />
                <FieldLabel
                  id={reofferLabelId}
                  htmlFor={reofferId}
                  className="text-body font-normal"
                >
                  {t('review.voidReoffer')}
                </FieldLabel>
              </Field>
              <p id={reofferHintId} className="text-ink-muted text-meta max-w-measure">
                {t('review.voidReofferHint')}
              </p>

              {reoffer && variants.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label htmlFor={variantSelectId} className="text-ink text-meta font-medium">
                    {t('review.voidVariantLabel')}
                  </label>
                  <select
                    id={variantSelectId}
                    value={variantId}
                    onChange={(event) => {
                      setVariantId(event.target.value)
                    }}
                    className="border-line-control bg-paper-raised text-ink text-body focus-visible:outline-focus h-10 w-full max-w-72 rounded-md border px-3 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <option value="">{t('review.voidVariantAuto')}</option>
                    {variants.map((variant) => (
                      <option key={variant.id} value={variant.id}>
                        {VARIANT_LABELS[variant.key]()}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <FormAlert message={error} />
          </div>

          <DialogFooter className="mt-6">
            {/* `aria-disabled`, never `disabled`: a disabled control is blurred by the browser,
                which drops a keyboard user out of the dialog while the request is in flight. */}
            <DialogClose
              render={<Button variant="secondary" aria-disabled={pending ? true : undefined} />}
            >
              {t('review.voidCancel')}
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              aria-disabled={pending ? true : undefined}
              aria-busy={pending}
              onClick={() => {
                if (pending) return
                setError(null)
                startTransition(async () => {
                  const trimmed = note.trim()
                  const result = await voidRunAction({
                    runId,
                    reason,
                    reoffer,
                    ...(trimmed.length > 0 ? { note: trimmed } : {}),
                    ...(reoffer && variantId.length > 0 ? { variantId } : {}),
                  })
                  if (!result.ok) {
                    setError(result.error.message)
                    return
                  }
                  toastSuccess(
                    result.data.reoffered === null
                      ? t('review.voidDone')
                      : t('review.voidDoneWithReoffer'),
                  )
                  setOpen(false)
                  router.refresh()
                })
              }}
            >
              {pending ? t('review.voidPending') : t('review.voidConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
