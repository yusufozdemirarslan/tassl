'use client'

import { useEffect, useRef, useState } from 'react'
import { BadgeCheckIcon, Loader2Icon, OctagonXIcon, SaveIcon, Undo2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/lib/i18n/messages/package-confirm'

// The bar at the foot of the editor (UI-043): the three things an author does to one element.
//
// Regenerate is not here. `PackageVersionView.capabilities.canRegenerate` is false until generation
// ships in Phase 12, and a fourth button that cannot act — greyed, or worse, live and refusing —
// teaches an author a control that does not exist. The version view leaves the same absence out
// rather than drawing it; the rejected state below says what actually happens instead, which is
// that the element has to be re-authored by hand.
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

export type ConfirmBarPending = 'save' | 'confirm' | 'reject' | null

export type ConfirmBarProps = {
  elementName: string
  /** The editor holds changes that have not reached the server. */
  dirty: boolean
  /** The element is confirmed and has not been reopened, or the version is frozen. */
  locked: boolean
  /** 08 §4: nobody at Tassl signs in place of the institution's own authority. */
  canDecide: boolean
  pending: ConfirmBarPending
  onSave: () => void
  onDiscard: () => void
  onConfirm: () => void
  onReject: (note: string) => void
}

export function ConfirmBar({
  elementName,
  dirty,
  locked,
  canDecide,
  pending,
  onSave,
  onDiscard,
  onConfirm,
  onReject,
}: ConfirmBarProps) {
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const noteField = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (rejecting) noteField.current?.focus()
  }, [rejecting])

  const busy = pending !== null
  const blocked = dirty ? t('confirm.unsavedBeforeDecide') : null

  return (
    <div className="border-line flex flex-col gap-3 border-t pt-4">
      <div
        role="group"
        aria-label={t('confirm.toolbarLabel')}
        className="flex flex-wrap items-center gap-2"
      >
        <Button
          type="button"
          aria-disabled={!dirty || busy ? true : undefined}
          aria-busy={pending === 'save'}
          aria-describedby={dirty ? undefined : 'confirm-bar-nothing'}
          onClick={() => {
            if (dirty && !busy) onSave()
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
          variant="secondary"
          aria-disabled={dirty || busy || locked || !canDecide ? true : undefined}
          aria-busy={pending === 'confirm'}
          aria-describedby={blocked === null ? undefined : 'confirm-bar-blocked'}
          onClick={() => {
            if (!dirty && !busy && !locked && canDecide) onConfirm()
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
          variant="secondary"
          aria-expanded={rejecting}
          aria-disabled={dirty || busy || !canDecide ? true : undefined}
          aria-describedby={blocked === null ? undefined : 'confirm-bar-blocked'}
          onClick={() => {
            if (!dirty && !busy && canDecide) setRejecting((open) => !open)
          }}
        >
          <OctagonXIcon aria-hidden="true" />
          {t('confirm.reject')}
        </Button>
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

      {rejecting && (
        <div
          role="group"
          aria-label={t('confirm.rejectDialogTitle', { name: elementName })}
          className="flex flex-col gap-3"
        >
          <p className="text-ink-muted text-body max-w-[72ch]">{t('confirm.rejectDialogBody')}</p>
          <Field data-invalid={noteError ? 'true' : undefined}>
            <FieldLabel htmlFor="confirm-reject-note">{t('confirm.rejectNoteLabel')}</FieldLabel>
            <Textarea
              id="confirm-reject-note"
              ref={noteField}
              rows={3}
              className="max-w-[72ch]"
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
                setRejecting(false)
                setNote('')
              }}
            >
              {pending === 'reject' && <Loader2Icon aria-hidden="true" className="animate-spin" />}
              {pending === 'reject' ? t('confirm.rejectPending') : t('confirm.rejectSubmit')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setRejecting(false)
                setNoteError(null)
              }}
            >
              {t('confirm.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
