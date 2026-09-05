'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { Loader2Icon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { Panel } from '@/components/layout/panel'
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
import { cn } from '@/lib/cn'
import { DEFAULT_STATUS, type ErrorCode } from '@/lib/errors'
import { t } from '@/lib/i18n/messages/readiness'
import {
  answerReadinessItemAction,
  skipReadinessAction,
  submitReadinessAction,
} from '@/server/modules/runs/actions'
import type { ReadinessItemView } from '@/server/modules/runs/schema'
import { ReadinessItem } from './readiness-item'
import { ReadinessTimer } from './readiness-timer'

// UI-022: the Readiness Check as the student takes it — the clock, the navigator of sixteen items,
// the item itself, and the submit that says what it is closing.
//
// Four things this component holds, and one it does not.
//
//   * **The sixteen answers, in the browser.** Each press writes one answer through
//     `answerReadinessItemAction` and nothing else happens: no revalidation, no re-render of the
//     page, no trace event (an answer is a scratchpad row until the check closes, and FR-017 lets a
//     student change it as often as they like). The screen shows the answer it sent and puts the
//     previous one back if the write is refused, so what is on the radio is always what the server
//     was last told.
//   * **Where the check resumes.** FR-017: a check reopened after the browser closed comes back
//     with its answers, and it opens at the first item that has none.
//   * **The eight-minute clock, as something to display.** The instant belongs to the server
//     (D-042); when the digits reach zero this asks for one early read — `router.refresh()` — so
//     the auto-submit happens now rather than on the next five-second poll, and it says on screen
//     that the check submitted itself.
//   * **The skip, but only where FR-018 puts it.** `skipReadiness` is refused unless a submission
//     has already failed *on our side*, so the control appears only after a submit came back with a
//     5xx code. It is never offered up front: the result never blocks the run, so a skip offered
//     early would turn eight minutes of warm-up into a button.
//
// What it does not hold is anything about being right. No option is marked, no answer is scored,
// and nothing on this screen changes when a student picks the key rather than a distractor
// (FR-012). The reading of the check is the concept map, and it arrives after the check closes.
//
// The confirmation dialog is imported rather than fetched on the press. Deferring a chunk is what
// this codebase does with dialogs nobody may open (B4), but every student presses Submit, and the
// press happens under a clock they cannot pause: a network round trip between "Submit" and the
// dialog is exactly the wrong place to save eight kilobytes.

export type ReadinessCheckProps = {
  runId: string
  /** The sixteen items in position order, each carrying the student's own answer so far. */
  items: readonly ReadinessItemView[]
  /** Milliseconds left when the server answered (`ReadinessView.expiresAt`, read on the server). */
  remainingMs: number
}

/** FR-017: a resumed check opens at the first item with no answer, or at the start when none. */
function firstUnanswered(items: readonly ReadinessItemView[]): number {
  const at = items.findIndex((item) => item.answerKey === null)
  return at === -1 ? 0 : at
}

/**
 * Whether a refused submit was ours rather than the student's — the condition `submitReadiness`
 * arms `flags.readiness_submit_failed` on, read from the one registry both sides share so the
 * control cannot be offered where the service would refuse it.
 */
function isOurFailure(code: ErrorCode): boolean {
  return DEFAULT_STATUS[code] >= 500
}

