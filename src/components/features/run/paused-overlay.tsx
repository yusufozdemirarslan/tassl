'use client'

import { useState } from 'react'
import { Loader2Icon, PauseCircleIcon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { t } from '@/lib/i18n/messages/workspace'
import { resumeRunAction } from '@/server/modules/runs/actions'
import type { PauseCauseValue } from '@/server/modules/runs/schema'
import { useRefresh } from '@/lib/hooks/use-refresh'

// UI-023's paused state (FR-001): a component of Tassl failed, so the run stopped and the clock
// stopped with it.
//
// **It is modal, and that is the honest shape.** Nothing behind it can be used — the assistant does
// not answer, a document does not open, and the log refuses a write — so a workspace left reachable
// would be a screen full of controls that all say no. An `alertdialog` takes the screen, states
// what happened, and offers the one control that changes it. Base UI's alert dialog is the
// non-dismissible one: no outside click, no Escape, no close button. A student cannot dismiss their
// way back into a run that is not running.
//
// **What it says is what a student is owed and nothing more.** The cause in plain language, that
// the clock stopped, that the time is given back, and that nothing they did was lost. Which
// delegation met the outage, which provider it was and what it answered are the reviewer's replay
// to carry (`pause.related_delegation_id`); under a stopped clock they are noise.
//
// The credit is a fact about `resumeRun`, not a promise this screen makes: the pause's wall-clock
// span goes back into the working clock, and the failed component's own cost is credited on top of
// it — for a delegation that cost is zero, because a delegation charges no clock at all (10 §7).

/** The four causes `run_pauses.cause` records (06 §3.4), each in the student's language. */
const CAUSE_SENTENCES: Record<PauseCauseValue, () => string> = {
  assistant_failure: () => t('workspace.pausedCauseAssistantFailure'),
  document_failure: () => t('workspace.pausedCauseDocumentFailure'),
  action_failure: () => t('workspace.pausedCauseActionFailure'),
  connection: () => t('workspace.pausedCauseConnection'),
}

export type PausedOverlayProps = {
  runId: string
  cause: PauseCauseValue
}

export function PausedOverlay({ runId, cause }: PausedOverlayProps) {
  const refresh = useRefresh()
  const [resuming, setResuming] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  function resume(): void {
    if (resuming) return
    setResuming(true)
    setFailed(null)
    void resumeRunAction({ runId }).then(
      (result) => {
        if (!result.ok) {
          setResuming(false)
          setFailed(result.error.message || t('workspace.pausedFailed'))
          return
        }
        // The action revalidated the workspace; the server render decides what stands here next,
        // and `resuming` stays true so the button keeps saying so until the new tree arrives.
        refresh()
      },
      () => {
        setResuming(false)
        setFailed(t('workspace.pausedFailed'))
      },
    )
  }

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <PauseCircleIcon aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>{t('workspace.pausedTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {CAUSE_SENTENCES[cause]()} {t('workspace.pausedBody')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {failed !== null && <FormAlert message={failed} />}

        <AlertDialogAction
          aria-disabled={resuming ? true : undefined}
          aria-busy={resuming}
          onClick={(event) => {
            event.preventDefault()
            resume()
          }}
        >
          {resuming && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
          {resuming ? t('workspace.pausedResuming') : t('workspace.pausedResume')}
        </AlertDialogAction>
      </AlertDialogContent>
    </AlertDialog>
  )
}
