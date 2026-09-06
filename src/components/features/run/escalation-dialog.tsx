'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/messages/workspace'
import { countWords, stripMarkup } from '@/lib/words'
import { escalateAction } from '@/server/modules/reliance/actions'
import type { EscalationResult } from '@/server/modules/reliance/schema'

// UI-023: escalation (FR-090 to FR-093, D-089, D-116, D-244).
//
// One sentence about what the student cannot settle, five minutes of the working clock, and a
// colleague's answer. Everything this dialog says is about the *run* and never about the claim.
//
// **It never says which claims are worth escalating.** `canEscalate` is the run's remaining
// escalations — a number that is the same on every card — and not the claim's authored
// `escalatable`, which 12 §8.1 keeps out of every student view (D-244) and which this component is
// therefore never handed. The reply it shows carries neither `responseId` nor `countsAgainstLimit`
// (D-116): a student who could see which of their escalations counted could read defect placement
// off the bookkeeping, so the payload does not carry those fields at all and there is nothing here
// to leak. What the dialog reports afterwards is what came back and how many escalations are left.
//
// **The rule is D-089's, counted with the server's own functions.** Three words to 280 characters,
// measured after `stripMarkup`, which is what `escalate` measures too — so the counter under the
// box and the refusal from the service cannot disagree. The bounds are restated here rather than
// imported from the module schema, because a client component never imports one (D-186).
//
// A dialog rather than a disclosure, unlike the outside-tool declaration: this one spends five
// minutes of a clock the student cannot get back, so it is worth taking the screen for the moment
// it takes to write the sentence — and the cost is in the dialog's own description, in front of the
// press.

/** D-089, restated: one sentence, at least three words, at most 280 characters. */
const STATEMENT_MAX_CHARS = 280
const STATEMENT_MIN_WORDS = 3

export type EscalationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  runId: string
  claimId: string
  claimKey: string
  /** `ClaimView.remainingEscalations` — a fact about the run, repeated on every claim (D-244). */
  remainingEscalations: number
  /** False while the run is paused. */
  canWrite: boolean
  onEscalated: (result: EscalationResult) => void
}

export function EscalationDialog({
  open,
  onOpenChange,
  runId,
  claimId,
  claimKey,
  remainingEscalations,
  canWrite,
  onEscalated,
}: EscalationDialogProps) {
  const [statement, setStatement] = useState('')
  const [sending, setSending] = useState(false)
  const [invalid, setInvalid] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ message: string; requestId?: string } | null>(null)

  const stripped = stripMarkup(statement)
  const characters = stripped.length
  const over = characters > STATEMENT_MAX_CHARS
  const message =
    invalid ?? (over ? t('workspace.escalateTooLong', { limit: STATEMENT_MAX_CHARS }) : null)

  function send(): void {
    if (sending || !canWrite) return
    if (countWords(stripped) < STATEMENT_MIN_WORDS) {
      setInvalid(t('workspace.escalateTooShort'))
      return
    }
    if (characters > STATEMENT_MAX_CHARS) {
      setInvalid(t('workspace.escalateTooLong', { limit: STATEMENT_MAX_CHARS }))
      return
    }
    setInvalid(null)
    setFailed(null)
    setSending(true)
    void escalateAction({ runId, claimId, statement: stripped }).then(
      (result) => {
        setSending(false)
        if (!result.ok) {
          setFailed({
            message: result.error.message || t('workspace.escalateFailed'),
            requestId: result.error.requestId,
          })
          return
        }
        setStatement('')
        onOpenChange(false)
        onEscalated(result.data)
      },
      () => {
        setSending(false)
        setFailed({ message: t('workspace.escalateFailed') })
      },
    )
  }

  const remainingSentence =
    remainingEscalations === 0
      ? t('workspace.escalateNoneLeft')
      : remainingEscalations === 1
        ? t('workspace.escalateRemainingOne')
        : t('workspace.escalateRemaining', { count: remainingEscalations })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('workspace.escalateTitle')}</DialogTitle>
          <DialogDescription>{t('workspace.escalateBody')}</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            send()
          }}
          className="flex flex-col gap-4"
        >
          <Field data-invalid={message ? 'true' : undefined}>
            <FieldLabel htmlFor="escalation-statement">
              {t('workspace.escalateStatementLabel')}
              <span className="sr-only"> {t('workspace.escalateFor', { key: claimKey })}</span>
            </FieldLabel>
            <Textarea
              id="escalation-statement"
              rows={3}
              value={statement}
              autoFocus
              onChange={(event) => {
                setStatement(event.target.value)
                if (invalid !== null) setInvalid(null)
              }}
              aria-invalid={message ? true : undefined}
              aria-describedby={`${message ? 'escalation-error' : 'escalation-hint'} escalation-count`}
              className={cn('text-reading', over && 'border-red')}
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0 flex-1">
                {message ? (
                  <FieldError id="escalation-error">{message}</FieldError>
                ) : (
                  <FieldDescription id="escalation-hint">
                    {t('workspace.escalateStatementHint', { limit: STATEMENT_MAX_CHARS })}
                  </FieldDescription>
                )}
              </div>
              {/* Read on focus rather than announced: a counter in a live region would talk over
                  the sentence being written (09 §6). */}
              <span
                id="escalation-count"
                className={cn(
                  'text-mono-sm shrink-0 font-mono tabular-nums',
                  over ? 'text-red' : 'text-ink-muted',
                )}
              >
                {t('workspace.assistantCharCount', {
                  count: characters,
                  limit: STATEMENT_MAX_CHARS,
                })}
              </span>
            </div>
          </Field>

          {/* The run's own count, which is the same on every claim in the run — which is exactly
              what keeps it from saying anything about this one (D-244). */}
          <p className="text-ink-muted text-meta">{remainingSentence}</p>

          {failed !== null && (
            <FormAlert
              message={failed.message}
              reference={
                failed.requestId === undefined
                  ? undefined
                  : { label: t('workspace.errorReference'), id: failed.requestId }
              }
            />
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onOpenChange(false)
              }}
            >
              {t('workspace.escalateCancel')}
            </Button>
            <Button
              type="submit"
              aria-disabled={sending || !canWrite ? true : undefined}
              aria-busy={sending}
            >
              {sending && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
              {sending ? t('workspace.escalateSending') : t('workspace.escalateSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