export function ReadinessCheck({ runId, items, remainingMs }: ReadinessCheckProps) {
  const router = useRouter()
  const navigatorId = useId()
  const hintId = `${navigatorId}-hint`
  const panelId = `${navigatorId}-panel`

  const [answers, setAnswers] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.answerKey])),
  )
  const [current, setCurrent] = useState(() => firstUnanswered(items))
  const [answerFailure, setAnswerFailure] = useState<string | null>(null)
  const [closeFailure, setCloseFailure] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [skipOffered, setSkipOffered] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [expired, setExpired] = useState(false)

  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const panel = useRef<HTMLFieldSetElement | null>(null)
  // Which control the next item change should leave the reader on: the navigator when they moved
  // with the arrow keys (focus stays where their hand is), the item when they pressed Next or
  // Previous (nothing else would tell a screen reader the question had changed). Null on the first
  // paint, so opening the check moves nobody's focus.
  const pendingFocus = useRef<'navigator' | 'panel' | null>(null)

  useEffect(() => {
    const target = pendingFocus.current
    pendingFocus.current = null
    if (target === 'navigator') buttons.current[current]?.focus()
    else if (target === 'panel') panel.current?.focus()
  }, [current])

  // The latest write per item. An answer changed twice in a second can have its two writes answered
  // out of order, and only the later one is allowed to put anything back on the screen.
  const attempt = useRef(new Map<string, number>())

  const item = items[current]
  const answered = useMemo(
    () => items.filter((each) => (answers[each.id] ?? null) !== null).length,
    [items, answers],
  )
  const unanswered = items.length - answered
  const busy = submitting || skipping

  const go = useCallback(
    (index: number, focus: 'navigator' | 'panel'): void => {
      if (index < 0 || index >= items.length) return
      pendingFocus.current = focus
      setCurrent(index)
    },
    [items.length],
  )

  function answer(itemId: string, answerKey: string): void {
    const previous = answers[itemId] ?? null
    const seq = (attempt.current.get(itemId) ?? 0) + 1
    attempt.current.set(itemId, seq)
    setAnswers((held) => ({ ...held, [itemId]: answerKey }))
    setAnswerFailure(null)

    const refuse = (message: string): void => {
      if (attempt.current.get(itemId) !== seq) return
      setAnswers((held) => ({ ...held, [itemId]: previous }))
      setAnswerFailure(message)
    }

    void answerReadinessItemAction({ runId, itemId, answerKey }).then(
      (result) => {
        if (!result.ok) refuse(result.error.message || t('readiness.answerFailed'))
      },
      () => {
        refuse(t('readiness.answerFailed'))
      },
    )
  }

  function submit(): void {
    if (busy) return
    setSubmitting(true)
    setCloseFailure(null)
    void submitReadinessAction({ runId }).then(
      (result) => {
        if (result.ok) {
          // The result page is the next step, and it is where the concept map is read from; the
          // action has already re-rendered the run's own routes.
          router.push(`/runs/${runId}/readiness/result` as Route)
          return
        }
        setSubmitting(false)
        setConfirmOpen(false)
        setCloseFailure(result.error.message || t('readiness.submitFailed'))
        if (isOurFailure(result.error.code)) setSkipOffered(true)
      },
      () => {
        setSubmitting(false)
        setConfirmOpen(false)
        setCloseFailure(t('readiness.submitFailed'))
      },
    )
  }

  function skip(): void {
    if (busy) return
    setSkipping(true)
    setCloseFailure(null)
    void skipReadinessAction({ runId }).then(
      (result) => {
        if (result.ok) {
          router.push(`/runs/${runId}/readiness/result` as Route)
          return
        }
        setSkipping(false)
        setCloseFailure(result.error.message || t('readiness.skipFailed'))
      },
      () => {
        setSkipping(false)
        setCloseFailure(t('readiness.skipFailed'))
      },
    )
  }

  function onNavigatorKeys(event: React.KeyboardEvent<HTMLDivElement>): void {
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowDown: current + 1,
      ArrowLeft: current - 1,
      ArrowUp: current - 1,
      Home: 0,
      End: items.length - 1,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    go(Math.min(items.length - 1, Math.max(0, next)), 'navigator')
  }

  const confirmBody =
    unanswered === 0
      ? t('readiness.confirmAllAnswered')
      : unanswered === 1
        ? t('readiness.confirmOneUnanswered')
        : t('readiness.confirmUnanswered', { count: unanswered })

  return (
    <div className="flex flex-col gap-6">
      <Panel id="readiness-progress">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <p className="text-ink text-body tabular font-medium">
            {t('readiness.progress', { answered, total: items.length })}
          </p>
          <ReadinessTimer
            remainingMs={remainingMs}
            onExpire={() => {
              setExpired(true)
              // The server decides that the check has closed; this only asks it sooner than the
              // RunFrame's five-second poll would.
              router.refresh()
            }}
          />
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {/* A toolbar, which is what a row of buttons the arrow keys walk is: one tab stop, and
              the roving tabindex puts it on the item being shown. */}
          <div
            role="toolbar"
            aria-label={t('readiness.navigatorLabel')}
            aria-orientation="horizontal"
            aria-describedby={hintId}
            onKeyDown={onNavigatorKeys}
            className="flex flex-wrap gap-1"
          >
            {items.map((each, index) => {
              const hasAnswer = (answers[each.id] ?? null) !== null
              const isCurrent = index === current
              return (
                <button
                  key={each.id}
                  type="button"
                  ref={(node) => {
                    buttons.current[index] = node
                  }}
                  tabIndex={isCurrent ? 0 : -1}
                  aria-current={isCurrent ? true : undefined}
                  aria-controls={panelId}
                  aria-label={t(hasAnswer ? 'readiness.itemAnswered' : 'readiness.itemUnanswered', {
                    position: index + 1,
                  })}
                  onClick={() => {
                    go(index, 'navigator')
                  }}
                  className={cn(
                    'text-mono focus-visible:outline-focus size-10 rounded-md border font-mono transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2',
                    isCurrent
                      ? 'border-primary bg-primary text-primary-ink font-medium'
                      : hasAnswer
                        ? 'border-primary bg-primary-soft text-primary'
                        : 'border-line-control bg-paper-raised text-ink-muted hover:bg-paper-sunken',
                  )}
                >
                  {index + 1}
                </button>
              )
            })}
          </div>
          <p id={hintId} className="text-ink-muted text-meta">
            {t('readiness.navigatorHint')}
          </p>
        </div>
      </Panel>

      <Panel id="readiness-item" padding="reading">
        <div className="flex flex-col gap-4">
          <FormAlert message={answerFailure} />
          {item && (
            <ReadinessItem
              key={item.id}
              item={item}
              index={current + 1}
              total={items.length}
              answerKey={answers[item.id] ?? null}
              disabled={expired || busy}
              panelId={panelId}
              panelRef={panel}
              onAnswer={(answerKey) => {
                answer(item.id, answerKey)
              }}
              onPrevious={
                current > 0
                  ? () => {
                      go(current - 1, 'panel')
                    }
                  : undefined
              }
              onNext={
                current < items.length - 1
                  ? () => {
                      go(current + 1, 'panel')
                    }
                  : undefined
              }
            />
          )}
        </div>
      </Panel>

      {expired ? (
        <Panel id="readiness-expired" title={t('readiness.expiredTitle')} headingLevel={2}>
          <p className="text-ink-muted text-reading max-w-[72ch]">{t('readiness.expiredBody')}</p>
        </Panel>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            <FormAlert message={closeFailure} />
            <Button
              type="button"
              aria-disabled={busy ? true : undefined}
              aria-busy={submitting}
              onClick={() => {
                if (busy) return
                setConfirmOpen(true)
              }}
              className="w-fit"
            >
              {submitting && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
              {submitting ? t('readiness.submitPending') : t('readiness.submit')}
            </Button>
          </div>

          {skipOffered && (
            <Panel id="readiness-skip" title={t('readiness.skipTitle')} headingLevel={2}>
              <div className="flex flex-col items-start gap-4">
                <p className="text-ink-muted text-reading max-w-[72ch]">
                  {t('readiness.skipBody')}
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  aria-disabled={busy ? true : undefined}
                  aria-busy={skipping}
                  onClick={() => {
                    if (busy) return
                    skip()
                  }}
                >
                  {skipping && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
                  {skipping ? t('readiness.skipPending') : t('readiness.skip')}
                </Button>
              </div>
            </Panel>
          )}
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('readiness.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>
              {t('readiness.confirmCancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              aria-disabled={submitting ? true : undefined}
              aria-busy={submitting}
              onClick={() => {
                if (submitting) return
                submit()
              }}
            >
              {submitting && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
              {submitting ? t('readiness.submitPending') : t('readiness.confirmSubmit')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
