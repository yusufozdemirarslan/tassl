'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { Panel } from '@/components/layout/panel'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/cn'
import { useDeferredModule } from '@/lib/hooks/use-deferred-module'
import { t } from '@/lib/i18n/messages/workspace'
import { countWords } from '@/lib/words'
import {
  briefSignalAction,
  lockDecisionAction,
  saveBriefDraftAction,
} from '@/server/modules/runs/actions'
import type { BriefFieldUnitValue, BriefNamedField, BriefView } from '@/server/modules/runs/schema'
import type { LockReadBackEntry } from './lock-dialog'
import { useRunWork } from './run-work-context'

// UI-023, right column: the Decision Brief (FR-100, FR-101, FR-103, FR-108) and the Decision Lock.
//
// Six fields, one autosave, and one irreversible press. Four rules run through the whole file, and
// each is a product rule rather than a preference.
//
//   * **The word counts are the server's counts.** `countWords` is the function `wordLimit(n)` runs
//     inside `BriefSchema` and `BriefDraftSchema` (D-075), so the number under a textarea and the
//     number the service refuses on cannot disagree. The limits are restated here rather than
//     imported from the module schema, because a client component never imports one (D-186).
//   * **A draft is saved, never filed.** `saveBriefDraftAction` writes a scratchpad row and no trace
//     event, and it is debounced at 800 ms (UI-023), so a student typing continuously saves once
//     when they pause rather than once per letter. What it sends is the whole brief as it stands on
//     screen, which is safe because this editor is the only thing that writes the draft: the
//     service's rule that a save carries only the keys it was given (`validateBriefDraft`) is what
//     protects a *partial* caller from blanking a column, and there is not one here. Nothing about
//     the decision happens until the lock.
//   * **The numeric fields take numbers.** FR-100's own acceptance criterion is "numeric fields
//     accept numbers only", so each is held as the text the student typed — a half-typed number is
//     a string, and coercing on every keystroke fights the person typing "11.0" — and refused with
//     one sentence until it parses. What is sent is the parsed number.
//   * **A refusal returns the student to the brief exactly as they left it** (FR-108). Neither
//     `BRIEF_INVALID` nor `LOCK_REFUSED_UNSTANCED_CLAIM` writes anything, so nothing here clears,
//     re-reads or re-orders the form. Both are handed to the lock dialog, which is the thing the
//     student pressed: one names the claim and offers a way to it, the other names the field and
//     offers a way to it, and the field is marked in the form behind either (D-320). `BRIEF_INVALID`
//     used to close the dialog silently, so two refusals of one press behaved differently.
//
// **The lock says what it is going to ask for before it is pressed** (D-319). The run already knows
// which claims the student has recorded leaning on with no stance on them — it is their own record,
// not anything authored — so the count stands beside the button as a fact, and the confirmation
// reads back what is about to be filed. Neither evaluates: the pre-flight line names no claim and
// the read-back marks no field short.
//
// **The lock confirmation is a separate chunk, fetched on the first focus inside the editor.** It
// is the reasoning `frame-form.tsx` sets out for the frame's own confirmation and the same trade:
// writing a brief takes minutes, so the dialog is in the module cache long before the press, and
// the press opens it with no round trip. If it never arrived, the editor says so and files nothing —
// an irreversible act is not taken unconfirmed.
//
// Nothing here evaluates the brief. There is no quality hint, no example answer, no "your
// confidence looks high", and no mark on a field left short: what is enforced is FR-100's rules,
// and everything else is the student's to write.

/** FR-100's limits (`BRIEF_LIMITS`), restated so the counters and the messages name one number. */
const LIMITS = {
  recommendation: 120,
  rationale: 250,
  assumption: 25,
  changeMyMind: 60,
} as const

const ASSUMPTION_COUNT = 3
const DEFAULT_CONFIDENCE = 50

/** UI-023: the autosave is debounced at 800 ms. */
const AUTOSAVE_MS = 800

/** Confidence as it is typed: a whole number, no sign and no decimal point (0 to 100). */
const CONFIDENCE_PATTERN = /^\d{1,3}$/

