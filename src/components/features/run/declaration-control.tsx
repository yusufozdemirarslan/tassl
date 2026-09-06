'use client'

import { useId, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { Panel } from '@/components/layout/panel'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/messages/workspace'
import { declareOutsideToolAction } from '@/server/modules/assistant/actions'

// UI-023: the outside-tool declaration (FR-061, FR-062, FR-006).
//
// **The no-penalty sentence is beside the control, not behind it.** It is the reason the control is
// safe to use, so it is on screen before the student decides to use it rather than in a dialog they
// have to open first. FR-062 forbids detection, inference and enforcement anywhere in the product
// and FR-006 forbids treating anything Tassl observes as misconduct; `declareOutsideTool` writes one
// trace event and does nothing else with it, and this sentence is what makes that visible.
//
// Nothing here asks whether the tool was allowed. There is no policy branch, no list of tools to
// pick from, no acknowledgement to tick, and no warning — a shape with any of those in it would be
// the beginning of enforcement. The course's policy was stated before the run began (UI-021), and a
// declaration has the same effect under all three of them, which is none.
//
// A disclosure rather than a dialog. It is a standing control that is not irreversible, not
// destructive and not urgent, so it does not need to take the screen away from a student under a
// clock — and this way the workspace does not pay for a popup, a portal and a focus trap at first
// paint to hold a two-field form (the reading `frame-lock-dialog.tsx` gives its own weight).

/** 07 §7's limit on the purpose, restated: a client component imports no module schema value. */
const PURPOSE_MAX_CHARS = 500

export type DeclarationControlProps = {
  runId: string
}

export function DeclarationControl({ runId }: DeclarationControlProps) {
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [purpose, setPurpose] = useState('')
  const [pending, setPending] = useState(false)
  const [invalid, setInvalid] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [recorded, setRecorded] = useState(false)

  const over = purpose.length > PURPOSE_MAX_CHARS
  const message =
    invalid ?? (over ? t('workspace.declarationTooLong', { limit: PURPOSE_MAX_CHARS }) : null)

  function declare(): void {
    if (pending) return
    const written = purpose.trim()
    if (written.length === 0) {
      setInvalid(t('workspace.declarationRequired'))
      return
    }
    if (written.length > PURPOSE_MAX_CHARS) {
      setInvalid(t('workspace.declarationTooLong', { limit: PURPOSE_MAX_CHARS }))
      return
    }
    setInvalid(null)
    setFailed(null)
    setPending(true)
    void declareOutsideToolAction({ runId, purpose: written }).then(
      (result) => {
        setPending(false)
        if (!result.ok) {
          setFailed(result.error.message || t('workspace.declarationFailed'))
          return
        }
        // Recorded, and there is nothing else to report: the run is exactly where it was. The form
        // closes and empties so a second declaration starts clean.
        setPurpose('')
        setOpen(false)
        setRecorded(true)
      },
      () => {
        setPending(false)
        setFailed(t('workspace.declarationFailed'))
      },
    )
  }

  return (
    <Panel
      id="declaration-control"
      title={t('workspace.declarationTitle')}
      description={t('workspace.declarationBody')}
      headingLevel={2}
    >
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="secondary"
          className="w-fit"
          aria-expanded={open}
          aria-controls={formId}
          onClick={() => {
            setOpen((shown) => !shown)
            setRecorded(false)
          }}
        >
          {t('workspace.declarationOpen')}
        </Button>

        <div id={formId} hidden={!open}>
          {open && (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                declare()
              }}
              className="flex flex-col gap-3"
            >
              <Field data-invalid={message ? 'true' : undefined}>
                <FieldLabel htmlFor={`${formId}-purpose`}>
                  {t('workspace.declarationPurposeLabel')}
                </FieldLabel>
                <Textarea
                  id={`${formId}-purpose`}
                  rows={2}
                  value={purpose}
                  autoFocus
                  onChange={(event) => {
                    setPurpose(event.target.value)
                    if (invalid !== null) setInvalid(null)
                  }}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={`${message ? `${formId}-error` : `${formId}-hint`} ${formId}-count`}
                  className={cn('max-w-measure', over && 'border-red')}
                />
                <div className="max-w-measure flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1">
                    {message ? (
                      <FieldError id={`${formId}-error`}>{message}</FieldError>
                    ) : (
                      <FieldDescription id={`${formId}-hint`}>
                        {t('workspace.declarationPurposeHint', { limit: PURPOSE_MAX_CHARS })}
                      </FieldDescription>
                    )}
                  </div>
                  <span
                    id={`${formId}-count`}
                    className={cn(
                      'text-mono-sm shrink-0 font-mono tabular-nums',
                      over ? 'text-red' : 'text-ink-muted',
                    )}
                  >
                    {t('workspace.assistantCharCount', {
                      count: purpose.length,
                      limit: PURPOSE_MAX_CHARS,
                    })}
                  </span>
                </div>
              </Field>

              {failed !== null && <FormAlert message={failed} />}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  aria-disabled={pending ? true : undefined}
                  aria-busy={pending}
                >
                  {pending && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
                  {pending
                    ? t('workspace.declarationSubmitting')
                    : t('workspace.declarationSubmit')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setOpen(false)
                    setInvalid(null)
                    setFailed(null)
                  }}
                >
                  {t('workspace.declarationCancel')}
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* The sentence that makes the control safe to use, always on screen (FR-061, FR-062). */}
        <p className="text-ink-muted text-body max-w-measure">
          {t('workspace.declarationNoPenalty')}
        </p>

        <p role="status" className="text-ink-muted text-body empty:hidden">
          {recorded ? t('workspace.declarationRecorded') : null}
        </p>
      </div>
    </Panel>
  )
}
