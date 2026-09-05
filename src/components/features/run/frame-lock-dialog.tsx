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
import { t } from '@/lib/i18n/messages/workspace'

// FR-042's confirmation, in one chunk the frame form fetches while the student is writing.
//
// **This is the one deferral on this screen that had to be argued rather than assumed.** Everywhere
// else in the product a press-time import is free: the roster's overlays and the header's menus are
// fetched on the press that opens them, and nobody is under a clock. Here the student is, and this
// file used to sit inside `frame-form.tsx` for exactly that reason — a network round trip between
// the press and the dialog is the wrong place to save bytes.
//
// It moved because the two are not the only options. Base UI's alert dialog — the popup, the
// positioner, the portal and the focus manager under it — was the largest single thing the workspace
// downloaded, and it was the *only* popup on the screen: the room is a list, the frame is four
// textareas, and nothing else here opens over anything. So it was being paid for at first paint, on
// the one screen where first paint is the whole point, to be used once, minutes later.
//
// What the form does instead is fetch it on the first focus inside the frame (`FrameForm`), not on
// the press: writing a decision, three assumptions and a position takes minutes, and the chunk
// arrives in the first of them. By the time the lock is pressed it has been in the module cache for
// the whole of the writing, so the press opens the dialog with no round trip at all — the same
// moment the static import gave, without the weight in front of the first paint. If it never
// arrived, the form says so and locks nothing: an irreversible act is not taken unconfirmed.
//
// The dialog says the two things a student needs before that press, and neither is a judgement of
// what they wrote: it is permanent, and the assistant unlocks with it.

export type FrameLockDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The lock is in flight; the dialog stays open and says so until the action answers. */
  locking: boolean
  onConfirm: () => void
}

export function FrameLockDialog({ open, onOpenChange, locking, onConfirm }: FrameLockDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('workspace.lockConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('workspace.lockConfirmBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={locking}>{t('workspace.lockCancel')}</AlertDialogCancel>
          <AlertDialogAction
            aria-disabled={locking ? true : undefined}
            aria-busy={locking}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {locking && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
            {locking ? t('workspace.lockPending') : t('workspace.lockConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
