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

// UI-024: the Decision Lock's confirmation, and the two refusals it has to carry (FR-084, FR-102,
// FR-108).
//
// **Three faces, one dialog, because it is one press answered.** Before the press it says what
// filing does, in the order it happens to the student, and reads back what is about to be filed. If
// the server refuses — because a claim they leaned on carries no stance (FR-084), or because a
// field of the brief broke one of FR-100's rules — the same dialog changes what it says rather than
// closing and opening something else: the student pressed once, and this is the answer to that
// press. `BRIEF_INVALID` used to close it silently and mark the field behind it, so two refusals of
// one press behaved differently (D-320).
//
// **The read-back is the honest half of an irreversible control** (D-319). A student about to file
// something that can never be edited should be able to see what "it" is without dismissing the
// dialog, and an empty field is named the way the locked screen already names one — "Left empty."
// is what FR-105 files and what they will read back afterwards, so the dialog says the same words
// rather than warning about them. It is a read-back, not a review: nothing here is marked short,
// weak, or missing, and no field is called a problem.
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
// **Neither refusal is a failure the student caused, and the tone says so.** FR-084 exists because
// leaning on a claim without a position on it is the one thing the Decision Run cannot record; the
// lock was refused, nothing was filed, nothing was lost, and the brief is exactly as they left it
// (FR-108). The dialog offers no way to file anyway, because there is not one.

/** The claim `LOCK_REFUSED_UNSTANCED_CLAIM` named (10 §6): its id, and the author's own text. */
export type LockRefusal = { claimId: string; claimText: string }

/** The field `BRIEF_INVALID` named (10 §6), in the words the editor already put beside it. */
export type BriefRefusal = { fieldId: string; label: string; message: string }

/** One line of the read-back: a field of the brief, and what stands in it right now. */
export type LockReadBackEntry = {
  label: string
  /** What the student wrote, or null where the field is empty — never a judgment about either. */
  value: string | null
  /** The word count, where the field has a limit; omitted for confidence and the named figures. */
  words?: number
}

export type LockDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The lock is in flight; the dialog stays open and says so until the action answers. */
  locking: boolean
  /** Set when the last press was refused over a relied-on claim with no stance (FR-084). */
  refusal: LockRefusal | null
  /** Set when the last press was refused over a field of the brief (FR-100, D-320). */
  briefRefusal: BriefRefusal | null
  /** The brief as it stands, read back before the irreversible press (D-319). */
  readBack: readonly LockReadBackEntry[]
  onConfirm: () => void
  /** Puts the focus on the field the server named and closes the dialog. */
  onGoToField: (fieldId: string) => void
}

export function LockDialog({
  open,
  onOpenChange,
  locking,
  refusal,
  briefRefusal,
  readBack,
  onConfirm,
  onGoToField,
}: LockDialogProps) {
  if (refusal !== null) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
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
            <p className="text-ink text-reading max-w-measure">{refusal.claimText}</p>
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
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  if (briefRefusal !== null) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('workspace.lockRefusedBriefTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('workspace.lockRefusedBriefBody')}</AlertDialogDescription>
          </AlertDialogHeader>

          {/* The field the server named, and the sentence it named it with — the same words the
              editor has put under the box behind this dialog. */}
          <div className="bg-paper-sunken flex flex-col gap-1 rounded-md p-4">
            <p className="text-ink-muted text-meta font-medium">{briefRefusal.label}</p>
            <p className="text-ink text-reading max-w-measure">{briefRefusal.message}</p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>{t('workspace.lockRefusedClose')}</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false)
                onGoToField(briefRefusal.fieldId)
              }}
            >
              {t('workspace.lockRefusedBriefGo')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('workspace.decisionLockConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('workspace.decisionLockConfirmBody')}</AlertDialogDescription>
        </AlertDialogHeader>

        {/* What the press will file. A sunken well rather than a second card (One-Layer Rule), and
            a definition list because that is what it is: a field name and what stands in it. */}
        <div className="bg-paper-sunken flex max-h-64 flex-col gap-3 overflow-y-auto rounded-md p-4">
          <p className="text-ink text-meta font-medium">{t('workspace.lockReadBackTitle')}</p>
          <dl className="flex flex-col gap-2">
            {readBack.map((entry) => (
              <div key={entry.label} className="flex flex-col gap-0.5">
                <dt className="text-ink-muted text-meta">{entry.label}</dt>
                <dd
                  className={
                    entry.value === null
                      ? 'text-ink-muted text-body'
                      : 'text-ink text-body max-w-measure'
                  }
                >
                  {entry.value ?? t('workspace.lockReadBackEmpty')}
                  {entry.value !== null && entry.words !== undefined && (
                    <span className="text-ink-muted text-mono-sm ml-2 font-mono tabular-nums">
                      {entry.words === 1
                        ? t('workspace.lockReadBackWordsOne')
                        : t('workspace.lockReadBackWords', { count: entry.words })}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

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
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Scrolls the claim card into view and puts the focus in it.
 *
 * The card carries `data-claim-id` and a `-1` tabindex for this and for nothing else, and only the
 * copy that carries the controls does (see `claim-card.tsx`, D-313) — so this always lands on the
 * card that can answer the refusal rather than on whichever copy the document reached first. Focus
 * rather than scroll alone, because a student working by keyboard or with a screen reader is not
 * helped by a card that moved somewhere they cannot see; from the card the next Tab reaches the
 * stance control that answers the refusal.
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
