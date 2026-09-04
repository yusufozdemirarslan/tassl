'use client'

import Link from 'next/link'
import { LogOut, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { t } from '@/lib/i18n/t'
import type { AccountUser } from './account-menu'
import { AccountTriggerContent, accountTriggerLabel } from './header-menu-triggers'

type AccountMenuPopupProps = {
  user: AccountUser
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A sign-out already in flight, which disables the row that starts one. */
  signOutPending: boolean
  onSignOut: () => Promise<void>
}

// The account menu, imported on the press that opens it (B4, see ./deferred-menu) and the owner of
// the trigger from that point on. Signing out is not deferred with it: the handler and the Better
// Auth client it calls stay in the shell's own bundle (D-188), and this menu only presses it.
//
// `open` is the press that asked for this module, so the menu mounts open; Base UI moves focus into
// the popup and hands it back to the trigger on Escape.
export function AccountMenuPopup({
  user,
  open,
  onOpenChange,
  signOutPending,
  onSignOut,
}: AccountMenuPopupProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={accountTriggerLabel(user.name)} />}
      >
        <AccountTriggerContent />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
        {/* Base UI only allows a GroupLabel inside a Group: the label names the items below it. */}
        <DropdownMenuGroup aria-labelledby="account-menu-label">
          <DropdownMenuLabel id="account-menu-label">
            <span className="text-ink text-body block font-medium break-words">{user.name}</span>
            <span className="text-ink-muted text-meta block truncate" title={user.email}>
              {user.email}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href="/settings" />}>
            <Settings aria-hidden="true" className="size-4" />
            {t('shell.settings')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={signOutPending}
            onClick={() => {
              void onSignOut()
            }}
          >
            <LogOut aria-hidden="true" className="size-4" />
            {t('shell.signOut')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
