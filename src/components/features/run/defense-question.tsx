'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon, PencilLineIcon } from 'lucide-react'
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
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format/date-time'
import { useDraft } from '@/lib/hooks/use-draft'
import { t } from '@/lib/i18n/messages/defense'
import {
  answerDefenseQuestionAction,
  completeDefenseAction,
} from '@/server/modules/defense/actions'
import type { DefenseQuestion as Question } from '@/server/modules/defense/schema'

// UI-026: the interview (FR-120 to FR-126).
//
// **One question is open at a time, and it is the first one without an answer.** That is what
// `openDefense` resumes at (FR-126) and what `answerQuestion` answers with, so the screen and the
// service agree about where a student is without either of them being told. Every question is
// listed — a student may read ahead, and hiding the shape of the interview would make it feel like
// an examination rather than a conversation about their own run — but only the current one carries
// a box, because an interview where six textareas are open at once is a form, and a form invites
// going back and polishing an answer that has already been given. An answer is filed once and is
// the record (`QUESTION_ALREADY_ANSWERED`), so the screen never offers a second.
//
// **The follow-up is drawn beneath its question and never in the running order** (D-344, UI-026).
// `run_defense_questions` has a unique `(run_id, seq)`, so a follow-up takes the next free sequence
// at the end and `followUpOf` is what says where it belongs on the screen. `next` from the answer
// endpoint skips it for the same reason. So the list is the top-level questions in sequence, each
// with its own follow-up nested under it, and the current question is the first unanswered by
// sequence — which is where the focus goes when an answer moves it (UI-026 A11y).
//
// **Nothing on the screen says why a follow-up was asked.** D-031 and D-090 are the instrument: an
// answer that named no source, no number and no reason, or one that read the brief back. Telling
// the student which rule fired would hand over the rule, and the Ownership band reads "no follow-up
// was asked" as the good outcome it is (PRD Appendix A). It is labelled "Follow-up" and nothing
// more.
//
// **The duration is the client's measurement to make** (UI-026, `DefenseAnswerInput.durationMs`):
// from the question receiving focus to the press of submit. The server sees one request and cannot
// tell thinking from a closed laptop. It is recorded and never scored on its own, and it is not
// shown back to the student — a visible stopwatch on a stage with no clock would invent a clock.
//
// **A reload does not take the answer being written** (D-360). This is the highest-stakes writing
// in the run and it is written unaided, so there is nothing to reconstruct a lost answer from; five
// thousand characters surrendered to a stray refresh would be Tassl penalising a student for
// Tassl's own gap. The open box is therefore mirrored into the tab's `sessionStorage` as it is
// typed, under the run and the question, and put back on the next mount. It is a convenience
// belonging to one browser tab and never a record: nothing about it reaches the server, the trace,
// or another viewer, and what is filed is what the student pressed submit on. The hook is held
// `active` only while this question is the open one *and* has no answer, so it forgets the draft
// the instant an answer is filed — an answer is immutable (`QUESTION_ALREADY_ANSWERED`) and must
// never reappear as something editable.
//
// **A restored draft does not touch `durationMs`, which keeps measuring this sitting alone.** The
// field is defined as focus-to-submit and stays exactly that: the clock starts at the first focus
// after the reload, so an answer resumed from a draft reports the time spent on it since. The two
// alternatives are both worse. Carrying the elapsed time across the reload would mean storing a
// measurement in a place the student can edit, and would add every minute the tab spent closed to
// a number that claims to be time spent writing. Reporting zero would make a considered answer
// indistinguishable from the empty ones "Finish the defense" files unfocused. So the draft carries
// text and nothing else, and the honest reading of `duration_ms` is unchanged: an interval this
// browser observed, never a total of the thinking behind the answer.
//
// **One polite region for the screen, not one per question** (D-314's rule, one screen along). A
// six-question interview with a live region under every question could speak three sentences at
// once with nobody owning the order; there is one here, and every act — an answer recorded, a
// follow-up added — is announced through it, last message wins.

/** 10 §9: an answer is at most 5,000 characters. Restated; a client never imports a module schema. */
const ANSWER_MAX_CHARS = 5_000

