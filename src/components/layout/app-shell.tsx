import Link from 'next/link'
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
// Every prop is session-derived by the (app) layout; the shell itself decides nothing.
// Both header groups can shrink (min-w-0) so a long institution name truncates instead of
// pushing the bell and account controls off the edge.
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
        className="bg-paper-raised text-primary focus:border-line focus:text-meta sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:inline-flex focus:h-10 focus:items-center focus:rounded-md focus:border focus:px-3 focus:font-medium"
      >
        {t('shell.skipToMain')}
      </a>
      <header className="border-line bg-paper-raised flex min-h-14 items-center justify-between gap-2 border-b px-4 md:gap-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-4">
          <Link
            href="/home"
            className="text-h4 text-ink focus-visible:outline-focus shrink-0 rounded-sm font-serif font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t('shell.brand')}
          </Link>
          <span aria-hidden="true" className="bg-line hidden h-6 w-px shrink-0 md:block" />
          <InstitutionSwitcher institutions={institutions} activeId={activeInstitutionId} />
        </div>
        {/* WCAG 1.4.4. The bell and the account control are sized in rem, so at 200 % text they
            doubled to 80 px each while nothing in the header could give way, and the document
            scrolled sideways at 360 px. Neither control carries text: their size is a target size,
            not a type size, so both are pinned to the 40 px minimum DESIGN.md §Layout commits to,
            with their 20 px icons pinned the same way, and the cluster is left free to shrink. The
            two menus swap a plain button for the Base UI trigger once their code arrives
            (./deferred-menu), and both are the same `<button>` to these rules. */}
        <div className="flex min-w-0 shrink items-center gap-1 [&_svg]:size-[20px] [&>a]:size-[40px] [&>button]:size-[40px]">
          <NotificationsBell unreadCount={unreadCount} />
          <AccountMenu user={user} />
        </div>
      </header>
      <div className="flex flex-1 md:flex-row">
        <Rail items={rail} />
        {/* Under md the bottom padding clears the fixed bottom bar (57 px with its hairline) by the
            page's own 24 px gutter; it equals the html scroll-padding-bottom in globals.css. */}
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 py-6 pb-20 outline-none md:px-6 md:pb-8"
        >
          <FocusOnRouteChange />
          {children}
        </main>
      </div>
    </div>
  )
}