/** A named field as it is typed: digits, one decimal point, an optional leading minus (FR-100). */
const NUMBER_PATTERN = /^-?\d*(?:\.\d*)?$/

/** The unit a named field is entered in, in the student's language. */
const UNIT_LABELS: Record<BriefFieldUnitValue, () => string> = {
  percent: () => t('workspace.unitPercent'),
  ratio: () => t('workspace.unitRatio'),
  months: () => t('workspace.unitMonths'),
  usd: () => t('workspace.unitUsd'),
  count: () => t('workspace.unitCount'),
  other: () => t('workspace.unitOther'),
}

/** The brief as this editor holds it: every field a string, because that is what a box contains. */
type BriefValues = {
  recommendation: string
  rationale: string
  assumptions: string[]
  changeMyMind: string
  confidence: string
  namedValues: Record<string, string>
}

/** The paths `BRIEF_INVALID` can name (10 §6), which is what a refusal is bound to. */
type BriefPath = keyof Omit<BriefValues, 'assumptions' | 'namedValues'> | `assumptions.${number}`

function valuesOf(draft: BriefView | null, fields: readonly BriefNamedField[]): BriefValues {
  const namedValues: Record<string, string> = {}
  for (const field of fields) {
    const held = draft?.namedValues[field.key]
    namedValues[field.key] = held === undefined ? '' : String(held)
  }
  return {
    recommendation: draft?.recommendation ?? '',
    // The view names it `briefRationale` and the draft input names it `rationale` (D-329): the
    // short name is reserved for a claim's authored rationale in every student payload, and this
    // box holds the student's own 250 words. The two names meet here and nowhere else.
    rationale: draft?.briefRationale ?? '',
    assumptions:
      draft && draft.assumptions.length === ASSUMPTION_COUNT
        ? [...draft.assumptions]
        : Array.from({ length: ASSUMPTION_COUNT }, () => ''),
    changeMyMind: draft?.changeMyMind ?? '',
    confidence: draft?.confidence === null || draft === null ? '' : String(draft.confidence),
    namedValues,
  }
}

/** Module-scope, so the bundler can match this call site to the confirmation's own chunk. */
const loadLockDialog = () => import('./lock-dialog')

export type BriefEditorProps = {
  runId: string
  /** `RunWorkspace.briefDraft`: what the last autosave stored, or null before the first (FR-108). */
  draft: BriefView | null
  /** `RunWorkspace.namedFields`: the author's own labels and units, in authored order (D-301). */
  namedFields: readonly BriefNamedField[]
  /** `capabilities.canWriteBrief`: true in `working` alone — never while the run is paused. */
  canWrite: boolean
  /**
   * How many claims the run has recorded reliance on with no stance on them (FR-084, D-319).
   *
   * A count of the student's own acts, computed on the server from the same `reliedOn` the lock
   * gate reads. It names no claim and says nothing about any of them — every one of them is on the
   * screen already, wearing the same mark on its own card.
   */
  unstancedRelied?: number
}

