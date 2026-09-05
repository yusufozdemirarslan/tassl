'use client'

import { CircleUserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSignOut } from '@/lib/hooks/use-sign-out'
import { t } from '@/lib/i18n/messages/shell'
import { useDeferredMenu } from './deferred-menu'
import { AccountTriggerContent, accountTriggerLabel } from './header-menu-triggers'

export type AccountUser = { name: string; email: string }

type AccountMenuProps = { user: AccountUser | null }

// The menu itself lives in ./account-menu-popup and arrives on the press that opens it (B4, see
// ./deferred-menu). What does not move is `useSignOut`: it holds the Better Auth client, which
// stays a static import on every path (D-188).
const loadMenu = () => import('./account-menu-popup')

// Settings and sign-out live behind the account menu; the user's initials are never an image.
// Signing out revokes the session through Better Auth and lands on /sign-in (`useSignOut`).
export function AccountMenu({ user }: AccountMenuProps) {
  const { signOut, pending } = useSignOut()
  const { loaded, open, setOpen, triggerProps } = useDeferredMenu(loadMenu)

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

  const AccountMenuPopup = loaded?.AccountMenuPopup
  if (AccountMenuPopup) {
    return (
      <AccountMenuPopup
        user={user}
        open={open}
        onOpenChange={setOpen}
        signOutPending={pending}
        onSignOut={signOut}
      />
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={accountTriggerLabel(user.name)}
      {...triggerProps}
    >
      <AccountTriggerContent />
    </Button>
  )
}
