'use client'

import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { literal, object, type output } from 'zod/mini'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { FormAlert, SubmitButton } from '@/components/features/account/form-feedback'
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { emailField } from '@/lib/auth/form-fields'
import { t } from '@/lib/i18n/t'
import { inviteMemberAction } from '@/server/modules/tenancy/actions'
import type { InvitationView } from '@/server/modules/tenancy/schema'
import { INVITE_ROLE_ITEMS, INVITE_ROLE_VALUES, type InviteRoleValue } from './roster-roles'

// UI-031's two overlays, in one chunk that the roster fetches on the press that needs it (B4, see
// src/lib/hooks/use-deferred-module.ts). Neither is part of what the screen paints: the roster's
// first paint is a table, an add form and two buttons, and Base UI's dialog and alert dialog, the
// invitation form's resolver and its select are all weight nobody spends until they act.
//
// Because the module arrives *after* the press, both dialogs mount already open — the same shape
// the header's deferred menus use. Base UI takes focus into the popup on mount and returns it, on
// close, to the control that was focused when it opened: the row's own "Remove", or the "Invite to
// institution" action inside the refusal.
//
// Neither overlay decides anything. The removal action, its refusal and the roster's optimistic
// state stay in `SectionRoster`, so a refusal is still shown on the row it refuses (D-062).

// ---------------------------------------------------------------------------------------------
// Remove a member (SYS-005)
// ---------------------------------------------------------------------------------------------

export type RemoveMemberDialogProps = {
  /** The person the confirmation is about; the dialog says both, so nobody confirms by position. */
  name: string
  email: string
  sectionName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The removal is in flight; the dialog stays open and says so until the action answers. */
  pending: boolean
  onConfirm: () => void
}

/**
 * Unseating someone is irreversible from this screen — the roster row is gone and the person is
 * added back by address — so it asks first (DESIGN.md: a destructive action is confirmed). The
 * confirm control is `aria-disabled` while the action runs rather than `disabled`, so a second
 * press is swallowed without the browser throwing focus back to the top of the document.
 */
export function RemoveMemberDialog({
  name,
  email,
  sectionName,
  open,
  onOpenChange,
  pending,
  onConfirm,
}: RemoveMemberDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('roster.removeConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('roster.removeConfirmBody', { name, email, section: sectionName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('roster.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            aria-disabled={pending ? true : undefined}
            aria-busy={pending}
            onClick={() => {
              if (pending) return
              onConfirm()
            }}
          >
            {pending && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
            {pending ? t('roster.removeConfirmPending') : t('roster.removeConfirmAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------------------------
// Invite to the institution (UI-031: the action "opens the invitation form")
// ---------------------------------------------------------------------------------------------

const inviteSchema = object({
  email: emailField,
  role: literal(INVITE_ROLE_VALUES, { error: t('roster.inviteRole') }),
})

type InviteValues = output<typeof inviteSchema>

export type InviteMemberDialogProps = {
  /** The institution an invitation is written against; a section cannot hold one. */
  orgId: string
  /** The address the add form could not place, pre-filled and still editable. */
  email: string
  role: InviteRoleValue
  open: boolean
  onOpenChange: (open: boolean) => void
  onInvited: (invitation: InvitationView) => void
}

/**
 * Sending institution mail is not something a single press should do, so the inline action opens
 * this form instead: the address it could not place, the seat the invitation carries, Cancel, and
 * Send. The refusal stays inside the dialog, where the fields that caused it are.
 */
export function InviteMemberDialog({
  orgId,
  email,
  role,
  open,
  onOpenChange,
  onInvited,
}: InviteMemberDialogProps) {
  const [formError, setFormError] = useState<string | null>(null)

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email, role },
  })

  async function onSubmit(values: InviteValues): Promise<void> {
    setFormError(null)
    const result = await inviteMemberAction({ orgId, email: values.email, role: values.role })
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    toast.success(t('roster.invited', { email: result.data.email }))
    onInvited(result.data)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('roster.inviteTitle')}</DialogTitle>
          <DialogDescription>{t('roster.inviteDescription')}</DialogDescription>
        </DialogHeader>

        <form noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
          <div className="flex flex-col gap-5">
            <Field data-invalid={errors.email ? 'true' : undefined}>
              <FieldLabel htmlFor="roster-invite-email">{t('roster.inviteEmail')}</FieldLabel>
              <Input
                id="roster-invite-email"
                type="email"
                autoComplete="off"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? 'roster-invite-email-error' : undefined}
                {...register('email')}
              />
              <FieldError id="roster-invite-email-error">{errors.email?.message}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="roster-invite-role">{t('roster.inviteRole')}</FieldLabel>
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <Select
                    items={INVITE_ROLE_ITEMS}
                    value={field.value}
                    onValueChange={(next: InviteRoleValue | null) => {
                      // Base UI can report an empty selection; an invitation always carries a seat.
                      if (next !== null) field.onChange(next)
                    }}
                  >
                    <SelectTrigger id="roster-invite-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INVITE_ROLE_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <FormAlert message={formError} />
          </div>

          <DialogFooter className="mt-6">
            <DialogClose render={<Button variant="secondary" disabled={isSubmitting} />}>
              {t('roster.cancel')}
            </DialogClose>
            <SubmitButton pending={isSubmitting}>
              {isSubmitting ? t('roster.invitePending') : t('roster.inviteSubmit')}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
