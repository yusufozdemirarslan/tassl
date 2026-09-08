import Link from 'next/link'
import type { Route } from 'next'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/t'

// UI-050's three sections are three routes, not a client tab widget: each is a page a person can
// link to, reload, and go back from, and the section showing is the one whose link carries
// `aria-current="page"`. The recipe is the tabs one from DESIGN.md and the component is the same
// shape as `SettingsNav`, deliberately — two screens with the same job look the same.

type AdminTab = 'users' | 'flags' | 'audit'

const TABS: ReadonlyArray<{ key: AdminTab; href: Route; label: string }> = [
  { key: 'users', href: '/admin/users', label: t('admin.tabUsers') },
  { key: 'flags', href: '/admin/flags', label: t('admin.tabFlags') },
  { key: 'audit', href: '/admin/audit', label: t('admin.tabAudit') },
]

export function AdminNav({ current }: { current: AdminTab }) {
  return (
    <nav aria-label={t('admin.tabsLabel')} className="mb-6">
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
