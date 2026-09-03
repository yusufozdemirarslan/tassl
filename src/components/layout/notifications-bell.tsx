import type { Route } from 'next'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { t } from '@/lib/i18n/t'

// The notifications route lands in Phase 3; the shell already points at it.
const NOTIFICATIONS_ROUTE = '/notifications' as Route
const OVERFLOW = 99

export function NotificationsBell({ unreadCount }: { unreadCount: number }) {
  const status =
    unreadCount > 0
      ? t('shell.notificationsUnread', { count: unreadCount })
      : t('shell.notificationsNone')
  return (
    <Link
      href={NOTIFICATIONS_ROUTE}
      aria-label={t('shell.notificationsLabel', { title: t('shell.notifications'), status })}
      className="text-ink hover:bg-paper-sunken relative inline-flex size-10 items-center justify-center rounded-md transition-colors duration-150 ease-out"
    >
      <Bell aria-hidden="true" className="size-5" />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="bg-primary text-primary-ink text-mono-sm absolute top-1 right-1 min-w-[18px] rounded-sm px-1 text-center font-mono font-medium tabular-nums"
        >
          {unreadCount > OVERFLOW
            ? t('shell.notificationsOverflow', { max: OVERFLOW })
            : unreadCount}
        </span>
      )}
    </Link>
  )
}