export function BriefEditor({
  runId,
  draft,
  namedFields,
  canWrite,
  unstancedRelied = 0,
}: BriefEditorProps) {
  const router = useRouter()
  const { announce } = useRunWork()
  const [values, setValues] = useState<BriefValues>(() => valuesOf(draft, namedFields))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [fieldError, setFieldError] = useState<{ field: BriefPath; message: string } | null>(null)
  const [formError, setFormError] = useState<{ message: string; requestId?: string } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [locking, setLocking] = useState(false)
  const [refusal, setRefusal] = useState<{ claimId: string; claimText: string } | null>(null)
  const [briefRefusal, setBriefRefusal] = useState<{
    fieldId: string
    label: string
    message: string
  } | null>(null)

  const {
    loaded: lockModule,
    status: lockStatus,
    request: requestLockDialog,
  } = useDeferredModule(loadLockDialog)
  const LockDialog = lockModule?.LockDialog

  const waitingForConfirm = confirmOpen && lockStatus === 'loading'
  const confirmUnavailable = confirmOpen && lockStatus === 'failed'

  // FR-100's two signals: the editor was opened, and it was closed after a spell. They are a trace
  // of how long the brief was open, which is what the clock timeline draws — not of what was in it.
  const openedAt = useRef<number | null>(null)
  useEffect(() => {
    if (!canWrite) return
    const started = Date.now()
    openedAt.current = started
    void briefSignalAction({ runId, signal: { opened: true } }).catch(() => {
      // A signal that did not land is a gap in a timeline, never a reason to stop the student
      // writing. The brief itself is saved by its own action.
    })
    return () => {
      void briefSignalAction({
        runId,
        signal: { closed: true, durationMs: Math.max(0, Date.now() - started) },
      }).catch(() => {
        // The run moved on — the clock ran out, the decision was filed — and a `brief_closed`
        // after the working period is refused on purpose (D-294).
      })
    }
  }, [runId, canWrite])

  // The autosave. One timer, restarted on every keystroke, carrying whatever the fields hold when
  // it fires — so a student typing continuously saves once when they pause rather than per letter.
  //
  // `latest` is written by `change` and by nothing else — never during render, which React's purity
  // rules forbid and which would be pointless here anyway: the only writer of `values` is `change`,
  // so the ref and the state move together.
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(values)

  const save = useCallback(() => {
    const held = latest.current
    const draftPayload = {
      runId,
      recommendation: held.recommendation,
      rationale: held.rationale,
      assumptions: held.assumptions,
      changeMyMind: held.changeMyMind,
      confidence: CONFIDENCE_PATTERN.test(held.confidence.trim())
        ? Math.min(100, Number(held.confidence))
        : null,
      namedValues: numbersOf(held.namedValues),
    }
    setSaving(true)
    void saveBriefDraftAction(draftPayload).then(
      (result) => {
        setSaving(false)
        setSaveFailed(!result.ok)
        setSaved(result.ok)
        // A save that failed is news and goes to the screen's one region; a save that worked is
        // not, and stays a line beside the control that reads it (D-314).
        if (!result.ok) announce(t('workspace.briefSaveFailed'))
      },
      () => {
        setSaving(false)
        setSaveFailed(true)
        announce(t('workspace.briefSaveFailed'))
      },
    )
  }, [runId, announce])

  const change = useCallback(
    (next: BriefValues) => {
      setValues(next)
      latest.current = next
      setSaved(false)
      if (!canWrite) return
      if (pendingSave.current !== null) clearTimeout(pendingSave.current)
      pendingSave.current = setTimeout(save, AUTOSAVE_MS)
    },
    [canWrite, save],
  )

  // A save that was still waiting when the editor went away is sent rather than dropped. Eight
  // hundred milliseconds of typing is not much until it is the last eight hundred: the clock runs
  // out, `materializeTimers` files the draft as it stands (FR-105), and what it files should be
  // what the student wrote rather than what the debounce happened to have flushed.
  useEffect(
    () => () => {
      if (pendingSave.current === null) return
      clearTimeout(pendingSave.current)
      pendingSave.current = null
      save()
    },
    [save],
  )

  function lock(): void {
    if (locking || !canWrite) return
    setLocking(true)
    setFormError(null)
    setFieldError(null)
    void lockDecisionAction({
      runId,
      recommendation: values.recommendation,
      rationale: values.rationale,
      assumptions: values.assumptions,
      changeMyMind: values.changeMyMind,
      confidence: Number(values.confidence),
      namedValues: numbersOf(values.namedValues),
    }).then(
      (result) => {
        if (result.ok) {
          // The run is in `decision_locked` now and the action invalidated this route; the server
          // render decides what stands here next. `locking` stays true until the new tree arrives.
          setConfirmOpen(false)
          router.refresh()
          return
        }
        setLocking(false)
        if (result.error.code === 'BRIEF_INVALID') {
          const named = refusedField(result.error.details)
          if (named) {
            // The field is marked in the form *and* the dialog says so: the same press, answered,
            // exactly as the unstanced-claim refusal is (D-320).
            setFieldError(named)
            setBriefRefusal({
              fieldId: fieldId(named.field),
              label: labelOf(named.field),
              message: named.message,
            })
            return
          }
        }
        if (result.error.code === 'LOCK_REFUSED_UNSTANCED_CLAIM') {
          const claim = unstancedRefusal(result.error.details)
          if (claim) {
            // The dialog stays open and changes what it says: the same press, answered.
            setRefusal(claim)
            return
          }
        }
        setConfirmOpen(false)
        if (result.error.code === 'ILLEGAL_TRANSITION' || result.error.code === 'RUN_LOCKED') {
          setFormError({ message: t('workspace.lockMoved') })
          router.refresh()
          return
        }
        setFormError({
          message: result.error.message || t('workspace.decisionLockFailed'),
          requestId: result.error.requestId,
        })
      },
      () => {
        setLocking(false)
        setConfirmOpen(false)
        setFormError({ message: t('workspace.decisionLockFailed') })
      },
    )
  }

  const confidenceOver =
    values.confidence.trim() !== '' && !CONFIDENCE_PATTERN.test(values.confidence.trim())
  const confidenceMessage =
    fieldError?.field === 'confidence'
      ? fieldError.message
      : confidenceOver || Number(values.confidence) > 100
        ? t('workspace.briefConfidenceInvalid')
        : undefined

  /**
   * What the press is about to file, in the order the brief asks for it (D-319).
   *
   * Built from the values on screen rather than from the draft the server holds, because the
   * student may have typed since the last autosave and it is *this* text the lock will send.
   */
  const readBack: LockReadBackEntry[] = [
    entryOf(t('workspace.briefRecommendationLabel'), values.recommendation),
    entryOf(t('workspace.briefRationaleLabel'), values.rationale),
    ...values.assumptions.map((assumption, index) =>
      entryOf(t('workspace.briefAssumptionLabel', { number: index + 1 }), assumption),
    ),
    entryOf(t('workspace.briefChangeMyMindLabel'), values.changeMyMind),
    {
      label: t('workspace.briefConfidenceLegend'),
      value: CONFIDENCE_PATTERN.test(values.confidence.trim())
        ? t('workspace.lockReadBackConfidence', { value: Number(values.confidence) })
        : null,
    },
    ...namedFields.map((field) => ({
      label: t('workspace.briefNamedFieldLabel', {
        label: field.label,
        unit: UNIT_LABELS[field.unit](),
      }),
      value:
        (values.namedValues[field.key] ?? '').trim() === ''
          ? null
          : (values.namedValues[field.key] ?? '').trim(),
    })),
  ]

  const status = saveFailed
    ? t('workspace.briefSaveFailed')
    : saving
      ? t('workspace.briefSaving')
      : saved
        ? t('workspace.briefSaved')
        : null

  return (
    <Panel
      id="brief-editor-panel"
      title={t('workspace.briefEditorTitle')}
      description={t('workspace.briefDescription')}
      headingLevel={2}
      padding="reading"
    >
      <form
        noValidate
        // The first focus inside the brief is the earliest honest signal that this student is going
        // to file something, and it is minutes ahead of the press.
        onFocusCapture={() => {
          if (lockStatus === 'idle' && LockDialog === undefined) requestLockDialog()
        }}
        onSubmit={(event) => {
          event.preventDefault()
          // `aria-disabled` keeps the control reachable and its reason readable, which is
          // DESIGN.md's rule; it does not stop a press, and every other control in these files
          // guards its own handler. This one did not (D-325).
          if (locking || !canWrite) return
          setFormError(null)
          setRefusal(null)
          setBriefRefusal(null)
          requestLockDialog()
          setConfirmOpen(true)
        }}
        className="flex flex-col gap-6"
      >
        <WritingField
          id={fieldId('recommendation')}
          label={t('workspace.briefRecommendationLabel')}
          hint={t('workspace.briefRecommendationHint', { limit: LIMITS.recommendation })}
          limit={LIMITS.recommendation}
          rows={4}
          value={values.recommendation}
          error={fieldError?.field === 'recommendation' ? fieldError.message : undefined}
          onChange={(recommendation) => {
            change({ ...values, recommendation })
          }}
        />

        <WritingField
          id={fieldId('rationale')}
          label={t('workspace.briefRationaleLabel')}
          hint={t('workspace.briefRationaleHint', { limit: LIMITS.rationale })}
          limit={LIMITS.rationale}
          rows={7}
          value={values.rationale}
          error={fieldError?.field === 'rationale' ? fieldError.message : undefined}
          onChange={(rationale) => {
            change({ ...values, rationale })
          }}
        />

        {/* The three share one rule, so they share one legend and one statement of it; the
            fieldset points at that sentence so it is read on the way in rather than skipped. */}
        <fieldset aria-describedby="brief-assumptions-hint" className="flex min-w-0 flex-col gap-4">
          <legend className="text-ink text-body mb-1 font-medium">
            {t('workspace.briefAssumptionsLegend')}
          </legend>
          <p id="brief-assumptions-hint" className="text-ink-muted text-meta max-w-measure -mt-3">
            {t('workspace.briefAssumptionsHint', { limit: LIMITS.assumption })}
          </p>
          {values.assumptions.map((assumption, index) => (
            <WritingField
              key={`brief-assumption-${String(index)}`}
              id={fieldId(`assumptions.${index}`)}
              label={t('workspace.briefAssumptionLabel', { number: index + 1 })}
              limit={LIMITS.assumption}
              rows={2}
              value={assumption}
              error={fieldError?.field === `assumptions.${index}` ? fieldError.message : undefined}
              onChange={(text) => {
                const assumptions = [...values.assumptions]
                assumptions[index] = text
                change({ ...values, assumptions })
              }}
            />
          ))}
        </fieldset>

        <WritingField
          id={fieldId('changeMyMind')}
          label={t('workspace.briefChangeMyMindLabel')}
          hint={t('workspace.briefChangeMyMindHint', { limit: LIMITS.changeMyMind })}
          limit={LIMITS.changeMyMind}
          rows={4}
          value={values.changeMyMind}
          error={fieldError?.field === 'changeMyMind' ? fieldError.message : undefined}
          onChange={(changeMyMind) => {
            change({ ...values, changeMyMind })
          }}
        />

        {namedFields.length > 0 && (
          <fieldset aria-describedby="brief-figures-hint" className="flex min-w-0 flex-col gap-4">
            <legend className="text-ink text-body mb-1 font-medium">
              {t('workspace.briefNamedFieldsLegend')}
            </legend>
            <p id="brief-figures-hint" className="text-ink-muted text-meta max-w-measure -mt-3">
              {t('workspace.briefNamedFieldsHint')}
            </p>
            {namedFields.map((field) => (
              <NumberField
                key={field.key}
                field={field}
                value={values.namedValues[field.key] ?? ''}
                onChange={(text) => {
                  change({
                    ...values,
                    namedValues: { ...values.namedValues, [field.key]: text },
                  })
                }}
              />
            ))}
          </fieldset>
        )}

        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="text-ink text-body mb-1 font-medium">
            {t('workspace.briefConfidenceLegend')}
          </legend>
          <p id="brief-confidence-hint" className="text-ink-muted text-meta max-w-measure -mt-1">
            {t('workspace.briefConfidenceHint')}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            {/* A native range: keyboard-operable everywhere, 40 px of target, and the accent is
                the product's one action colour. */}
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={
                CONFIDENCE_PATTERN.test(values.confidence.trim())
                  ? Math.min(100, Number(values.confidence))
                  : DEFAULT_CONFIDENCE
              }
              aria-label={t('workspace.briefConfidenceSlider')}
              aria-describedby="brief-confidence-hint"
              onChange={(event) => {
                change({ ...values, confidence: event.target.value })
              }}
              className="accent-primary h-10 min-w-48 flex-1 cursor-pointer"
            />
            <Input
              id={fieldId('confidence')}
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              value={values.confidence}
              aria-label={t('workspace.briefConfidenceNumber')}
              aria-invalid={confidenceMessage ? true : undefined}
              aria-describedby={
                confidenceMessage ? 'brief-confidence-error' : 'brief-confidence-hint'
              }
              onChange={(event) => {
                change({ ...values, confidence: event.target.value })
              }}
              className="w-24 font-mono tabular-nums"
            />
          </div>
          <FieldError id="brief-confidence-error">{confidenceMessage}</FieldError>
        </fieldset>

        {!canWrite && <p className="text-ink-muted text-body">{t('workspace.briefClosedNote')}</p>}

        <FormAlert
          message={
            confirmUnavailable
              ? t('workspace.decisionLockUnavailable')
              : (formError?.message ?? null)
          }
          reference={
            confirmUnavailable || formError?.requestId === undefined
              ? undefined
              : { label: t('workspace.errorReference'), id: formError.requestId }
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            aria-disabled={locking || !canWrite ? true : undefined}
            aria-busy={locking || waitingForConfirm}
            aria-describedby={`${unstancedRelied > 0 ? 'brief-lock-preflight ' : ''}brief-lock-status`.trim()}
          >
            {locking && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
            {locking ? t('workspace.decisionLocking') : t('workspace.decisionLock')}
          </Button>

          {/* The autosave's line and the confirmation's, in one place beside the control that
              reads them. Neither is a live region: the screen has one, and a "Saved." spoken every
              time the debounce fires is the noise DESIGN.md's counters rule already refuses. The
              button points at it, so a student who reaches the lock hears where the save stands. */}
          <p id="brief-lock-status" className="text-ink-muted text-meta empty:hidden">
            {waitingForConfirm ? t('workspace.decisionLockLoading') : status}
          </p>
        </div>

        {/* FR-084 said before the irreversible press rather than by it (D-319). A count of the
            student's own record; the claims themselves are marked on their own cards. */}
        {unstancedRelied > 0 && (
          <p id="brief-lock-preflight" className="text-ink text-meta max-w-measure">
            {unstancedRelied === 1
              ? t('workspace.lockPreflightOne')
              : t('workspace.lockPreflight', { count: unstancedRelied })}
          </p>
        )}
      </form>

      {LockDialog !== undefined && (
        <LockDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            setConfirmOpen(open)
            if (!open) {
              setRefusal(null)
              setBriefRefusal(null)
            }
          }}
          locking={locking}
          refusal={refusal}
          briefRefusal={briefRefusal}
          readBack={readBack}
          onConfirm={lock}
          onGoToField={(id) => {
            document.getElementById(id)?.focus()
          }}
        />
      )}
    </Panel>
  )
}

