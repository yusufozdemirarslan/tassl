'use client'

import { useId, useState } from 'react'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useSignOut } from '@/lib/hooks/use-sign-out'
import { t } from '@/lib/i18n/messages/settings'
import { requestAccountDeletionAction } from '@/server/modules/identity/actions'
import { FormAlert } from './form-feedback'

// UI-010 Data → "Delete account" (SYS-004, 08 §2.9). The dialog does three things before it will
// act: it says the account closes immediately, it says the deletion completes after 30 days, and it
// says the pseudonymous course record stays with the institution. Then it makes the person type the
// address of the account — a confirmation that cannot be clicked through by muscle memory.
//
// The typed address is checked again by the action against the session (identity/actions.ts), so
// this check is the courtesy and that one is the guard. On success the session is already revoked
// server-side; signing out clears the cookie and lands on /sign-in.
export function DeleteAccountDialog({ email }: { email: string }) {
  const { signOut } = useSignOut()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const inputId = useId()

  const matches = typed.trim().toLowerCase() === email.toLowerCase()

  async function confirmDelete(): Promise<void> {
    if (!matches) return
    setPending(true)
    setFailure(null)
    const result = await requestAccountDeletionAction({ email: typed.trim() })
    if (!result.ok) {
      setPending(false)
      setFailure(result.error.message)
      return
    }
    await signOut()
  }

  return (
    <div className="flex flex-col gap-4">
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setTyped('')
            setFailure(null)
          }
        }}
      >
        <AlertDialogTrigger render={<Button variant="destructive" className="w-fit" />}>
          {t('settings.data.deleteSubmit')}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.data.deleteDialogTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.data.deleteDialogBody')}</AlertDialogDescription>
          </AlertDialogHeader>

          <Field>
            <FieldLabel htmlFor={inputId}>
              {t('settings.data.deleteConfirmLabel', { email })}
            </FieldLabel>
            <Input
              id={inputId}
              type="email"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </Field>

          <FormAlert message={failure} />

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t('settings.data.deleteCancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!matches || pending}
              aria-busy={pending}
              onClick={() => {
                void confirmDelete()
              }}
            >
              {pending && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
              {t('settings.data.deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
