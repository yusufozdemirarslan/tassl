import Link from 'next/link'
import { Bell } from 'lucide-react'
import { t } from '@/lib/i18n/t'

const OVERFLOW = 99
// The accessible name carries the exact count with grouping ("1,200 unread"); the badge caps at 99+.
const COUNT_FORMAT = new Intl.NumberFormat('en-US')

export function NotificationsBell({ unreadCount }: { unreadCount: number }) {
  const status =
    unreadCount > 0
      ? t('shell.notificationsUnread', { count: COUNT_FORMAT.format(unreadCount) })
      : t('shell.notificationsNone')
  return (
    <Link
      href="/notifications"
      aria-label={t('shell.notificationsLabel', { title: t('shell.notifications'), status })}
      className="text-ink hover:bg-paper-sunken relative inline-flex size-10 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ease-out"
    >
      <Bell aria-hidden="true" className="size-5" />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="bg-primary text-primary-ink text-mono-sm absolute top-0.5 right-0.5 min-w-[18px] rounded-sm px-1 text-center font-mono font-medium tabular-nums"
        >
          {unreadCount > OVERFLOW
            ? t('shell.notificationsOverflow', { max: OVERFLOW })
            : unreadCount}
        </span>
      )}
    </Link>
  )
}