/** One written field of the read-back: the words, or the neutral note that it is empty. */
function entryOf(label: string, value: string): LockReadBackEntry {
  const trimmed = value.trim()
  if (trimmed === '') return { label, value: null }
  return { label, value: trimmed, words: countWords(trimmed) }
}

/** The DOM id of one field, so a server-named refusal can be focused where the student left it. */
function fieldId(field: BriefPath): string {
  return `brief-${field.replace('.', '-')}`
}

/** Only the fields that parse; a half-typed number is not a value the draft should carry. */
function numbersOf(typed: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, text] of Object.entries(typed)) {
    const trimmed = text.trim()
    if (trimmed === '') continue
    const value = Number(trimmed)
    if (Number.isFinite(value)) out[key] = value
  }
  return out
}

/** `BRIEF_INVALID`'s `details` (10 §6): which field, and which of FR-100's rules it broke. */
function refusedField(details: unknown): { field: BriefPath; message: string } | null {
  if (typeof details !== 'object' || details === null) return null
  const { field, reason } = details as { field?: unknown; reason?: unknown }
  if (typeof field !== 'string') return null
  if (field === 'confidence') {
    return { field: 'confidence', message: t('workspace.briefConfidenceInvalid') }
  }
  const path = field as BriefPath
  if (reason === 'word_limit') {
    return { field: path, message: t('workspace.briefWordLimit', { limit: limitOf(path) }) }
  }
  return { field: path, message: t('workspace.briefRequiredField') }
}

