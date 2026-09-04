'use client'

import Link from 'next/link'
import { CircleUserRound, LogOut, Settings } from 'lucide-react'
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
import { useSignOut } from '@/lib/hooks/use-sign-out'
import { t } from '@/lib/i18n/t'

export type AccountUser = { name: string; email: string }

type AccountMenuProps = { user: AccountUser | null }

// Settings and sign-out live behind the account menu; the user's initials are never an image.
// Signing out revokes the session through Better Auth and lands on /sign-in (`useSignOut`).
export function AccountMenu({ user }: AccountMenuProps) {
  const { signOut, pending } = useSignOut()

  if (!user) {
    // Under sm only the icon shows; the text stays in the accessibility tree exactly once.
    return (
      <span className="text-ink-muted text-meta inline-flex min-w-0 items-center gap-2 whitespace-nowrap">
        <CircleUserRound aria-hidden="true" className="size-5 shrink-0" />
        <span aria-hidden="true" className="hidden sm:inline">
          {t('shell.notSignedIn')}
        </span>
        <span className="sr-only">{t('shell.notSignedIn')}</span>
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
            disabled={pending}
            onClick={() => {
              void signOut()
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
