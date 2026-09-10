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
import { t } from '@/lib/i18n/messages/decision'
import { countWords } from '@/lib/words'
import { addAddendumAction } from '@/server/modules/runs/actions'
import { useRefresh } from '@/lib/hooks/use-refresh'

// The addendum's own form (FR-107), in its own module so it can be its own chunk.
//
// `addendum-dialog.tsx` is what `/locked` renders: a button, a status line, and the `import()` that
// fetches this on the press (D-326). Everything the form needs — the Base UI dialog, the textarea,
// the counter, the action — lives here and is downloaded by the student who decides to write an
// addendum and by no other. The rules the form follows are in that file's header, because they are
// rules about the control rather than about the markup.

/** FR-107's fifty words (`ADDENDUM_WORD_LIMIT`), restated for the counter and the message. */
const WORD_LIMIT = 50

export type AddendumDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  runId: string
  /** Told when the addendum is written, so the page can say so before the server render lands. */
  onAdded: () => void
}

export function AddendumDialog({ open, onOpenChange, runId, onAdded }: AddendumDialogProps) {
  const refresh = useRefresh()
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
        refresh()
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
