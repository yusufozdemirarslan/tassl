'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format/date-time'
// The debrief namespace alone, not the composed catalogue: this is the one Client Component on the
// page, and a `@/lib/i18n/t` here would ship every namespace to the browser to label two textareas
// (16 §3.4, D-221).
import { t } from '@/lib/i18n/messages/debrief'
import { countWords } from '@/lib/words'
import { answerDebriefAction } from '@/server/modules/debrief/actions'

// UI-028 → "Two questions" (FR-152).
//
// The two answers close the run: on a confirmed run, filing them moves it to Recorded. Nobody marks
// them, and the form says so — they are the student's own reflection, and the instructor can read
// them.
//
// **Three states, and the server decides which.** `answered` is the filed pair, shown as prose with
// the date; `canAnswer` false is a reviewer reading the student's page (FR-154), who sees the
// questions and no form; the form itself is the third. The screen never infers the reviewer from a
// role, because the module already knows and one of the two would eventually be wrong.
//
// The limit is checked here with the same `countWords` the server's `wordLimit(100)` runs inside
// `DebriefAnswersSchema`, so the counter and the refusal cannot disagree. A server refusal still
// lands in the alert above the button: the client check is a courtesy, never the rule.

/** FR-152's hundred words per answer (`DebriefAnswersSchema`), restated for the counter. */
const WORD_LIMIT = 100

export type DebriefQuestionsProps = {
  runId: string
  answered: boolean
  canAnswer: boolean
  stanceToChange: string | null
  doDifferently: string | null
  answeredAt: string | null
}

export function DebriefQuestions({
  runId,
  answered,
  canAnswer,
  stanceToChange,
  doDifferently,
  answeredAt,
}: DebriefQuestionsProps) {
  const router = useRouter()
  const fieldId = useId()
  const [stance, setStance] = useState('')
  const [different, setDifferent] = useState('')
  const [filing, setFiling] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)

  // Where the caret goes when the answers are filed (D-500). The press revalidates this route, the
  // server render replaces the form with the two answers, and the button that was pressed goes with
  // it — leaving a keyboard user on `document.body`, from which WebKit's Tab moves nothing at all.
  // This is the last act of a run, so nothing downstream noticed. The caret lands on the first
  // filed answer's own heading, which is the `useFocusOnRouteChange` idiom applied to a screen that
  // changed without navigating: the student hears what they filed, in their own question's words.
  //
  // Only when the caret was actually dropped — an engine that put it somewhere real is not fought,
  // and a reader who moved on while the write was in flight keeps the place they chose.
  const filed = useRef<HTMLHeadingElement>(null)
  const wasAnswered = useRef(answered)
  useEffect(() => {
    const before = wasAnswered.current
    wasAnswered.current = answered
    if (before || !answered) return
    if (document.activeElement !== null && document.activeElement !== document.body) return
    filed.current?.focus()
  }, [answered])

  if (answered) {
    return (
      <div className="flex flex-col gap-6">
        <FiledAnswer
          ref={filed}
          label={t('debrief.questions.stanceToChange.label')}
          answer={stanceToChange}
        />
        <FiledAnswer label={t('debrief.questions.doDifferently.label')} answer={doDifferently} />
        {answeredAt !== null && (
          <p className="text-ink-muted text-meta font-mono tabular-nums">
            {t('debrief.questions.answeredAt', { when: formatDateTime(answeredAt) })}
          </p>
        )}
        <p className="text-ink-muted text-body max-w-measure">
          {t('debrief.questions.answeredNote')}
        </p>
      </div>
    )
  }

  if (!canAnswer) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-ink text-reading max-w-measure">
          {t('debrief.questions.stanceToChange.label')}
        </p>
        <p className="text-ink text-reading max-w-measure">
          {t('debrief.questions.doDifferently.label')}
        </p>
        <p className="text-ink-muted text-body max-w-measure">{t('debrief.questions.readOnly')}</p>
      </div>
    )
  }

  const stanceWords = countWords(stance)
  const differentWords = countWords(different)
  const stanceOver = stanceWords > WORD_LIMIT
  const differentOver = differentWords > WORD_LIMIT
  const empty = stance.trim().length === 0 || different.trim().length === 0

  function file(): void {
    if (filing) return
    if (empty || stanceOver || differentOver) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setRefused(null)
    setFiling(true)
    void answerDebriefAction({
      runId,
      stanceToChange: stance.trim(),
      doDifferently: different.trim(),
    }).then(
      (result) => {
        setFiling(false)
        if (!result.ok) {
          setRefused(result.error.message || t('debrief.questions.refused'))
          return
        }
        // The action revalidated this route and the run's status page; the server render is what
        // replaces the form with the two answers and moves the run on.
        router.refresh()
      },
      () => {
        setFiling(false)
        setRefused(t('debrief.questions.refused'))
      },
    )
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        file()
      }}
      className="flex flex-col gap-6"
    >
      <AnswerField
        id={`${fieldId}-stance`}
        label={t('debrief.questions.stanceToChange.label')}
        help={t('debrief.questions.stanceToChange.help')}
        value={stance}
        words={stanceWords}
        over={stanceOver}
        showRequired={invalid && stance.trim().length === 0}
        onChange={(next) => {
          setStance(next)
          setInvalid(false)
        }}
      />
      <AnswerField
        id={`${fieldId}-different`}
        label={t('debrief.questions.doDifferently.label')}
        help={t('debrief.questions.doDifferently.help')}
        value={different}
        words={differentWords}
        over={differentOver}
        showRequired={invalid && different.trim().length === 0}
        onChange={(next) => {
          setDifferent(next)
          setInvalid(false)
        }}
      />

      <FormAlert message={refused} />

      <div className="flex flex-col items-start gap-2">
        <Button type="submit" aria-disabled={filing ? true : undefined} aria-busy={filing}>
          {filing && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
          {filing ? t('debrief.questions.pending') : t('debrief.questions.submit')}
        </Button>
      </div>
    </form>
  )
}

