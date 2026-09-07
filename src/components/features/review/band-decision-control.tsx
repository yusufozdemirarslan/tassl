'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FormAlert } from '@/components/features/account/form-feedback'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { t as bandT } from '@/lib/i18n/messages/band'
import { t } from '@/lib/i18n/messages/review'
import { toastSuccess } from '@/lib/toast'
import { confirmRemainingAction, decideBandAction } from '@/server/modules/review/actions'

// UI-033 → `BandDecisionControl` (FR-181, FR-182): the one act this screen exists for.
//
// **The accent is here.** DESIGN.md gives a screen one teal voice and spends it on the act the
// visitor came to take; on the replay that is the decision on a band, not the void and not the
// correction, which are the instructor's rarest presses and wear the ink-on-hairline treatment
// three tabs away.
//
// Two controls, because there are two acts and conflating them made one of them a guess:
//
//   * **Confirm the draft** sends `confirmed` and no band. It is the common case — six of the seven
//     dimensions on most runs — and it needs no selection, which is why it is a button and not a
//     radio option. Confirming a draft that could not be placed records `unassessed`, because that
//     is what the draft says (D-437), and the service decides that rather than this control.
//   * **The radio group** is the override. It opens **pre-selected on the draft and unsubmitted**
//     (UI-033 A11y): the reviewer sees where the run stands without the screen having decided
//     anything on their behalf. Choosing the draft again and saving records `confirmed`, because
//     agreeing with the draft is confirming it; choosing another band records `overridden`;
//     choosing "Not assessed" records `unassessed`.
//
// **An override requires a band.** A dimension whose draft is unassessed opens with nothing
// selected — there is no draft to pre-select — and "Save this decision" then refuses in a message
// under the group rather than sending a decision with no band for the service to reject.
//
// **The note is optional and stays optional.** FR-182 is explicit that an override requires no
// justification, and the note is the one thing the student reads about the decision: a field that
// had to be filled would be filled with something.

/** The four bands and the fifth option, in Appendix A order, lowest first. */
const OPTIONS = [
  { value: 'novice', label: () => bandT('band.novice') },
  { value: 'developing', label: () => bandT('band.developing') },
  { value: 'proficient', label: () => bandT('band.proficient') },
  { value: 'professional', label: () => bandT('band.professional') },
  { value: 'unassessed', label: () => t('review.decisionOptionUnassessed') },
] as const

export type BandOptionValue = (typeof OPTIONS)[number]['value']

export type BandDecisionControlProps = {
  runId: string
  dimension: string
  /** The dimension in the reader's words; the legend names it. */
  dimensionLabel: string
  /** The drafted band, or null when the pipeline could not place the dimension. */
  draftBand: 'novice' | 'developing' | 'proficient' | 'professional' | null
  /** The band already on the record, when a decision has been taken; it is what opens selected. */
  decidedBand: 'novice' | 'developing' | 'proficient' | 'professional' | null
  /** The decision on the record, or null when nobody has decided this dimension. */
  decision: 'confirmed' | 'overridden' | 'unassessed' | null
  /** The note already on the record; it opens in the field so an edit is an edit. */
  note: string | null
  /**
   * False when this seat may not change this dimension — 08 §4's TA row, answered per dimension
   * because a teaching assistant may decide the six an instructor has not touched. The control says
   * so instead of refusing on submit.
   */
  canDecide: boolean
  /** True once the run is exported, so the reviewer knows a change writes a new version (D-087). */
  willReexport: boolean
}

/** What a selection means, given what the draft says. Pure, and the whole rule in one place. */
export function decisionFor(
  selection: BandOptionValue | '',
  draftBand: BandDecisionControlProps['draftBand'],
): { decision: 'confirmed' | 'overridden' | 'unassessed'; band?: BandOptionValue } | null {
  if (selection === '') return null
  if (selection === 'unassessed') return { decision: 'unassessed' }
  if (selection === draftBand) return { decision: 'confirmed' }
  return { decision: 'overridden', band: selection }
}

/** The four band words, for the labels below; the fifth option is not a band. */
const BAND_TEXT: Record<'novice' | 'developing' | 'proficient' | 'professional', string> = {
  novice: bandT('band.novice'),
  developing: bandT('band.developing'),
  proficient: bandT('band.proficient'),
  professional: bandT('band.professional'),
}

