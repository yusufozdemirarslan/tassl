'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
// The shell namespace alone, not the composed catalogue: this component is in the `(app)` layout,
// so every route in the product pays for what it imports (16 §3.4, D-221).
import { t } from '@/lib/i18n/messages/shell'

// UI-008's bell, with a **live** count (SYS-010).
//
// The count arrives with the server render and is re-read while the page stays open, because the
// things that write a notification — a run being scored, a generation finishing, an instructor
// confirming seven bands — happen without the reader doing anything. A badge that only moved on
// navigation would tell a student their run was still being scored for as long as they sat on the
// page watching it.
//
// **It is a poll, and it is a slow one.** A minute, and only while the tab is visible: nothing here
// is a deadline, unlike the run clock `useRunPoll` watches at five seconds (D-471). The tab coming
// back asks immediately, because that is the moment the number is most likely to be stale.
//
// **It asks a route rather than a Server Action** (D-470). Next.js answers a Server Action with the
// re-rendered tree of whatever page the caller is on, and this component is in the `(app)` layout —
// so an action here would re-render the run workspace once a minute for every open tab, to move a
// badge. `GET /api/v1/notifications/unread-count` answers one integer and re-renders nothing.
//
// **The server render always wins when it changes.** A `router.refresh()` after "mark all read" —
// the two mutations revalidate `/home` and `/notifications` — arrives as a new `unreadCount` prop,
// and the polled value is dropped rather than compared: there is no version on a count, and the
// server's is by construction the newer of the two at the moment it renders.

const OVERFLOW = 99
// The accessible name carries the exact count with grouping ("1,200 unread"); the badge caps at 99+.
const COUNT_FORMAT = new Intl.NumberFormat('en-US')

/** Slow on purpose: a badge is not a deadline (D-471). */
const POLL_MS = 60_000

export function NotificationsBell({ unreadCount }: { unreadCount: number }) {
  const [polled, setPolled] = useState<number | null>(null)
  const [serverCount, setServerCount] = useState(unreadCount)

  // Adjusting state while rendering, which is React's own recipe for "a prop changed and derived
  // state is now stale": a fresh server render is the authority, so the poll's answer is dropped.
  if (serverCount !== unreadCount) {
    setServerCount(unreadCount)
    setPolled(null)
  }

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = (): void => {
      if (stopped) return
      timer = setTimeout(() => void ask(), POLL_MS)
    }

    const ask = async (): Promise<void> => {
      if (stopped) return
      if (document.hidden) {
        schedule()
        return
      }
      try {
        const response = await fetch('/api/v1/notifications/unread-count', { cache: 'no-store' })
        if (stopped) return
        // 4xx and 5xx keep what the badge has: a session that ended is the next navigation's
        // business, not a poll's to act on.
        if (response.ok) {
          const body = (await response.json()) as { count?: number }
          if (typeof body.count === 'number') setPolled(body.count)
        }
      } catch {
        // Offline, or the request was cut off. The badge keeps what it has and asks again.
      }
      schedule()
    }

    const onVisible = (): void => {
      if (document.hidden || stopped) return
      if (timer !== undefined) clearTimeout(timer)
      void ask()
    }

    schedule()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const count = polled ?? unreadCount
  const status =
    count > 0
      ? t('shell.notificationsUnread', { count: COUNT_FORMAT.format(count) })
      : t('shell.notificationsNone')

  return (
    <Link
      href="/notifications"
      aria-label={t('shell.notificationsLabel', { title: t('shell.notifications'), status })}
      className="text-ink hover:bg-paper-sunken relative inline-flex size-10 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ease-out"
    >
      <Bell aria-hidden="true" className="size-5" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="bg-primary text-primary-ink text-mono-sm absolute top-0.5 right-0.5 min-w-[18px] rounded-sm px-1 text-center font-mono font-medium tabular-nums"
        >
          {count > OVERFLOW ? t('shell.notificationsOverflow', { max: OVERFLOW }) : count}
        </span>
      )}
    </Link>
  )
}
