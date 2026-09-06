'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useDeferredModule } from '@/lib/hooks/use-deferred-module'
import { t } from '@/lib/i18n/messages/decision'

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
//
// **The form itself is a separate chunk, fetched on the press.** `/locked` is a reading screen —
// the filed brief, the frozen frame, a countdown — and the one thing a student may still write on
// it is optional and used once. That is the case `use-deferred-module.ts` exists for (B4, 16 §3.2):
// the dialog's textarea, its counter and the Base UI dialog behind it are not part of what the
// route paints, so they are not part of what it downloads (D-326). If the import never arrives, the
// control says so and nothing is added — the two sentences that say it were written for this
// behaviour in Step 8.2 and stood unreferenced until now.

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
  const { loaded, status, request } = useDeferredModule(loadAddendumDialog)
  const Dialog = loaded?.AddendumDialog

  if (!canAdd) return null

  const waiting = open && status === 'loading'
  const unavailable = open && status === 'failed'

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        aria-busy={waiting}
        onClick={() => {
          request()
          setOpen(true)
        }}
      >
        {t('decision.addendumOpen')}
      </Button>

      {/* Stays mounted and collapses when empty, so the announcement fires on the sentence
          changing rather than on the region being inserted. */}
      <p role="status" className="text-ink-muted text-body empty:hidden">
        {added
          ? t('decision.addendumAdded')
          : waiting
            ? t('decision.addendumLoading')
            : unavailable
              ? t('decision.addendumUnavailable')
              : null}
      </p>

      {open && Dialog !== undefined && (
        <Dialog
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

/** Module-scope, so the bundler can match this call site to the dialog's own chunk (D-326). */
const loadAddendumDialog = () => import('./addendum-form')