/**
 * The label the editor puts on a field, so the refusal names it the way the form does.
 *
 * `BriefPath` is the closed set `BRIEF_INVALID` can name (10 §6) — the four written fields, the
 * three assumptions and the confidence — so the fall-through is an assumption index and not a
 * default.
 */
function labelOf(field: BriefPath): string {
  if (field === 'recommendation') return t('workspace.briefRecommendationLabel')
  if (field === 'rationale') return t('workspace.briefRationaleLabel')
  if (field === 'changeMyMind') return t('workspace.briefChangeMyMindLabel')
  if (field === 'confidence') return t('workspace.briefConfidenceLegend')
  return t('workspace.briefAssumptionLabel', { number: Number(field.split('.')[1] ?? '0') + 1 })
}

/** The word limit behind a server-named field, for the `word_limit` refusal's message. */
function limitOf(field: BriefPath): number {
  if (field === 'recommendation') return LIMITS.recommendation
  if (field === 'rationale') return LIMITS.rationale
  if (field === 'changeMyMind') return LIMITS.changeMyMind
  return LIMITS.assumption
}

/** `LOCK_REFUSED_UNSTANCED_CLAIM`'s `details` (10 §6): the claim, in the words the student read. */
function unstancedRefusal(details: unknown): { claimId: string; claimText: string } | null {
  if (typeof details !== 'object' || details === null) return null
  const { claimId, claimText } = details as { claimId?: unknown; claimText?: unknown }
  if (typeof claimId !== 'string' || typeof claimText !== 'string') return null
  return { claimId, claimText }
}

