'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlertIcon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n/messages/review'
import { toastSuccess } from '@/lib/toast'
import { forceAssistantFailureAction } from '@/server/modules/review/actions'

// UI-033 → `TestControls` (FR-118), shown only when `capabilities.canForceFailure`.
//
// **This control explains itself, at length, on purpose.** It is the only control in the product
// that reaches into a student's live run and changes what happens in it, and an instructor arriving
// at it cold has no way to know that from the words "force failure". So three sentences stand above
// the button and none of them is optional: what it does to the run, why it exists at all, and what
// the student is shown when it fires — which is not that anybody armed anything (D-332). The
// paused overlay says the assistant did not answer, the clock stopped, and nothing is lost, and
// that is the whole of what reaches them.
//
// **It is offered only where it can act.** `runs.forceAssistantFailure` arms the *next* assistant
// call, so there has to be one to arm: the states are `working`, `turn_open` and `paused`, and on
// any other state the service answers RUN_LOCKED or ILLEGAL_TRANSITION. The three are written out
// here rather than imported, the way `MappingEditor` writes out its bound (D-186): a client
// component reads no module schema, and the service re-checks either way. What the list buys is a
// control that says why it cannot act instead of one that refuses when pressed.
//
// `aria-disabled` rather than `disabled`, so the reason stays reachable by keyboard and is
// announced with the control (DESIGN.md §Buttons → Disabled).

/** The run states in which there is an assistant call to arm (`runs/errors.ts`). */
const ARMABLE_STATES: readonly string[] = ['working', 'turn_open', 'paused']

export type TestControlsProps = {
  runId: string
  /** The run's current state; the control is offered only where an assistant call can be armed. */
  runState: string
  /** True once `flags.forced_failure_armed` is set: one outage is already waiting. */
  alreadyArmed: boolean
}

export function TestControls({ runId, runState, alreadyArmed }: TestControlsProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const armable = ARMABLE_STATES.includes(runState)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-muted text-body max-w-measure">{t('review.testDescription')}</p>

      <section className="border-line flex flex-col gap-3 border-t pt-5">
        <h3 className="text-h4">{t('review.testForceTitle')}</h3>
        <p className="text-ink text-reading max-w-measure">{t('review.testForceWhatItDoes')}</p>
        <p className="text-ink text-reading max-w-measure">{t('review.testForceWhyItExists')}</p>
        <p className="text-ink-muted text-body max-w-measure">{t('review.testForceStudentSees')}</p>

        {alreadyArmed && (
          // The product's warning treatment: a hairline, the amber wash, ink text and the icon.
          // Amber is never a text colour and never a single thick edge on a block (DESIGN.md).
          <p className="border-amber bg-amber-soft text-ink text-body max-w-measure flex items-start gap-2 rounded-md border p-3">
            <TriangleAlertIcon aria-hidden="true" className="text-amber mt-0.5 size-4 shrink-0" />
            <span>{t('review.testForceArmed')}</span>
          </p>
        )}

        <FormAlert message={error} />

        <div className="flex flex-col items-start gap-2">
          <Button
            type="button"
            variant="secondary"
            aria-disabled={pending || !armable ? true : undefined}
            aria-busy={pending}
            aria-describedby={armable ? undefined : 'force-failure-reason'}
            onClick={() => {
              if (pending || !armable) return
              setError(null)
              startTransition(async () => {
                const result = await forceAssistantFailureAction({ runId })
                if (!result.ok) {
                  setError(result.error.message)
                  return
                }
                toastSuccess(t('review.testForceDone'))
                router.refresh()
              })
            }}
          >
            {pending ? t('review.testForcePending') : t('review.testForceButton')}
          </Button>
          {!armable && (
            <p id="force-failure-reason" className="text-ink-muted text-body max-w-measure">
              {t('review.testForceNotArmable')}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
