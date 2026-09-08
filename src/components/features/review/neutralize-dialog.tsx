'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
import { t as bandT } from '@/lib/i18n/messages/band'
import { t } from '@/lib/i18n/messages/review'
import { neutralizeClaimAction } from '@/server/modules/review/actions'

// UI-033 → `NeutralizeDialog` (FR-003, FR-005, FR-232, D-092): Tassl admitting its own error on one
// claim, and showing what that moved.
//
// **The recompute is shown in the dialog rather than toasted away.** A correction changes the
// stance matrix, re-reads Verification and Calibration, floors each at the band the run already
// stood on, re-prices the run and may write a new export version — and the instructor who pressed
// it is the only person who will ever see all five of those together. So the dialog does not close
// on success: it becomes the answer, dimension by dimension, with the two point totals and the
// export version under them.
//
// **The floor is stated where the correction is entered.** FR-005 is the rule an instructor is most
// likely to be uneasy about — "will this take points off a student because I admitted a mistake?" —
// and the sentence that answers it belongs in the dialog, not in a document.
//
// `creditChallenge` is D-092's checkbox and is required rather than defaulted: an instructor
// entering a correction has to say whether the student was right about the claim, and a silent
// `false` would answer for them. It is rendered unchecked, which is a starting position rather than
// an answer — the checkbox and its sentence are both on screen before the press that submits.

const REASONS = [
  { value: 'unintended_defect', label: () => t('review.neutralizeReason.unintendedDefect') },
  {
    value: 'wrong_verification_result',
    label: () => t('review.neutralizeReason.wrongVerification'),
  },
  { value: 'misbehaving_material', label: () => t('review.neutralizeReason.misbehavingMaterial') },
  { value: 'adaptation_failed', label: () => t('review.neutralizeReason.adaptation') },
  { value: 'record_lost', label: () => t('review.neutralizeReason.recordLost') },
  { value: 'other', label: () => t('review.neutralizeReason.other') },
] as const

type ReasonValue = (typeof REASONS)[number]['value']

type Dimension =
  | 'framing'
  | 'delegation'
  | 'verification'
  | 'calibration'
  | 'decision_quality'
  | 'adaptation'
  | 'ownership'

type BandValue = 'novice' | 'developing' | 'proficient' | 'professional'

type Recompute = {
  dimensions: Dimension[]
  bandsBefore: Partial<Record<Dimension, BandValue | null>>
  bandsAfter: Partial<Record<Dimension, BandValue | null>>
  bandsEffective: Partial<Record<Dimension, BandValue | null>>
  pointsBefore: number | null
  pointsAfter: number | null
  pointsEffective: number | null
}

export type NeutralizeDialogProps = {
  runId: string
  claimId: string
  /** The claim's authored key (`C3`), which is how a reviewer refers to it everywhere else. */
  claimKey: string
  /**
   * True once this claim carries a correction — one per claim per run
   * (`NEUTRALIZATION_EXISTS`).
   *
   * The *component* renders that state rather than the page swapping it out, and that is the whole
   * reason it is a prop. `neutralizeClaimAction` revalidates the replay, so the server tree
   * re-renders the moment the correction lands; a page that replaced this component with a
   * sentence at that point would unmount the open dialog with the recompute inside it and drop
   * focus to the document — taking away the five facts the instructor pressed the button to see,
   * at the instant they arrived.
   */
  alreadyCorrected: boolean
}

const DIMENSION_LABELS: Record<Dimension, () => string> = {
  framing: () => bandT('band.dimension.framing'),
  delegation: () => bandT('band.dimension.delegation'),
  verification: () => bandT('band.dimension.verification'),
  calibration: () => bandT('band.dimension.calibration'),
  decision_quality: () => bandT('band.dimension.decision_quality'),
  adaptation: () => bandT('band.dimension.adaptation'),
  ownership: () => bandT('band.dimension.ownership'),
}

const BAND_LABELS: Record<BandValue, () => string> = {
  novice: () => bandT('band.novice'),
  developing: () => bandT('band.developing'),
  proficient: () => bandT('band.proficient'),
  professional: () => bandT('band.professional'),
}

const bandName = (band: BandValue | null | undefined): string =>
  band === null || band === undefined ? bandT('band.unassessed') : BAND_LABELS[band]()

const number = (value: number | null): string => (value === null ? '—' : value.toFixed(3))