// ---------------------------------------------------------------------------------------------
// One field of the brief
// ---------------------------------------------------------------------------------------------

type WritingFieldProps = {
  id: string
  label: string
  hint?: string
  limit: number
  rows: number
  value: string
  /** The refusal the server named, if any; the over-limit message is computed here. */
  error: string | undefined
  onChange: (value: string) => void
}

function WritingField({ id, label, hint, limit, rows, value, error, onChange }: WritingFieldProps) {
  const words = countWords(value)
  const over = words > limit
  const message = error ?? (over ? t('workspace.briefWordLimit', { limit }) : undefined)
  const countId = `${id}-count`

  return (
    <Field data-invalid={message ? 'true' : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className={cn('text-reading max-w-measure', over && 'border-red')}
        aria-invalid={message ? true : undefined}
        aria-describedby={`${message ? `${id}-error` : hint ? `${id}-hint` : ''} ${countId}`.trim()}
      />
      <div className="max-w-measure flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          {message ? (
            <FieldError id={`${id}-error`}>{message}</FieldError>
          ) : hint ? (
            <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>
          ) : null}
        </div>
        {/* Read on focus through `aria-describedby` rather than announced on every keystroke: a
            counter in a live region would talk over the sentence being written (09 §6). */}
        <span
          id={countId}
          className={cn(
            'text-mono-sm shrink-0 font-mono tabular-nums',
            over ? 'text-red' : 'text-ink-muted',
          )}
        >
          {t('workspace.wordCount', { count: words, limit })}
        </span>
      </div>
    </Field>
  )
}

