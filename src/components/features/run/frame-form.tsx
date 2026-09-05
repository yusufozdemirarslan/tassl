'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch, type UseFormRegisterReturn } from 'react-hook-form'
import { array, length, minLength, object, refine, string, trim, type output } from 'zod/mini'
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
import { lockFrameAction } from '@/server/modules/runs/actions'

// UI-023, middle column in `framing`: the frame (FR-040 to FR-043).
//
// Four fields and one irreversible press. What the student writes here is written before the
// assistant is in the room, and it is what the rest of the run is read against — so the form's whole
// job is to let them say it, tell them where the limits are while they type, and make the lock
// unmistakable.
//
// **The word counts are the server's counts.** `countWords` is imported from `src/lib/words`, which
// is the same function `wordLimit(n)` runs inside `LockFrameSchema`; D-075 exists so that the number
// under the textarea and the number the service refuses on cannot disagree. The bounds themselves
// are restated here with `zod/mini` rather than imported from the module schema, because a client
// component never imports a module's `schema.ts` (D-186) — the module schema is the authority, and
// the action validates against it whatever this form believes.
//
// The over-limit message shows the moment a field goes over, without waiting for a submission: the
// student is under a clock they cannot pause, and a fifty-first word discovered by pressing a button
// is a worse trade than one line of red under the field. The counter beside it carries the number,
// so the message never has to.
//
// The lock is behind an `AlertDialog` that says the two things a student needs before an
// irreversible press: it is permanent, and the assistant unlocks with it. That dialog lives in
// `./frame-lock-dialog` and is fetched on the *first focus inside this form*, not on the press
// (B4 / NFR-013, 16 §3.2): Base UI's alert dialog was the only popup on the whole workspace and the
// largest single thing it downloaded, and it was being paid for at first paint — the one moment on
// this screen that matters — to be used once, minutes later. Writing four fields takes those
// minutes, so the chunk is in the module cache long before the press, and the press opens the
// dialog with no round trip. That file carries the rest of the argument.
//
// Nothing on this screen evaluates the frame. FR-041 locks it "without evaluating or commenting",
// so there is no quality hint, no suggestion, no example answer and no readiness mark — only the
// rules FR-040 states: every field filled, three assumptions, and the word limits.

/** FR-040's limits, and the numbers the counters and the messages both name. */
const DECISION_WORDS = 50
const ASSUMPTION_WORDS = 25
const POSITION_WORDS = 100
const ASSUMPTION_COUNT = 3

/** Confidence as it is typed: a whole number, no sign and no decimal point (0 to 100). */
const CONFIDENCE_PATTERN = /^\d{1,3}$/
const DEFAULT_CONFIDENCE = 50

/**
 * One free-text field of the frame: not empty once trimmed, and within its word limit.
 *
 * The limit message does not carry the count, because the counter beside the field already does and
 * a sentence that restates a number on the same line is a second copy of it to keep in step.
 */
const writing = (limit: number) =>
  string().check(
    trim(),
    minLength(1, { error: t('workspace.requiredField') }),
    refine((value: string) => countWords(value) <= limit, {
      error: t('workspace.wordLimit', { limit }),
    }),
  )

const frameSchema = object({
  decision: writing(DECISION_WORDS),
  assumptions: array(writing(ASSUMPTION_WORDS)).check(
    length(ASSUMPTION_COUNT, { error: t('workspace.requiredField') }),
  ),
  position: writing(POSITION_WORDS),
  // Held as text, like every other number in this codebase's forms (`MappingEditor`): a half-typed
  // number is a string, and coercing on every keystroke would fight the person typing "100".
  confidence: string().check(
    refine((value: string) => CONFIDENCE_PATTERN.test(value.trim()), {
      error: t('workspace.confidenceInvalid'),
    }),
    refine((value: string) => !CONFIDENCE_PATTERN.test(value.trim()) || Number(value) <= 100, {
      error: t('workspace.confidenceInvalid'),
    }),
  ),
})

type FrameValues = output<typeof frameSchema>

const EMPTY: FrameValues = {
  decision: '',
  assumptions: Array.from({ length: ASSUMPTION_COUNT }, () => ''),
  position: '',
  confidence: String(DEFAULT_CONFIDENCE),
}

/** The paths `FRAME_INVALID` can name (10 §6), and the only ones a refusal is bound to. */
const FIELD_PATHS = [
  'decision',
  'assumptions.0',
  'assumptions.1',
  'assumptions.2',
  'position',
  'confidence',
] as const
type FramePath = (typeof FIELD_PATHS)[number]

const isFramePath = (value: string): value is FramePath =>
  (FIELD_PATHS as readonly string[]).includes(value)

/** The word limit behind a server-named field, for the `word_limit` refusal's message. */
function limitOf(field: FramePath): number {
  if (field === 'decision') return DECISION_WORDS
  if (field === 'position') return POSITION_WORDS
  return ASSUMPTION_WORDS
}

