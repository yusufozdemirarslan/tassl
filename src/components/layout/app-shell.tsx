import type { ReactNode } from 'react'
import { AccountMenu, type AccountUser } from '@/components/layout/account-menu'
import { FocusOnRouteChange } from '@/components/layout/focus-on-route-change'
import { InstitutionSwitcher, type Institution } from '@/components/layout/institution-switcher'
import { NotificationsBell } from '@/components/layout/notifications-bell'
import { Rail, type RailItem } from '@/components/layout/rail'
import { t } from '@/lib/i18n/t'

export type AppShellProps = {
  rail: RailItem[]
  institutions: Institution[]
  activeInstitutionId?: string | undefined
  unreadCount: number
  user: AccountUser | null
  children: ReactNode
}

// UI-008: skip link → header (brand, institution switcher, bell, account) → rail → main.
// Phase 3 supplies the session-derived props; until then the layout passes placeholders.
export function AppShell({
  rail,
  institutions,
  activeInstitutionId,
  unreadCount,
  user,
  children,
}: AppShellProps) {
  return (
    <div className="bg-paper text-ink flex min-h-dvh flex-col">
      <a
        href="#main"
        className="bg-paper-raised text-primary focus:border-line focus:text-meta sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:border focus:px-3 focus:py-2 focus:font-medium"
      >
        {t('shell.skipToMain')}
      </a>
      <header className="border-line bg-paper-raised flex h-14 items-center justify-between gap-4 border-b px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <span className="text-h4 font-serif font-semibold">{t('shell.brand')}</span>
          <span aria-hidden="true" className="bg-line hidden h-6 w-px md:block" />
          <InstitutionSwitcher institutions={institutions} activeId={activeInstitutionId} />
        </div>
        <div className="flex items-center gap-1">
          <NotificationsBell unreadCount={unreadCount} />
          <AccountMenu user={user} />
        </div>
      </header>
      <div className="flex flex-1 md:flex-row">
        <Rail items={rail} />
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-6 pb-24 outline-none md:px-6 md:pb-8"
        >
          <FocusOnRouteChange />
          {children}
        </main>
      </div>
    </div>
  )
}