type NumberFieldProps = {
  field: BriefNamedField
  value: string
  onChange: (value: string) => void
}

/**
 * One named numeric field: the author's label, the unit it is entered in, and digits only.
 *
 * The unit is in the visible label rather than as an adornment, because the same words are what a
 * screen reader needs to know what number is being asked for — "Premium payback you are betting on,
 * in months" is the whole question.
 */
function NumberField({ field, value, onChange }: NumberFieldProps) {
  const id = `brief-named-${field.key}`
  const invalid = value.trim() !== '' && !Number.isFinite(Number(value.trim()))

  return (
    <Field data-invalid={invalid ? 'true' : undefined}>
      <FieldLabel htmlFor={id}>
        {t('workspace.briefNamedFieldLabel', {
          label: field.label,
          unit: UNIT_LABELS[field.unit](),
        })}
      </FieldLabel>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => {
          const next = event.target.value
          // FR-100: numbers only. A keystroke that would make the box something other than a
          // number in progress is simply not taken — there is nothing to correct afterwards.
          if (next === '' || NUMBER_PATTERN.test(next)) onChange(next)
        }}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className={cn('w-48 font-mono tabular-nums', invalid && 'border-red')}
      />
      {invalid && <FieldError id={`${id}-error`}>{t('workspace.briefNumberInvalid')}</FieldError>}
    </Field>
  )
}