// ---------------------------------------------------------------------------------------------
// One question
// ---------------------------------------------------------------------------------------------

export type DefenseQuestionProps = {
  /** The run this question belongs to; it keys the tab's draft of the open box (D-360). */
  runId: string
  question: Question
  /**
   * The number a student sees, or null for a follow-up: a follow-up is not question seven of an
   * interview with six questions, it is the second thing asked about question three (D-344).
   */
  number: number | null
  /** Whether this is the question with the box on it: the first without an answer. */
  current: boolean
  /** True while this answer is in flight; the parent owns it because the parent owns the write. */
  submitting?: boolean
  /** A refusal about this answer, from the parent. */
  error?: string | null
  /** The press. `durationMs` is from the first focus in this question's box to this call. */
  onAnswer: (input: { text: string; durationMs: number }) => void
  /** The follow-up this question earned, drawn beneath it (FR-123). */
  followUp?: ReactNode
  /**
   * Whether the interview is being resumed onto this question — questions above it are answered.
   *
   * It is the difference between opening the defense and coming back to it (FR-126), and the only
   * thing it changes is that the box is scrolled into view on the first render.
   */
  resumed?: boolean
}

export function DefenseQuestion({
  runId,
  question,
  number,
  current,
  submitting = false,
  error = null,
  onAnswer,
  followUp,
  resumed = false,
}: DefenseQuestionProps) {
  const fieldId = useId()
  const headingId = useId()
  const [text, setText] = useState('')
  const [tooLong, setTooLong] = useState(false)
  const box = useRef<HTMLTextAreaElement | null>(null)

  // The tab's copy of this box while it is open (D-360). `active` is false the moment the answer is
  // filed or this stops being the question being written, which forgets the draft and makes it
  // impossible for a filed answer — immutable, and never offered a second box — to come back as
  // something editable. An empty draft revives as nothing, so the line below never appears for it.
  const draft = useDraft<string>({
    key: `defense.${runId}.${question.runQuestionId}`,
    active: question.answer === null && current,
    revive: (held) => (typeof held === 'string' && held !== '' ? held : null),
    restore: setText,
  })

  // The instant this question first took focus. Null until it does, and reset by the parent
  // unmounting the box when the answer lands.
  const focusedAt = useRef<number | null>(null)

  // The focus moves to the question that has just become current, and never on the first render:
  // a page that grabbed the box on load would take the focus off the h1 the navigation put it on
  // (`use-focus-on-route-change.ts`, 09 §6).
  //
  // What the first render does instead is *scroll* to it, and only when it is not the first question
  // — which is the resume (FR-126). `openDefense` resumes at the first unanswered question and the
  // screen has to as well: a student coming back with five of eight answered otherwise lands at the
  // top of a long list whose only distinguishing mark is a form they cannot see yet. Scrolling
  // without focusing is what lets the page keep its heading for the screen reader and still put the
  // box in front of the eyes (D-354).
  const wasCurrent = useRef<boolean | null>(null)
  useEffect(() => {
    const before = wasCurrent.current
    wasCurrent.current = current
    if (!current) return
    if (before === null) {
      if (resumed) box.current?.scrollIntoView({ block: 'center' })
      return
    }
    if (before) return
    box.current?.focus({ preventScroll: false })
  }, [current, resumed])

  const over = text.length > ANSWER_MAX_CHARS
  const message =
    error ?? (tooLong || over ? t('defense.answerTooLong', { limit: ANSWER_MAX_CHARS }) : null)
  const answer = question.answer

  // A question sits under the panel's h2, and a follow-up sits under its own question, so the two
  // step down one rung each: Subtitle for a question, the same serif at the reading size for a
  // follow-up (DESIGN.md §The Descending-Heading Rule).
  const Heading = number === null ? 'h4' : 'h3'
  const headingClass = number === null ? 'text-reading' : 'text-h4'

  return (
    <li aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {/* The ordinal is a label, not a heading: DESIGN.md's Descending-Heading Rule keeps a
            heading out of `--ink-muted` and never smaller than the prose it introduces, and
            "Question 3" set in meta over a full-size question reads as a caption for it. The
            question itself is the heading, which is also what UI-026 asks for — the interview is a
            list with headings — and it is the loudest thing in the item, as a question should be. */}
        <p className="text-ink-muted text-meta font-medium">
          {number === null
            ? t('defense.followUpHeading')
            : t('defense.questionHeading', { number })}
        </p>
        <Heading id={headingId} className={`${headingClass} max-w-measure`}>
          {question.text}
        </Heading>
      </div>

      {/* The answer, quoted back behind a 1 px hairline — not 2 px: DESIGN.md's borders are
          hairlines and the 2 px left border is reserved for the amber draft mark, which this is
          not. */}
      {answer !== null ? (
        <div className="border-line flex flex-col gap-1 border-l pl-4">
          <p
            className={cn(
              'text-reading max-w-measure whitespace-pre-line',
              answer.text.trim() === '' ? 'text-ink-muted' : 'text-ink',
            )}
          >
            {answer.text.trim() === '' ? t('defense.answerEmpty') : answer.text}
          </p>
          <p className="text-ink-muted text-meta">
            <time dateTime={answer.answeredAt}>
              {t('defense.answeredAt', { when: formatDateTime(answer.answeredAt) })}
            </time>
          </p>
        </div>
      ) : current ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            if (submitting) return
            if (text.length > ANSWER_MAX_CHARS) {
              setTooLong(true)
              return
            }
            setTooLong(false)
            const started = focusedAt.current
            onAnswer({ text, durationMs: started === null ? 0 : Math.max(0, Date.now() - started) })
          }}
          className="flex flex-col gap-3"
        >
          {/* Only when something was actually put back (D-360). It is a visible line the box points
              at rather than an announcement: the screen's one polite region belongs to the acts of
              the interview — an answer recorded, a follow-up added — and a sentence spoken on mount
              would be spoken over by the first of them. Amber is DESIGN.md's draft mark and appears
              here as the icon alone; the text is ink. */}
          {draft.restored && (
            <p
              id={`${fieldId}-draft`}
              className="text-ink text-meta max-w-measure flex items-start gap-2"
            >
              <PencilLineIcon aria-hidden="true" className="text-amber mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">{t('defense.draftRestored')}</span>
            </p>
          )}

          <Field data-invalid={message ? 'true' : undefined}>
            <FieldLabel htmlFor={fieldId}>{t('defense.answerLabel')}</FieldLabel>
            <Textarea
              id={fieldId}
              ref={box}
              rows={6}
              value={text}
              onFocus={() => {
                focusedAt.current ??= Date.now()
              }}
              onChange={(event) => {
                setText(event.target.value)
                draft.save(event.target.value)
                if (tooLong) setTooLong(false)
              }}
              aria-invalid={message ? true : undefined}
              aria-describedby={`${message ? `${fieldId}-error` : `${fieldId}-hint`} ${fieldId}-count${draft.restored ? ` ${fieldId}-draft` : ''}`}
              className={cn('text-reading max-w-measure', over && 'border-red')}
            />
            <div className="max-w-measure flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0 flex-1">
                {message !== null ? (
                  <FieldError id={`${fieldId}-error`}>{message}</FieldError>
                ) : (
                  <FieldDescription id={`${fieldId}-hint`}>
                    {t('defense.answerHint', { limit: ANSWER_MAX_CHARS })}
                  </FieldDescription>
                )}
              </div>
              {/* Read on focus rather than announced: a counter in a live region would talk over
                  the sentence being written (09 §6). */}
              <span
                id={`${fieldId}-count`}
                className={cn(
                  'text-mono-sm shrink-0 font-mono tabular-nums',
                  over ? 'text-red' : 'text-ink-muted',
                )}
              >
                {t('defense.answerCount', { count: text.length, limit: ANSWER_MAX_CHARS })}
              </span>
            </div>
          </Field>

          <Button
            type="submit"
            aria-disabled={submitting ? true : undefined}
            aria-busy={submitting}
            className="w-fit"
          >
            {submitting && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
            {submitting ? t('defense.answerSubmitting') : t('defense.answerSubmit')}
          </Button>
        </form>
      ) : null}

      {followUp !== undefined && (
        <ol className="border-line ml-4 flex flex-col gap-4 border-l pl-4">{followUp}</ol>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------------------------
// The interview
// ---------------------------------------------------------------------------------------------

export type DefenseInterviewProps = {
  runId: string
  /** The questions as `openDefense` selected them, in sequence order (FR-121). */
  questions: readonly Question[]
}

export function DefenseInterview({ runId, questions: initial }: DefenseInterviewProps) {
  const router = useRouter()

  // The questions as this screen knows them: what the server rendered, plus every answer and
  // follow-up the writes below have produced. Re-seeded whenever the server hands over a different
  // list, which is what a reload or a `router.refresh()` does.
  const [seed, setSeed] = useState(initial)
  const [held, setHeld] = useState<readonly Question[]>(initial)
  if (seed !== initial) {
    setSeed(initial)
    setHeld(initial)
  }

  const [answering, setAnswering] = useState<string | null>(null)
  const [error, setError] = useState<{ runQuestionId: string | null; message: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [finishing, setFinishing] = useState(false)
  // A refusal raised by the finish, held apart from the per-question one and rendered *inside* the
  // dialog. `finish()` runs behind an open alert dialog, so a message under the question it came
  // from — or under the list — is a message behind the scrim: the student would see the button
  // revert from "Finishing…" with no explanation, press again, and file more empty answers (D-354).
  const [finishError, setFinishError] = useState<string | null>(null)

  const ordered = [...held].sort((a, b) => a.seq - b.seq)
  const unanswered = ordered.filter((question) => !question.answered)
  const current = unanswered[0] ?? null
  const answered = ordered.length - unanswered.length

  // The top-level questions in sequence, each with the follow-up that belongs under it (D-344).
  const parents = ordered.filter((question) => question.followUpOf === null)
  const followUps = new Map<string, Question>()
  for (const question of ordered) {
    if (question.followUpOf !== null) followUps.set(question.followUpOf, question)
  }

  /**
   * The answer that just landed, and the follow-up it may have earned.
   *
   * `next` from the endpoint is deliberately unused: it is the first question still without an
   * answer, which this list can see for itself once the answered row is marked — and reading it
   * here would be a second opinion about where the interview is, held by the screen.
   */
  function apply(followUp: Question | null, answeredId: string, text: string): void {
    setHeld((rows) => {
      const updated = rows.map((row) =>
        row.runQuestionId === answeredId
          ? { ...row, answered: true, answer: { text, answeredAt: new Date().toISOString() } }
          : row,
      )
      return followUp === null ||
        updated.some((row) => row.runQuestionId === followUp.runQuestionId)
        ? updated
        : [...updated, followUp]
    })
    setAnnouncement(followUp === null ? t('defense.answerRecorded') : t('defense.followUpAsked'))
  }

  /**
   * One answer. `ok` is whether it was recorded; `followUp` is null when none was earned, which is
   * a different fact and is why the two are not one return value.
   */
  async function submit(
    question: Question,
    input: { text: string; durationMs: number },
  ): Promise<{ ok: boolean; followUp: Question | null }> {
    setAnswering(question.runQuestionId)
    setError(null)
    const result = await answerDefenseQuestionAction({
      runId,
      runQuestionId: question.runQuestionId,
      text: input.text,
      durationMs: input.durationMs,
    }).catch(() => null)
    setAnswering(null)

    if (result === null || !result.ok) {
      setError({
        runQuestionId: question.runQuestionId,
        message:
          result === null
            ? t('defense.answerFailed')
            : result.error.message || t('defense.answerFailed'),
      })
      return { ok: false, followUp: null }
    }
    apply(result.data.followUpQuestion, question.runQuestionId, input.text)
    return { ok: true, followUp: result.data.followUpQuestion }
  }

  /**
   * Files an empty answer on everything still unanswered, then finishes (FR-124, UI-026).
   *
   * The loop is not a retry: an empty answer earns a follow-up under D-031 — it names no source, no
   * number and no reason, which is exactly what it is — and that follow-up is itself unanswered.
   * A follow-up never earns one of its own (D-344), so the queue drains in at most two passes.
   */
  async function finish() {
    setFinishing(true)
    setError(null)
    setFinishError(null)

    const queue = [...held].filter((question) => !question.answered).sort((a, b) => a.seq - b.seq)
    let filed = 0
    while (queue.length > 0) {
      const question = queue.shift()
      if (question === undefined) break
      const written = await submit(question, { text: '', durationMs: 0 })
      if (!written.ok) {
        setFinishing(false)
        setFinishError(
          filed === 0
            ? t('defense.finishFailed')
            : `${t('defense.finishFailed')} ${t('defense.finishPartial')}`,
        )
        return
      }
      filed += 1
      if (written.followUp !== null) queue.push(written.followUp)
    }

    const result = await completeDefenseAction({ runId }).catch(() => null)
    if (result === null || !result.ok) {
      setFinishing(false)
      const said =
        result === null
          ? t('defense.finishFailed')
          : result.error.message || t('defense.finishFailed')
      setFinishError(filed === 0 ? said : `${said} ${t('defense.finishPartial')}`)
      return
    }
    setConfirmOpen(false)
    // The run is in `defense_complete` from here; the guard on this page sends the student on.
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      {/* The screen's one polite region. `sr-only` because every act it reports already shows
          itself: the answer appears under its question and the follow-up appears beneath it. */}
      <p id="defense-announcer" role="status" aria-live="polite" className="sr-only empty:hidden">
        {announcement}
      </p>

      <ol className="flex flex-col gap-8">
        {parents.map((question, index) => {
          const followUp = followUps.get(question.runQuestionId)
          return (
            <DefenseQuestion
              key={question.runQuestionId}
              runId={runId}
              question={question}
              number={index + 1}
              current={current?.runQuestionId === question.runQuestionId}
              submitting={answering === question.runQuestionId}
              error={
                error !== null && error.runQuestionId === question.runQuestionId
                  ? error.message
                  : null
              }
              resumed={index > 0}
              onAnswer={(input) => {
                void submit(question, input)
              }}
              {...(followUp === undefined
                ? {}
                : {
                    followUp: (
                      <DefenseQuestion
                        runId={runId}
                        question={followUp}
                        number={null}
                        current={current?.runQuestionId === followUp.runQuestionId}
                        submitting={answering === followUp.runQuestionId}
                        error={
                          error !== null && error.runQuestionId === followUp.runQuestionId
                            ? error.message
                            : null
                        }
                        onAnswer={(input) => {
                          void submit(followUp, input)
                        }}
                      />
                    ),
                  })}
            />
          )
        })}
      </ol>

      <div className="border-line flex flex-wrap items-center gap-4 border-t pt-6">
        {/* The accent belongs to the act, and while questions are still open the act is answering
            one (DESIGN.md §Do's, D-323's reading one screen along). Finishing stays reachable from
            the first second, because FR-124 allows a student to finish with answers they chose not
            to give — it simply stops wearing the teal until it is the thing left to do. */}
        <Button
          type="button"
          variant={unanswered.length === 0 ? 'primary' : 'secondary'}
          aria-disabled={finishing ? true : undefined}
          aria-busy={finishing}
          onClick={() => {
            setFinishError(null)
            setConfirmOpen(true)
          }}
        >
          {finishing ? t('defense.finishing') : t('defense.finish')}
        </Button>
        <p className="text-ink-muted text-meta font-mono tabular-nums">
          {t('defense.questionsProgress', { answered, total: ordered.length })}
        </p>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('defense.finishConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {unanswered.length === 0
                ? t('defense.finishConfirmBody')
                : unanswered.length === 1
                  ? t('defense.finishConfirmUnansweredOne')
                  : t('defense.finishConfirmUnansweredMany', { count: unanswered.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Inside the dialog, because that is where the student is standing when it fails. */}
          <FormAlert message={finishError} />

          <AlertDialogFooter>
            <AlertDialogCancel disabled={finishing}>{t('defense.finishCancel')}</AlertDialogCancel>
            <AlertDialogAction
              aria-disabled={finishing ? true : undefined}
              aria-busy={finishing}
              onClick={(event) => {
                event.preventDefault()
                if (finishing) return
                void finish()
              }}
            >
              {finishing && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
              {finishing ? t('defense.finishing') : t('defense.finishConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
