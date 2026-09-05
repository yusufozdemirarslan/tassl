'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
import { t } from '@/lib/i18n/messages/run'
import { toastSuccess } from '@/lib/toast'
import { deleteWalkthroughRunAction } from '@/server/modules/courses/actions'

// UI-032's delete confirmation, in one chunk the runs table fetches on the press that needs it
// (B4, see src/lib/hooks/use-deferred-module.ts).
//
// It is not part of what the screen paints. The assignment screen's first paint is a configuration
// form and a table of runs; Base UI's alert dialog — the popup, its positioner and the focus
// manager under it — is weight nobody spends until they decide to remove a walkthrough run, on a
// screen that was already the heaviest in the product.
//
// Because the module arrives *after* the press, the dialog mounts already open — the same shape the
// roster's two overlays use. Base UI takes focus into the popup on mount and returns it, on close,
// to the control that was focused when it opened: the row's own "Delete".
//
// The dialog decides nothing. Which run is being removed, and what is said when the removal is
// refused, both stay in `AssignmentRunsTable`, so a refusal is shown above the table it refuses in
// rather than inside an overlay that has already closed.

export type AssignmentRunDeleteDialogProps = {
  /** The run the confirmation is about. The dialog is mounted for exactly as long as there is one. */
  runId: string
  onClose: () => void
  onFailure: (message: string) => void
}

/**
 * Deleting a walkthrough run removes the run, its trace and everything written in it, and nothing
 * brings it back, so it is asked first (DESIGN.md: a destructive action is confirmed). The confirm
 * control is `aria-disabled` while the action runs rather than `disabled`, so a second press is
 * swallowed without the browser throwing focus back to the top of the document.
 */
export function AssignmentRunDeleteDialog({
  runId,
  onClose,
  onFailure,
}: AssignmentRunDeleteDialogProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('run.reviewDeleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('run.reviewDeleteBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('run.reviewDeleteCancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            aria-disabled={pending ? true : undefined}
            aria-busy={pending}
            onClick={() => {
              if (pending) return
              startTransition(async () => {
                const result = await deleteWalkthroughRunAction({ runId })
                if (result.ok) {
                  toastSuccess(t('run.reviewDeleted'))
                  onClose()
                  router.refresh()
                  return
                }
                onFailure(result.error.message)
                onClose()
              })
            }}
          >
            {pending ? t('run.reviewDeletePending') : t('run.reviewDeleteConfirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
