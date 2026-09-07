'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { Button } from '@/components/ui/button'
// The review namespace alone, not the composed catalogue (16 §3.4, D-221).
import { t } from '@/lib/i18n/messages/review'
import { flagDelegationAction } from '@/server/modules/review/actions'

// FR-055, on the log where a reviewer reads the exchange (UI-033 → Overview).
//
// **One act, and it is a note about the material.** The mark says that this request was about
// something the scenario does not cover, and what it does is arithmetic: 10 §11.3 excludes a marked
// exchange from the Delegation read, so the band is placed over the exchanges that remain. It is not
// a penalty, it takes nothing away, and the student is never told — `runs.flags` and a delegation's
// `flags` are kept out of every student payload in every state (12 §8.1), which is what makes the
// sentence beside the control true rather than reassuring.
//
// **The copy stays neutral because the product does.** Nothing Tassl observes is treated as a
// question of conduct (PRD §7 standing rules), so there is no word here for one — and the review
// catalogue is scanned for the whole vocabulary with no allowlist (D-457), which is what keeps the
// next edit honest as well as this one.
//
// **A mark is recorded once.** `flagDelegation` adds the flag only when it is absent, so a second
// press is a no-op; the control says so rather than offering a second press that looks like it did
// something. Once the page revalidates, the log's own flag list carries the sentence.

export type DelegationFlagProps = {
  runId: string
  delegationId: string
  /** True when this exchange already carries the mark; the control becomes the sentence. */
  alreadyFlagged: boolean
}

export function DelegationFlag({ runId, delegationId, alreadyFlagged }: DelegationFlagProps) {
  const router = useRouter()
  const [marking, setMarking] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  if (alreadyFlagged) {
    return <p className="text-ink-muted text-body max-w-measure">{t('review.flagAlready')}</p>
  }

  function mark(): void {
    if (marking) return
    setRefused(null)
    setMarking(true)
    void flagDelegationAction({ runId, delegationId, flag: 'out_of_scenario' }).then(
      (result) => {
        setMarking(false)
        if (!result.ok) {
          setRefused(result.error.message || t('review.flagRefused'))
          return
        }
        // The action revalidated the replay; the server render is what draws the mark in the log.
        router.refresh()
      },
      () => {
        setMarking(false)
        setRefused(t('review.flagRefused'))
      },
    )
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-ink-muted text-body max-w-measure">{t('review.flagExplains')}</p>
      <Button
        type="button"
        variant="secondary"
        onClick={mark}
        aria-disabled={marking ? true : undefined}
        aria-busy={marking}
      >
        {marking && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
        {marking ? t('review.flagPending') : t('review.flagButton')}
      </Button>
      <FormAlert message={refused} />
    </div>
  )
}