export function NeutralizeDialog({
  runId,
  claimId,
  claimKey,
  alreadyCorrected,
}: NeutralizeDialogProps) {
  const router = useRouter()
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<ReasonValue>('unintended_defect')
  const [credit, setCredit] = useState(false)
  const [note, setNote] = useState('')
  const [result, setResult] = useState<{
    recompute: Recompute
    exportVersion: number | null
  } | null>(null)

  const reasonLegendId = `${fieldId}-reason`
  const noteId = `${fieldId}-note`
  const creditId = `${fieldId}-credit`
  const creditLabelId = `${fieldId}-credit-label`
  const creditHintId = `${fieldId}-credit-hint`

  const moved =
    result === null
      ? []
      : result.recompute.dimensions.filter(
          (dimension) =>
            (result.recompute.bandsBefore[dimension] ?? null) !==
            (result.recompute.bandsEffective[dimension] ?? null),
        )

  return (
    <>
      {alreadyCorrected && result === null ? (
        <p className="text-ink-muted text-body">{t('review.neutralizeAlreadyDone')}</p>
      ) : (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setOpen(true)
          }}
        >
          {t('review.neutralizeOpen', { key: claimKey })}
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && pending) return
          setOpen(next)
          if (!next) {
            // A closed dialog is a finished act: reopening it starts a new correction rather than
            // showing last time's recompute over a claim that already carries one.
            //
            // **The page is refreshed here, not on success.** The refreshed tree renders
            // "this claim already carries a correction" in place of the trigger — which unmounts
            // the open dialog with the recompute inside it, and drops focus to the document.
            // The instructor who pressed the control is the only person who ever sees those five
            // facts together, so the screen waits until they have closed the answer.
            setResult(null)
            router.refresh()
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            {/* Once the correction is entered the dialog is an answer, not a question. */}
            <DialogTitle>
              {result === null
                ? t('review.neutralizeDialogTitle', { key: claimKey })
                : t('review.recomputeTitle')}
            </DialogTitle>
            <DialogDescription>
              {result === null ? t('review.neutralizeDialogBody') : t('review.recomputeFloor')}
            </DialogDescription>
          </DialogHeader>

          {result === null ? (
            <>
              <div className="mt-4 flex flex-col gap-5">
                <div role="group" aria-labelledby={reasonLegendId} className="flex flex-col gap-3">
                  <p id={reasonLegendId} className="text-ink text-meta font-medium">
                    {t('review.neutralizeReasonLegend')}
                  </p>
                  <RadioGroup
                    value={reason}
                    onValueChange={(value) => {
                      setReason(value as ReasonValue)
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

                <div className="flex flex-col gap-2">
                  <Field orientation="horizontal" className="min-h-10">
                    <Checkbox
                      id={creditId}
                      checked={credit}
                      aria-labelledby={creditLabelId}
                      aria-describedby={creditHintId}
                      onCheckedChange={(next) => {
                        setCredit(next === true)
                      }}
                    />
                    <FieldLabel
                      id={creditLabelId}
                      htmlFor={creditId}
                      className="text-body font-normal"
                    >
                      {t('review.neutralizeCredit')}
                    </FieldLabel>
                  </Field>
                  <p id={creditHintId} className="text-ink-muted text-meta max-w-measure">
                    {t('review.neutralizeCreditHint')}
                  </p>
                </div>

                <Field>
                  <FieldLabel htmlFor={noteId}>{t('review.neutralizeNoteLabel')}</FieldLabel>
                  <Textarea
                    id={noteId}
                    rows={3}
                    value={note}
                    onChange={(event) => {
                      setNote(event.target.value)
                    }}
                  />
                </Field>

                <FormAlert message={error} />
              </div>

              <DialogFooter className="mt-6">
                {/* `aria-disabled`, never `disabled`: the browser blurs a control the moment it is
                    disabled, and inside a dialog that drops the keyboard user out of the trap at
                    the exact moment a refusal is about to be announced under it. */}
                <DialogClose
                  render={<Button variant="secondary" aria-disabled={pending ? true : undefined} />}
                >
                  {t('review.neutralizeCancel')}
                </DialogClose>
                <Button
                  type="button"
                  aria-disabled={pending ? true : undefined}
                  aria-busy={pending}
                  onClick={() => {
                    if (pending) return
                    setError(null)
                    startTransition(async () => {
                      const answer = await neutralizeClaimAction({
                        runId,
                        claimId,
                        reason,
                        creditChallenge: credit,
                        note: note.trim(),
                      })
                      if (!answer.ok) {
                        setError(answer.error.message)
                        return
                      }
                      setResult({
                        recompute: answer.data.recompute as Recompute,
                        exportVersion: answer.data.exportVersion,
                      })
                    })
                  }}
                >
                  {pending ? t('review.neutralizePending') : t('review.neutralizeConfirm')}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              {/* A status region: the reader pressed a button and the answer replaced the form, so
                  a screen reader is told what came back rather than left in a dialog that changed
                  under it. */}
              <div role="status" className="mt-4 flex flex-col gap-4">
                {moved.length === 0 ? (
                  <p className="text-ink text-body max-w-measure">{t('review.recomputeNothing')}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {moved.map((dimension) => (
                      <li key={dimension} className="text-ink text-body">
                        {t('review.recomputeRow', {
                          dimension: DIMENSION_LABELS[dimension](),
                          before: bandName(result.recompute.bandsBefore[dimension]),
                          after: bandName(result.recompute.bandsEffective[dimension]),
                        })}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-ink text-body max-w-measure font-mono tabular-nums">
                  {t('review.recomputePoints', {
                    before: number(result.recompute.pointsBefore),
                    after: number(result.recompute.pointsAfter),
                  })}
                </p>
                {/* The floor is the dialog's description once the correction is entered; saying
                    it twice on one screen is a sentence a reader stops seeing. */}
                <p className="text-ink text-body max-w-measure">
                  {t('review.recomputeKeeps', {
                    effective: number(result.recompute.pointsEffective),
                  })}
                </p>
                <p className="text-ink-muted text-body max-w-measure">
                  {result.exportVersion === null
                    ? t('review.recomputeNoExport')
                    : t('review.recomputeExport', { version: result.exportVersion })}
                </p>
              </div>

              <DialogFooter className="mt-6">
                <DialogClose render={<Button variant="secondary" />}>
                  {t('review.neutralizeClose')}
                </DialogClose>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