function FiledAnswer({
  label,
  answer,
  ref,
}: {
  label: string
  answer: string | null
  /** Set on the first of the two: the heading the caret lands on when the pair is filed (D-500). */
  ref?: React.Ref<HTMLHeadingElement>
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3
        ref={ref}
        tabIndex={ref === undefined ? undefined : -1}
        className="text-h4 focus-visible:outline-focus max-w-full rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {label}
      </h3>
      <p className="text-ink text-reading max-w-measure break-words whitespace-pre-line">
        {answer ?? ''}
      </p>
    </div>
  )
}

type AnswerFieldProps = {
  id: string
  label: string
  help: string
  value: string
  words: number
  over: boolean
  showRequired: boolean
  onChange: (next: string) => void
}

function AnswerField({
  id,
  label,
  help,
  value,
  words,
  over,
  showRequired,
  onChange,
}: AnswerFieldProps) {
  const message = over
    ? t('debrief.questions.tooLong', { limit: WORD_LIMIT })
    : showRequired
      ? t('debrief.questions.required')
      : null
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const countId = `${id}-count`

  return (
    <Field data-invalid={message ? 'true' : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        rows={4}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        aria-invalid={message ? true : undefined}
        aria-describedby={`${message ? errorId : hintId} ${countId}`}
        className={cn('text-reading max-w-measure', over && 'border-red')}
      />
      <div className="max-w-measure flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          {message === null ? (
            <FieldDescription id={hintId}>{help}</FieldDescription>
          ) : (
            <FieldError id={errorId}>{message}</FieldError>
          )}
        </div>
        {/* Read on focus rather than announced: a counter in a live region talks over the sentence
            being written (09 §6). */}
        <span
          id={countId}
          className={cn(
            'text-mono-sm shrink-0 font-mono tabular-nums',
            over ? 'text-red' : 'text-ink-muted',
          )}
        >
          {t('debrief.questions.wordCount', { count: words, limit: WORD_LIMIT })}
        </span>
      </div>
    </Field>
  )
}