/**
 * What the primary control says, which is what it will do.
 *
 * The label is a function of the selection rather than a fixed "Save this decision", because that
 * wording over a group whose selection is still the draft describes a confirmation and reads like
 * an override — and, beside a second button labelled "Confirm the draft", left a reviewer choosing
 * between two words for one act. Naming the band in the label is also what makes the press
 * checkable at a glance, in a screenshot or in a support conversation.
 */
export function submitLabel(
  selection: BandOptionValue | '',
  draftBand: BandDecisionControlProps['draftBand'],
): string {
  if (selection === '') return t('review.decisionChoose')
  if (selection === 'unassessed') return t('review.decisionMarkUnassessed')
  if (selection === draftBand)
    return t('review.decisionConfirmBand', { band: BAND_TEXT[selection] })
  return t('review.decisionRecordInstead', { band: BAND_TEXT[selection] })
}

export function BandDecisionControl({
  runId,
  dimension,
  dimensionLabel,
  draftBand,
  decidedBand,
  decision,
  note,
  canDecide,
  willReexport,
}: BandDecisionControlProps) {
  const router = useRouter()
  const fieldId = useId()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // What opens selected: the decision on the record where there is one, the draft where there is
  // not, and nothing at all where neither places the dimension. Nothing is submitted by opening.
  const initial: BandOptionValue | '' =
    decision === 'unassessed' ? 'unassessed' : (decidedBand ?? draftBand ?? '')
  const [selection, setSelection] = useState<BandOptionValue | ''>(initial)
  const [noteText, setNoteText] = useState(note ?? '')

  const legendId = `${fieldId}-legend`
  const errorId = `${fieldId}-error`
  const noteId = `${fieldId}-note`
  const noteHintId = `${fieldId}-note-hint`

  function send(input: { decision: 'confirmed' | 'overridden' | 'unassessed'; band?: string }) {
    if (pending) return
    setError(null)
    startTransition(async () => {
      const trimmed = noteText.trim()
      const result = await decideBandAction({
        runId,
        dimension,
        ...input,
        ...(trimmed.length > 0 ? { note: trimmed } : {}),
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      toastSuccess(t('review.decisionSaved'))
      router.refresh()
    })
  }

  if (!canDecide) {
    return (
      <p className="border-line bg-paper-sunken text-ink text-body max-w-measure rounded-md border p-3">
        {t('review.decisionLockedByInstructor')}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The radio group carries the name itself; a second `role="group"` around it with the same
          label would make a screen reader announce the group twice for one control. */}
      <div className="flex flex-col gap-3">
        <p id={legendId} className="text-ink text-meta font-medium">
          {t('review.decisionLegend', { dimension: dimensionLabel })}
        </p>
        <RadioGroup
          value={selection}
          onValueChange={(value) => {
            setSelection(value as BandOptionValue)
            setError(null)
          }}
          aria-labelledby={legendId}
          aria-describedby={error ? errorId : undefined}
          // `lg:gap-4`: the radio's hit area reaches 12 px past the control on each side, so an
          // 8 px gap lets one option's target overlap its neighbour's label.
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4"
        >
          {OPTIONS.map((option) => {
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
        <FieldLabel htmlFor={noteId}>{t('review.decisionNoteLabel')}</FieldLabel>
        <Textarea
          id={noteId}
          rows={2}
          value={noteText}
          aria-describedby={noteHintId}
          onChange={(event) => {
            setNoteText(event.target.value)
          }}
        />
        <p id={noteHintId} className="text-ink-muted text-meta max-w-measure">
          {t('review.decisionNoteHint')}
        </p>
      </Field>

      {error !== null && (
        <div id={errorId}>
          <FormAlert message={error} />
        </div>
      )}

      {willReexport && (
        <p className="text-ink-muted text-body max-w-measure">{t('review.bandReexportNote')}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          aria-disabled={pending ? true : undefined}
          aria-busy={pending}
          onClick={() => {
            const input = decisionFor(selection, draftBand)
            if (input === null) {
              setError(t('review.decisionChooseBand'))
              return
            }
            send(input)
          }}
        >
          {pending ? t('review.decisionSaving') : submitLabel(selection, draftBand)}
        </Button>
        {/* Only where it is a *different* act, and it names the band it would record. With the
            draft still selected the primary already says "Confirm the draft: Proficient", so a
            second button there would be two words for one act; once the selection has moved, the
            two buttons say two different bands and neither can be mistaken for the other. */}
        {selection !== (draftBand ?? '') && (
          <Button
            type="button"
            variant="secondary"
            aria-disabled={pending ? true : undefined}
            onClick={() => {
              send({ decision: 'confirmed' })
            }}
          >
            {pending
              ? t('review.decisionConfirming')
              : t('review.decisionConfirmBand', {
                  band: draftBand === null ? bandT('band.unassessed') : BAND_TEXT[draftBand],
                })}
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// UI-033's shortcut: every dimension nobody has decided takes its draft (10 §12)
// ---------------------------------------------------------------------------------------------

export type ConfirmRemainingProps = {
  runId: string
  /** The dimensions nobody has decided, each with the draft it would take. */
  pending: readonly { dimension: string; label: string; band: string }[]
  /** The export version this press would file, so the dialog can name it (D-087). */
  willExportVersion: number
}

/**
 * "Confirm the remaining drafts", beside the progress counter.
 *
 * It is the same act as pressing the per-dimension control on each open dimension, and it exists
 * because that is what a reviewer who agrees with the read is otherwise doing seven times. It wears
 * the secondary treatment: the accent belongs to the decision itself, and this is the shortcut past
 * it rather than the act.
 *
 * **It is asked for first.** One press can decide seven bands, confirm the run, write
 * `points_confirmed` and file an export version (FR-181, FR-184) — the heaviest consequence on the
 * screen behind its lightest control. So the dialog lists every dimension it is about to decide
 * with the draft each would take, and names the export version it would file, before anything is
 * sent. The only other irreversible act on this screen, the void, is asked for the same way.
 *
 * A run with nothing left to decide is offered nothing: a control that can only refuse is worse
 * than an absent one.
 */
export function ConfirmRemaining({
  runId,
  pending: open,
  willExportVersion,
}: ConfirmRemainingProps) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [saving, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (open.length === 0) return null

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setAsking(true)
        }}
      >
        {t('review.confirmRemaining')}
      </Button>

      <AlertDialog
        open={asking}
        onOpenChange={(next) => {
          if (!next && saving) return
          setAsking(next)
        }}
      >
        {/* `data-[size=default]:sm:max-w-lg`, not `sm:max-w-lg`: the primitive's own
            `data-[size=default]:sm:max-w-sm` is a class-plus-attribute selector and outranks a
            plain modifier, so the wider clamp has to match its specificity or the dialog renders at
            384 px with seven dimension rows in it. */}
        <AlertDialogContent className="max-h-[85dvh] overflow-y-auto data-[size=default]:sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('review.confirmRemainingDialogTitle', { count: open.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('review.confirmRemainingDialogBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <dl className="border-line mt-4 flex flex-col gap-2 border-t pt-4">
            {open.map((row) => (
              <div key={row.dimension} className="flex items-baseline justify-between gap-4">
                <dt className="text-ink text-body">{row.label}</dt>
                <dd className="text-ink text-body font-mono tabular-nums">{row.band}</dd>
              </div>
            ))}
          </dl>

          <p className="text-ink-muted text-body max-w-measure mt-4">
            {t('review.confirmRemainingReexport', { version: willExportVersion })}
          </p>

          <FormAlert message={error} />

          <AlertDialogFooter>
            {/* `aria-disabled`, never `disabled`: the browser blurs a control the moment it is
                disabled, which drops a keyboard user out of the dialog mid-request. */}
            <AlertDialogCancel aria-disabled={saving ? true : undefined}>
              {t('review.confirmRemainingCancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              aria-disabled={saving ? true : undefined}
              aria-busy={saving}
              onClick={(event) => {
                event.preventDefault()
                if (saving) return
                setError(null)
                startTransition(async () => {
                  const result = await confirmRemainingAction({ runId })
                  if (!result.ok) {
                    setError(result.error.message)
                    return
                  }
                  toastSuccess(t('review.confirmRemainingDone'))
                  setAsking(false)
                  router.refresh()
                  // The control that was pressed is gone once nothing is left to decide, so the
                  // control focus would be returned to is gone with it. The page title is where the
                  // shell already sends focus on a route change.
                  document.getElementById('page-title')?.focus()
                })
              }}
            >
              {saving
                ? t('review.confirmRemainingPending')
                : t('review.confirmRemainingSubmit', { count: open.length })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
