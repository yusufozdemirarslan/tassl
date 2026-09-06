'use client'

import { Loader2Icon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n/messages/workspace'

// UI-024: the Decision Lock's confirmation, and the one refusal it has to carry (FR-084, FR-102,
// FR-108).
//
// **Two faces, one dialog, because it is one press answered.** Before the press it says what filing
// does, in the order it happens to the student, because the act is irreversible. If the server
// refuses because a claim they leaned on carries no stance, the same dialog changes what it says
// rather than closing and opening something else: the student pressed once, and this is the answer
// to that press.
//
// **The refusal names the claim by the words the student already read** (`details.claimText`), and
// says nothing else about it. Not which stance it deserves, not why it matters, not what it was
// checked against — FR-073 forbids Tassl saying a claim is wrong, and a refusal is exactly where a
// system is tempted to. What it offers instead is the way back to the claim: "Go to the claim"
// closes the dialog, scrolls the card into view and puts the focus in it, so the student is
// standing on the control that will answer the refusal.
//
// The claim may not be on screen — the live reply has moved on, or the browser was reloaded — and
// the fallback is a sentence rather than a dead button: the Delegation Log carries every claim
// under the request that raised it, and that is where to look.
//
// **The refusal is not a failure the student caused, and the tone says so.** FR-084 exists because
// leaning on a claim without a position on it is the one thing the Decision Run cannot record; the
// lock was refused, nothing was filed, nothing was lost, and the brief is exactly as they left it
// (FR-108). The dialog offers no way to file anyway, because there is not one.

/** The claim `LOCK_REFUSED_UNSTANCED_CLAIM` named (10 §6): its id, and the author's own text. */
export type LockRefusal = { claimId: string; claimText: string }

export type LockDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The lock is in flight; the dialog stays open and says so until the action answers. */
  locking: boolean
  /** Set when the last press was refused over a relied-on claim with no stance (FR-084). */
  refusal: LockRefusal | null
  onConfirm: () => void
}

export function LockDialog({ open, onOpenChange, locking, refusal, onConfirm }: LockDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {refusal === null ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('workspace.decisionLockConfirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('workspace.decisionLockConfirmBody')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={locking}>
                {t('workspace.decisionLockCancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                aria-disabled={locking ? true : undefined}
                aria-busy={locking}
                onClick={(event) => {
                  event.preventDefault()
                  onConfirm()
                }}
              >
                {locking && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
                {locking ? t('workspace.decisionLocking') : t('workspace.decisionLockConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('workspace.lockRefusedTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('workspace.lockRefusedBody')}</AlertDialogDescription>
            </AlertDialogHeader>

            {/* The claim, in the author's own words. A sunken well rather than a second card:
                this is already inside a dialog, and DESIGN.md's One-Layer Rule holds there too. */}
            <div className="bg-paper-sunken flex flex-col gap-1 rounded-md p-4">
              <p className="text-ink-muted text-meta font-medium">
                {t('workspace.lockRefusedClaimLabel')}
              </p>
              <p className="text-ink text-reading max-w-[72ch]">{refusal.claimText}</p>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel>{t('workspace.lockRefusedClose')}</AlertDialogCancel>
              <Button
                type="button"
                onClick={() => {
                  onOpenChange(false)
                  goToClaim(refusal.claimId)
                }}
              >
                {t('workspace.lockRefusedGoToClaim')}
              </Button>
            </AlertDialogFooter>

            <p className="text-ink-muted text-meta">{t('workspace.lockRefusedNotOnScreen')}</p>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Scrolls the claim card into view and puts the focus in it.
 *
 * The card carries `data-claim-id` and a `-1` tabindex for this and for nothing else (see
 * `claim-card.tsx`). Focus rather than scroll alone, because a student working by keyboard or with
 * a screen reader is not helped by a card that moved somewhere they cannot see; from the card the
 * next Tab reaches the stance control that answers the refusal.
 *
 * The scroll is instant under `prefers-reduced-motion`, which is DESIGN.md's rule for every
 * animation in the product and one a smooth scroll is easy to forget.
 */
function goToClaim(claimId: string): void {
  const card = document.querySelector<HTMLElement>(`[data-claim-id="${claimId}"]`)
  if (card === null) return
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  card.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' })
  card.focus({ preventScroll: true })
}
