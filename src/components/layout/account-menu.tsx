'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { CircleUserRound, LogOut, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { t } from '@/lib/i18n/t'

export type AccountUser = { name: string; email: string }

type AccountMenuProps = {
  user: AccountUser | null
  /** Wired to the Better Auth client in Phase 3. */
  onSignOut?: (() => void) | undefined
}

// Settings and sign-out live behind the account menu; the user's initials are never an image.
const SETTINGS_ROUTE = '/settings' as Route

export function AccountMenu({ user, onSignOut }: AccountMenuProps) {
  if (!user) {
    return (
      <span className="text-ink-muted text-meta inline-flex items-center gap-2">
        <CircleUserRound aria-hidden="true" className="size-5" />
        {t('shell.notSignedIn')}
      </span>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={`${t('shell.account')}: ${user.name}`} />
        }
      >
        <CircleUserRound aria-hidden="true" className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="text-ink text-body block font-medium">{user.name}</span>
          <span className="text-ink-muted text-meta block">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href={SETTINGS_ROUTE} />}>
          <Settings aria-hidden="true" className="size-4" />
          {t('shell.settings')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSignOut?.()}>
          <LogOut aria-hidden="true" className="size-4" />
          {t('shell.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
