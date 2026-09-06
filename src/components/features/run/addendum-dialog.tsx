'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { t } from '@/lib/i18n/messages/decision'
import { countWords } from '@/lib/words'
import { addAddendumAction } from '@/server/modules/runs/actions'

// UI-024: the post-lock addendum (FR-107).
//
// Fifty words, once per run, beside a decision that cannot be changed.
//
// **It is not an edit, and the control never suggests it is.** The decision was filed and is
// immutable (FR-102); an addendum is its own row with its own timestamp, and every screen renders
// the two apart. So the dialog says what it is for — something the student meant to say, or noticed
// as the clock ended — and says plainly that it is never folded into the decision and that a
// reviewer sees it marked as an addendum.
//
// **"Once" is said before the press, not discovered after it.** `addAddendum` refuses the second
// one with `ADDENDUM_EXISTS`, and a control that let a student write fifty words and then told them
// would be spending their attention to make a point the label could have made. Once it is used, the
// control is gone and the addendum itself is what stands in its place — a disabled button beside
// the note it wrote would be a control that cannot act, which this product does not draw.
//
// The word count is `countWords`, which is the function `wordLimit(50)` runs inside `AddendumSchema`
// (D-075): the number under the box and the number the service refuses on are one number. The
// limit is restated here rather than imported, because a client component never imports a module
// schema (D-186).

/** FR-107's fifty words (`ADDENDUM_WORD_LIMIT`), restated for the counter and the message. */
const WORD_LIMIT = 50

export type AddendumControlProps = {
  runId: string
  /** `DecisionRecord.canAddAddendum`: after the lock, before the record, and not yet used. */
  canAdd: boolean
}

/**
 * The control that opens the dialog, and the one line the page needs after it has been used.
 *
 * It lives beside the dialog rather than in the page because the page is a Server Component and
 * this is the only thing on the locked screen a student presses. Once the addendum is written the
 * button is gone: FR-107 allows one, the server render draws the note itself, and a disabled button
 * beside it would be a control that cannot act.
 *
 * The window can also close without the addendum being used — a recorded or voided run — and there
 * the page says so instead of drawing anything (`decision.addendumClosed`).
 */
export function AddendumControl({ runId, canAdd }: AddendumControlProps) {
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState(false)

  if (!canAdd) return null

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setOpen(true)
        }}
      >
        {t('decision.addendumOpen')}
      </Button>

      {/* Stays mounted and collapses when empty, so the announcement fires on the sentence
          changing rather than on the region being inserted. */}
      <p role="status" className="text-ink-muted text-body empty:hidden">
        {added ? t('decision.addendumAdded') : null}
      </p>

      {open && (
        <AddendumDialog
          open={open}
          onOpenChange={setOpen}
          runId={runId}
          onAdded={() => {
            setAdded(true)
          }}
        />
      )}
    </div>
  )
}

export type AddendumDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  runId: string
  /** Told when the addendum is written, so the page can say so before the server render lands. */
  onAdded: () => void
}

export function AddendumDialog({ open, onOpenChange, runId, onAdded }: AddendumDialogProps) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [invalid, setInvalid] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const words = countWords(text)
  const over = words > WORD_LIMIT
  const message = invalid ?? (over ? t('decision.addendumTooLong', { limit: WORD_LIMIT }) : null)

  function add(): void {
    if (adding) return
    if (text.trim().length === 0) {
      setInvalid(t('decision.addendumRequired'))
      return
    }
    if (over) {
      setInvalid(t('decision.addendumTooLong', { limit: WORD_LIMIT }))
      return
    }
    setInvalid(null)
    setFailed(null)
    setAdding(true)
    void addAddendumAction({ runId, text: text.trim() }).then(
      (result) => {
        setAdding(false)
        if (!result.ok) {
          setFailed(result.error.message || t('decision.addendumFailed'))
          return
        }
        setText('')
        onOpenChange(false)
        onAdded()
        // The action revalidated `/runs/[runId]/locked`; the server render is what draws the
        // addendum where the control was.
        router.refresh()
      },
      () => {
        setAdding(false)
        setFailed(t('decision.addendumFailed'))
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('decision.addendumDialogTitle')}</DialogTitle>
          <DialogDescription>{t('decision.addendumDialogBody')}</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
          className="flex flex-col gap-4"
        >
          <Field data-invalid={message ? 'true' : undefined}>
            <FieldLabel htmlFor="addendum-text">{t('decision.addendumLabel')}</FieldLabel>
            <Textarea
              id="addendum-text"
              rows={4}
              value={text}
              autoFocus
              onChange={(event) => {
                setText(event.target.value)
                if (invalid !== null) setInvalid(null)
              }}
              aria-invalid={message ? true : undefined}
              aria-describedby={`${message ? 'addendum-error' : 'addendum-hint'} addendum-count`}
              className={cn('text-reading', over && 'border-red')}
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="min-w-0 flex-1">
                {message ? (
                  <FieldError id="addendum-error">{message}</FieldError>
                ) : (
                  <FieldDescription id="addendum-hint">
                    {t('decision.addendumHint', { limit: WORD_LIMIT })}
                  </FieldDescription>
                )}
              </div>
              {/* Read on focus rather than announced: a counter in a live region would talk over
                  the sentence being written (09 §6). */}
              <span
                id="addendum-count"
                className={cn(
                  'text-mono-sm shrink-0 font-mono tabular-nums',
                  over ? 'text-red' : 'text-ink-muted',
                )}
              >
                {t('decision.addendumWordCount', { count: words, limit: WORD_LIMIT })}
              </span>
            </div>
          </Field>

          {failed !== null && <FormAlert message={failed} />}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onOpenChange(false)
              }}
            >
              {t('decision.addendumCancel')}
            </Button>
            <Button type="submit" aria-disabled={adding ? true : undefined} aria-busy={adding}>
              {adding && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
              {adding ? t('decision.addendumSubmitting') : t('decision.addendumSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
