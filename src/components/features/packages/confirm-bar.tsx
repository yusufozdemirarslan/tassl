'use client'

import { useEffect, useRef, useState } from 'react'
import {
  BadgeCheckIcon,
  Loader2Icon,
  OctagonXIcon,
  RotateCwIcon,
  SaveIcon,
  Undo2Icon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/lib/i18n/messages/package-confirm'

// The bar at the foot of the editor (UI-043): the four things an author does to one element.
//
// Regenerate is the fourth, and it is not a fourth decision — it is work sent back to the pipeline
// (FR-194). Three things about it are said on the screen rather than left to be discovered:
//
//   *It replaces a set, not a line.* A generation step writes every element of its type at once, so
//   regenerating one document re-runs the documents step and replaces every document in this
//   version that nobody has confirmed. The sentence above the field says so before the press.
//
//   *A confirmed element is never written over.* `regenerateElement` refuses one (10 §5), because a
//   step that overwrote a signature would destroy the review FR-192 exists to require. The control
//   stays reachable and says the way through: reject it first, and the regeneration replaces it.
//
//   *The note travels.* What the author says is wrong with the element goes into the prompt through
//   the channel a rule the last pass could not satisfy goes through — from the model's side they are
//   the same thing (D-534) — so the field asks for what the new draft has to get right, not for a
//   complaint about the old one.
//
// Two guards, and they are the same guard: an edit is never lost.
//
//   Confirming while the form holds unsaved changes would file a decision against the values on the
//   server, not the values on the screen — so Confirm and Reject stay reachable and say why they
//   cannot act yet, and "Discard edits" is offered beside them for the author who meant to abandon
//   the change. `aria-disabled`, never `disabled`: the reason has to be readable by whoever is
//   being refused (DESIGN.md §Buttons → Disabled).
//
//   Saving *is* a decision. `updateElement` writes an `edited` confirmation when the author is the
//   institution's own authority (10 §4), so "Save edits" settles the element as surely as Confirm
//   does; the label says "Save edits" because that is what the author is doing, and the toast says
//   what it recorded.
//
// The row is a named `group`, not a `toolbar`. A toolbar owes the reader a roving tab stop, and
// that is the wrong trade here: three or four buttons at the foot of a form are the form's own
// footer, Confirm and Reject are each a separate consequential press, and one of them appears and
// disappears with the draft. Every button keeps its native tab stop, which is what a dialog footer
// does and what the author's fingers already expect; the group's label is what says the four
// belong together.
//
// The bar holds the state of the rejection it is composing, which is state about *one* element —
// the editor above is keyed by the element, so this unmounts with it and a note typed against C3
// can never be filed against D4.

/** `RegenerateElementSchema` caps the restated rule at 2,000 characters (10 §5). */
const REGENERATE_RULE_MAX = 2000

export type ConfirmBarPending = 'save' | 'confirm' | 'reject' | 'regenerate' | null

export type ConfirmBarProps = {
  elementName: string
  /** The editor holds changes that have not reached the server. */
  dirty: boolean
  /** The element is confirmed and has not been reopened, or the version is frozen. */
  locked: boolean
  /** 08 §4: nobody at Tassl signs in place of the institution's own authority. */
  canDecide: boolean
  /** The seat may generate, the version is a draft, and a step owns this element's type (FR-194). */
  canRegenerate: boolean
  /** A confirmation stands on the server: a new draft is refused until the element is rejected. */
  settled: boolean
  /** What is rewritten with it, in the author's words: "every document in this version". */
  regenerateScope: string
  /** A new draft is being written for this version: nothing on any element may be recorded yet. */
  regenerationRunning: boolean
  pending: ConfirmBarPending
  onSave: () => void
  onDiscard: () => void
  onConfirm: () => void
  onReject: (note: string) => void
  onRegenerate: (restatedRule: string) => void
}

export function ConfirmBar({
  elementName,
  dirty,
  locked,
  canDecide,
  canRegenerate,
  settled,
  regenerateScope,
  regenerationRunning,
  pending,
  onSave,
  onDiscard,
  onConfirm,
  onReject,
  onRegenerate,
}: ConfirmBarProps) {
  // One disclosure, not two booleans: Reject and Regenerate each open a panel with a textarea and
  // a consequential submit, and two of those at the foot of one form — a red "Reject element" over
  // a half-written note, beside a live "Rewrite" — is a foot nobody should have to read twice.
  const [panel, setPanel] = useState<'reject' | 'regenerate' | null>(null)
  const rejecting = panel === 'reject'
  const regenerating = panel === 'regenerate'

  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const noteField = useRef<HTMLTextAreaElement>(null)

  const [rule, setRule] = useState('')
  const ruleField = useRef<HTMLTextAreaElement>(null)

  // The trigger a panel was opened from. Closing a panel unmounts the control the press landed on,
  // so the focus is handed back before it goes rather than left to fall to the document — which is
  // exactly the moment an asynchronous thing starts and a keyboard reader most needs their place.
  const rejectTrigger = useRef<HTMLButtonElement>(null)
  const regenerateTrigger = useRef<HTMLButtonElement>(null)

  const close = (): void => {
    const trigger = panel === 'reject' ? rejectTrigger.current : regenerateTrigger.current
    setPanel(null)
    trigger?.focus()
  }

  useEffect(() => {
    if (rejecting) noteField.current?.focus()
  }, [rejecting])

  useEffect(() => {
    if (regenerating) ruleField.current?.focus()
  }, [regenerating])

  const busy = pending !== null
  const blocked = dirty ? t('confirm.unsavedBeforeDecide') : null
  const outstanding = regenerationRunning ? t('confirm.regenerateBusy') : null
  /** Whichever refusal stands: the work in flight first, then the edits that have not landed. */
  const reason =
    outstanding !== null ? 'confirm-bar-busy' : blocked !== null ? 'confirm-bar-blocked' : undefined
  const overLimit = rule.trim().length > REGENERATE_RULE_MAX

  return (
    <div className="border-line flex flex-col gap-3 border-t pt-4">
      <div
        role="group"
        aria-label={t('confirm.toolbarLabel')}
        className="flex flex-wrap items-center gap-2"
      >
        {/* One accent, on the act an author is here to take ninety-odd times: the decision. Saving
            is housekeeping and is inert on most elements, so it takes the secondary treatment
            rather than the screen's one teal fill (DESIGN.md §Do's). */}
        <Button
          type="button"
          variant="secondary"
          aria-disabled={!dirty || busy || regenerationRunning ? true : undefined}
          aria-busy={pending === 'save'}
          aria-describedby={dirty ? reason : 'confirm-bar-nothing'}
          onClick={() => {
            if (dirty && !busy && !regenerationRunning) onSave()
          }}
        >
          {pending === 'save' ? (
            <Loader2Icon aria-hidden="true" className="animate-spin" />
          ) : (
            <SaveIcon aria-hidden="true" />
          )}
          {pending === 'save' ? t('confirm.savePending') : t('confirm.save')}
        </Button>

        {dirty && (
          <Button
            type="button"
            variant="ghost"
            aria-disabled={busy ? true : undefined}
            onClick={() => {
              if (!busy) onDiscard()
            }}
          >
            <Undo2Icon aria-hidden="true" />
            {t('confirm.discard')}
          </Button>
        )}

        <Button
          type="button"
          aria-disabled={
            dirty || busy || locked || !canDecide || regenerationRunning ? true : undefined
          }
          aria-busy={pending === 'confirm'}
          aria-describedby={reason}
          onClick={() => {
            if (!dirty && !busy && !locked && canDecide && !regenerationRunning) onConfirm()
          }}
        >
          {pending === 'confirm' ? (
            <Loader2Icon aria-hidden="true" className="animate-spin" />
          ) : (
            <BadgeCheckIcon aria-hidden="true" />
          )}
          {pending === 'confirm' ? t('confirm.confirmPending') : t('confirm.confirmElement')}
        </Button>

        <Button
          type="button"
          ref={rejectTrigger}
          variant="secondary"
          aria-expanded={rejecting}
          aria-disabled={dirty || busy || !canDecide || regenerationRunning ? true : undefined}
          aria-describedby={reason}
          onClick={() => {
            if (dirty || busy || !canDecide || regenerationRunning) return
            setPanel(rejecting ? null : 'reject')
          }}
        >
          <OctagonXIcon aria-hidden="true" />
          {t('confirm.reject')}
        </Button>

        {/* Right-anchored, and the quietest control in the row. It is the one irreversible bulk act
            here — it rewrites every unconfirmed element the step owns — so it never sits beside
            Confirm, and it does not move when "Discard edits" appears next to Save. */}
        {canRegenerate && (
          <Button
            type="button"
            ref={regenerateTrigger}
            variant="ghost"
            className="ml-auto"
            aria-expanded={regenerating}
            aria-disabled={dirty || busy || settled || regenerationRunning ? true : undefined}
            aria-busy={pending === 'regenerate'}
            aria-describedby={settled ? 'confirm-bar-settled' : reason}
            onClick={() => {
              if (dirty || busy || settled || regenerationRunning) return
              setPanel(regenerating ? null : 'regenerate')
            }}
          >
            {pending === 'regenerate' ? (
              <Loader2Icon aria-hidden="true" className="animate-spin" />
            ) : (
              <RotateCwIcon aria-hidden="true" />
            )}
            {pending === 'regenerate' ? t('confirm.regeneratePending') : t('confirm.regenerate')}
          </Button>
        )}
      </div>

      {!canDecide && <p className="text-ink-muted text-meta">{t('confirm.readOnlyBody')}</p>}
      {!dirty && (
        <p id="confirm-bar-nothing" className="sr-only">
          {t('confirm.saveNothing')}
        </p>
      )}
      {blocked !== null && (
        <p id="confirm-bar-blocked" className="text-ink-muted text-meta">
          {blocked}
        </p>
      )}
      {outstanding !== null && (
        <p id="confirm-bar-busy" className="text-ink-muted text-body max-w-measure">
          {outstanding}
        </p>
      )}
      {/* The one sentence that teaches the way through a refusal reads at the size of the prose it
          sits among, not below it. */}
      {canRegenerate && settled && (
        <p id="confirm-bar-settled" className="text-ink-muted text-body max-w-measure">
          {t('confirm.regenerateSettled')}
        </p>
      )}

      {rejecting && (
        <div
          role="group"
          aria-label={t('confirm.rejectDialogTitle', { name: elementName })}
          className="flex flex-col gap-3"
        >
          <p className="text-ink-muted text-body max-w-measure">{t('confirm.rejectDialogBody')}</p>
          <Field data-invalid={noteError ? 'true' : undefined}>
            <FieldLabel htmlFor="confirm-reject-note">{t('confirm.rejectNoteLabel')}</FieldLabel>
            <Textarea
              id="confirm-reject-note"
              ref={noteField}
              rows={3}
              className="max-w-measure"
              value={note}
              aria-invalid={noteError ? true : undefined}
              aria-describedby={noteError ? 'confirm-reject-note-error' : undefined}
              onChange={(event) => {
                setNote(event.target.value)
                if (noteError !== null) setNoteError(null)
              }}
            />
            <FieldError id="confirm-reject-note-error">{noteError}</FieldError>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              aria-disabled={busy ? true : undefined}
              aria-busy={pending === 'reject'}
              onClick={() => {
                if (busy) return
                if (note.trim().length === 0) {
                  setNoteError(t('confirm.rejectNoteRequired'))
                  noteField.current?.focus()
                  return
                }
                onReject(note.trim())
                setNote('')
                close()
              }}
            >
              {pending === 'reject' && <Loader2Icon aria-hidden="true" className="animate-spin" />}
              {pending === 'reject' ? t('confirm.rejectPending') : t('confirm.rejectSubmit')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setNoteError(null)
                close()
              }}
            >
              {t('confirm.cancel')}
            </Button>
          </div>
        </div>
      )}

      {regenerating && (
        <div
          role="group"
          aria-label={t('confirm.regenerateTitle', { name: elementName })}
          className="flex flex-col gap-3"
        >
          <p className="text-ink-muted text-body max-w-measure">
            {t('confirm.regenerateBody', { scope: regenerateScope })}
          </p>
          <Field>
            <FieldLabel htmlFor="confirm-regenerate-rule">
              {t('confirm.regenerateRuleLabel')}
            </FieldLabel>
            {/* No `maxLength`: the browser truncates a paste against it silently, and a rule that
                arrives with its last clause missing is worse than one the counter says is too
                long. The same reason UI-041's seed text has none. */}
            <Textarea
              id="confirm-regenerate-rule"
              ref={ruleField}
              rows={3}
              className="max-w-measure"
              value={rule}
              aria-invalid={overLimit ? true : undefined}
              aria-describedby="confirm-regenerate-rule-hint confirm-regenerate-rule-count"
              onChange={(event) => setRule(event.target.value)}
            />
            <FieldDescription id="confirm-regenerate-rule-hint">
              {t('confirm.regenerateRuleHint')}
            </FieldDescription>
            {overLimit ? (
              <FieldError id="confirm-regenerate-rule-count">
                {t('confirm.regenerateRuleTooLong', {
                  count: rule.trim().length,
                  max: REGENERATE_RULE_MAX,
                })}
              </FieldError>
            ) : (
              <FieldDescription
                id="confirm-regenerate-rule-count"
                className="text-mono-sm font-mono tabular-nums"
              >
                {t('confirm.regenerateRuleCount', {
                  count: rule.trim().length,
                  max: REGENERATE_RULE_MAX,
                })}
              </FieldDescription>
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              aria-disabled={busy || overLimit ? true : undefined}
              aria-busy={pending === 'regenerate'}
              onClick={() => {
                if (busy || overLimit) return
                onRegenerate(rule.trim())
                setRule('')
                close()
              }}
            >
              {pending === 'regenerate' && (
                <Loader2Icon aria-hidden="true" className="animate-spin" />
              )}
              {pending === 'regenerate'
                ? t('confirm.regeneratePending')
                : t('confirm.regenerateSubmit', { scope: regenerateScope })}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              {t('confirm.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