/** `FRAME_INVALID`'s `details` (10 §6): which field, and which of FR-040's rules it broke. */
function frameRefusal(details: unknown): { field: FramePath; message: string } | null {
  if (typeof details !== 'object' || details === null) return null
  const { field, reason } = details as { field?: unknown; reason?: unknown }
  if (typeof field !== 'string' || !isFramePath(field)) return null
  if (field === 'confidence') return { field, message: t('workspace.confidenceInvalid') }
  if (reason === 'word_limit') {
    return { field, message: t('workspace.wordLimit', { limit: limitOf(field) }) }
  }
  return { field, message: t('workspace.requiredField') }
}

/** Module-scope, so the bundler can match this call site to the confirmation's own chunk. */
const loadLockDialog = () => import('./frame-lock-dialog')

export type FrameFormProps = {
  runId: string
}

export function FrameForm({ runId }: FrameFormProps) {
  const router = useRouter()
  const {
    control,
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<FrameValues>({ resolver: zodResolver(frameSchema), defaultValues: EMPTY })

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [locking, setLocking] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // The confirmation's own chunk. `request` is called on the first focus inside the form — the
  // student is about to spend minutes writing — and again on the press, which is what retries a
  // failed import. Both are safe to call repeatedly; the hook starts one import and no more.
  const {
    loaded: lockDialog,
    status: lockDialogStatus,
    request: requestLockDialog,
  } = useDeferredModule(loadLockDialog)
  const LockDialog = lockDialog?.FrameLockDialog

  // A confirmation that never arrives must not leave a student pressing a button that does nothing,
  // and must never be answered by locking the frame anyway. Both of these are read from the import's
  // own status rather than copied into state: a failure is not a fact about the frame, it is the
  // fact that the module is not here yet, and the press is what asks for it again.
  //
  // The frame passed every rule and the confirmation has not landed. Normally never true: the focus
  // that started the writing started the fetch, minutes ago.
  const waitingForConfirm = confirmOpen && lockDialogStatus === 'loading'
  const confirmUnavailable = confirmOpen && lockDialogStatus === 'failed'

  // One subscription per field rather than one over the form: `useWatch` with a name answers the
  // field's own type, and `watch()` returns a function the React Compiler cannot memoize around.
  const decision = useWatch({ control, name: 'decision' })
  const assumptions = useWatch({ control, name: 'assumptions' })
  const position = useWatch({ control, name: 'position' })
  const confidence = useWatch({ control, name: 'confidence' })

  // The slider and the number are one value: the box holds the text, and the slider is that text
  // read as a number. While the text is not a number — the box is empty, or half-way through
  // "100" — the slider holds the last position it was in rather than jumping to a value nobody
  // chose. That fallback is a position on a track, not a second copy of the answer: what is locked
  // is always what the box says.
  const parsedConfidence = CONFIDENCE_PATTERN.test(confidence.trim())
    ? Math.min(100, Number(confidence))
    : null
  const [heldConfidence, setHeldConfidence] = useState(DEFAULT_CONFIDENCE)
  if (parsedConfidence !== null && parsedConfidence !== heldConfidence) {
    setHeldConfidence(parsedConfidence)
  }
  const sliderValue = parsedConfidence ?? heldConfidence

  function lock(): void {
    if (locking) return
    setLocking(true)
    setFormError(null)
    void lockFrameAction({
      runId,
      decision,
      assumptions,
      position,
      confidence: Number(confidence),
    }).then(
      (result) => {
        if (result.ok) {
          // The run is in `working` now and the action has already invalidated this route; the
          // server render decides what stands here next. `locking` stays true so the button keeps
          // saying so until the new tree arrives.
          setConfirmOpen(false)
          router.refresh()
          return
        }
        setLocking(false)
        setConfirmOpen(false)
        if (result.error.code === 'FRAME_INVALID') {
          const refusal = frameRefusal(result.error.details)
          if (refusal) {
            setError(refusal.field, { message: refusal.message }, { shouldFocus: true })
            return
          }
        }
        if (result.error.code === 'ILLEGAL_TRANSITION') {
          // The frame was locked somewhere else — another tab, or a second press that landed
          // first. The screen is behind the run rather than wrong; the refresh catches it up.
          setFormError(t('workspace.lockMoved'))
          router.refresh()
          return
        }
        setFormError(result.error.message || t('workspace.lockFailed'))
      },
      () => {
        setLocking(false)
        setConfirmOpen(false)
        setFormError(t('workspace.lockFailed'))
      },
    )
  }

  return (
    <Panel
      id="frame-form"
      title={t('workspace.frameTitle')}
      description={t('workspace.frameDescription')}
      headingLevel={2}
      padding="reading"
    >
      <form
        noValidate
        // The first focus inside the frame is the earliest honest signal that this student is going
        // to lock something, and it is minutes ahead of the press. The confirmation is fetched from
        // here so that the press itself waits for nothing.
        //
        // Once, and never again after a failure: a retry belongs to the press that is asking for the
        // dialog, so that a fetch which succeeds on the fifth keystroke cannot open a confirmation
        // over a student who is still writing.
        onFocusCapture={() => {
          if (lockDialogStatus === 'idle' && LockDialog === undefined) requestLockDialog()
        }}
        onSubmit={(event) =>
          void handleSubmit(() => {
            setFormError(null)
            requestLockDialog()
            setConfirmOpen(true)
          })(event)
        }
        className="flex flex-col gap-6"
      >
        <WritingField
          id="frame-decision"
          label={t('workspace.decisionLabel')}
          hint={t('workspace.decisionHint')}
          limit={DECISION_WORDS}
          rows={3}
          value={decision}
          error={errors.decision?.message}
          registration={register('decision')}
        />

        {/* The three share one rule, so they share one legend and one statement of it; the
            fieldset points at that sentence so it is read on the way in rather than skipped. */}
        <fieldset aria-describedby="frame-assumptions-hint" className="flex min-w-0 flex-col gap-4">
          <legend className="text-ink text-body mb-1 font-medium">
            {t('workspace.assumptionsLegend')}
          </legend>
          <p id="frame-assumptions-hint" className="text-ink-muted text-meta -mt-3 max-w-[72ch]">
            {t('workspace.assumptionsHint')}
          </p>
          {assumptions.map((assumption, index) => (
            <WritingField
              key={`assumption-${String(index)}`}
              id={`frame-assumption-${String(index)}`}
              label={t('workspace.assumptionLabel', { number: index + 1 })}
              limit={ASSUMPTION_WORDS}
              rows={2}
              value={assumption}
              error={errors.assumptions?.[index]?.message}
              registration={register(`assumptions.${index}` as const)}
            />
          ))}
        </fieldset>

        <WritingField
          id="frame-position"
          label={t('workspace.positionLabel')}
          hint={t('workspace.positionHint')}
          limit={POSITION_WORDS}
          rows={5}
          value={position}
          error={errors.position?.message}
          registration={register('position')}
        />

        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="text-ink text-body mb-1 font-medium">
            {t('workspace.confidenceLegend')}
          </legend>
          <p id="frame-confidence-hint" className="text-ink-muted text-meta -mt-1 max-w-[72ch]">
            {t('workspace.confidenceHint')}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            {/* A native range: keyboard-operable everywhere, 40 px of target, and the accent
                colour is the product's one action colour. There is no slider primitive in the
                component inventory (09 §3) and this needs none. */}
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={sliderValue}
              aria-label={t('workspace.confidenceSlider')}
              aria-describedby="frame-confidence-hint"
              onChange={(event) => {
                setValue('confidence', event.target.value, { shouldValidate: false })
              }}
              className="accent-primary h-10 min-w-48 flex-1 cursor-pointer"
            />
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              aria-label={t('workspace.confidenceNumber')}
              aria-invalid={errors.confidence ? true : undefined}
              aria-describedby={
                errors.confidence ? 'frame-confidence-error' : 'frame-confidence-hint'
              }
              className="w-24 font-mono tabular-nums"
              {...register('confidence')}
            />
          </div>
          <FieldError id="frame-confidence-error">{errors.confidence?.message}</FieldError>
        </fieldset>

        <FormAlert
          message={confirmUnavailable ? t('workspace.lockConfirmUnavailable') : formError}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            aria-disabled={locking ? true : undefined}
            aria-busy={locking || waitingForConfirm}
          >
            {locking && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
            {locking ? t('workspace.lockPending') : t('workspace.lock')}
          </Button>
          {/* Only ever seen by a student whose confirmation is still in flight when they press —
              the focus above has normally had minutes to fetch it — and never in place of the
              dialog, which still says what the lock does before anything is locked. */}
          {waitingForConfirm && (
            <p role="status" className="text-ink-muted text-meta">
              {t('workspace.lockConfirmLoading')}
            </p>
          )}
        </div>
      </form>

      {LockDialog !== undefined && (
        <LockDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          locking={locking}
          onConfirm={lock}
        />
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------------------------
// One field of the frame: the label, the writing surface, and the count
// ---------------------------------------------------------------------------------------------

type WritingFieldProps = {
  id: string
  label: string
  hint?: string
  limit: number
  rows: number
  /** The current text, watched, so the count moves with the keystroke rather than with a submit. */
  value: string
  /** The refusal react-hook-form holds, if any; the over-limit message is computed here. */
  error: string | undefined
  registration: UseFormRegisterReturn
}

function WritingField({
  id,
  label,
  hint,
  limit,
  rows,
  value,
  error,
  registration,
}: WritingFieldProps) {
  const words = countWords(value)
  const over = words > limit
  const message = error ?? (over ? t('workspace.wordLimit', { limit }) : undefined)
  const countId = `${id}-count`

  return (
    <Field data-invalid={message ? 'true' : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        rows={rows}
        className={cn('text-reading max-w-[72ch]', over && 'border-red')}
        aria-invalid={message ? true : undefined}
        aria-describedby={`${message ? `${id}-error` : hint ? `${id}-hint` : ''} ${countId}`.trim()}
        {...registration}
      />
      <div className="flex max-w-[72ch] flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
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
