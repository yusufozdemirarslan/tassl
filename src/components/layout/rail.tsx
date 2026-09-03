'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BookOpen,
  ClipboardCheck,
  FolderKanban,
  Home,
  Package,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/t'

// Icons are resolved here so server layouts can pass plain data across the client boundary.
export type RailIcon = 'home' | 'runs' | 'courses' | 'review' | 'packages' | 'admin'

const ICONS: Record<RailIcon, LucideIcon> = {
  home: Home,
  runs: FolderKanban,
  courses: BookOpen,
  review: ClipboardCheck,
  packages: Package,
  admin: ShieldCheck,
}

export type RailItem = { href: Route; label: string; icon: RailIcon }

// Primary navigation (UI-008): a left rail from `md` up, a bottom bar below it. 40 px items,
// 20 px icons with visible labels, aria-current on the active item.
export function Rail({ items }: { items: RailItem[] }) {
  const pathname = usePathname()
  return (
    <nav
      aria-label={t('shell.primaryNav')}
      className="border-line bg-paper fixed inset-x-0 bottom-0 z-20 border-t md:static md:w-56 md:border-t-0 md:border-r"
    >
      <ul className="flex items-stretch justify-around gap-1 px-2 py-1 md:flex-col md:justify-start md:px-3 md:py-4">
        {items.map(({ href, label, icon }) => {
          const Icon = ICONS[icon]
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <li key={href} className="min-w-0 flex-1 md:flex-none">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'text-ink text-meta flex h-10 items-center justify-center gap-2 rounded-md px-3 font-medium transition-colors duration-150 ease-out md:justify-start',
                  'hover:bg-paper-sunken',
                  active && 'bg-primary-soft text-primary hover:bg-primary-soft',
                )}
              >
                <Icon aria-hidden="true" className="size-5 shrink-0" />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
