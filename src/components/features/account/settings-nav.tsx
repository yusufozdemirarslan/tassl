import Link from 'next/link'
import type { Route } from 'next'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/t'

// UI-010's tabs are three routes, not a client tab widget: each section is a page a person can
// link to, reload, and go back from, and the "tab" that is showing is the one whose link carries
// `aria-current="page"`. Rendered on the server, so the settings screens ship no navigation script.
//
// The visual recipe is the tabs one from DESIGN.md: a sunken well, 40 px triggers in 13/20 weight
// 500, the active item on raised paper with a hairline and no shadow. It wraps rather than scrolls,
// so three tabs still fit at 360 px.

type SettingsTab = 'profile' | 'security' | 'data'

const TABS: ReadonlyArray<{ key: SettingsTab; href: Route; label: string }> = [
  { key: 'profile', href: '/settings', label: t('settings.tabProfile') },
  { key: 'security', href: '/settings/security', label: t('settings.tabSecurity') },
  { key: 'data', href: '/settings/data', label: t('settings.tabData') },
]

export function SettingsNav({ current }: { current: SettingsTab }) {
  return (
    <nav aria-label={t('settings.tabsLabel')} className="mb-6">
      <ul className="bg-paper-sunken flex w-fit max-w-full flex-wrap gap-1 rounded-md p-1">
        {TABS.map(({ key, href, label }) => {
          const active = key === current
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'text-meta focus-visible:outline-focus flex h-10 items-center rounded-md px-3 font-medium transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:-outline-offset-2',
                  active
                    ? 'border-line bg-paper-raised text-ink border'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
