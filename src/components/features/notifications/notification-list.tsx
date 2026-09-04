'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import {
  CheckCheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  DownloadIcon,
  Loader2Icon,
  MailIcon,
  PackageCheckIcon,
  PackageIcon,
  PauseCircleIcon,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/layout/empty-state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/t'
import {
  listNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/server/modules/notifications/actions'
import type { NotificationType, NotificationView } from '@/server/modules/notifications/schema'

// UI-011. The first page is server-rendered and handed in; this component owns the three things a
// list does after that: append the next page by cursor, mark one row read, mark everything read.
//
// The rows shown are the server's page plus whatever "Load more" has appended, so a `router.refresh()`
// after a read mark flows straight through — the marked row arrives from the server already read,
// and the optimistic set only covers the moment in between.

const ICONS: Record<NotificationType, LucideIcon> = {
  generation_complete: PackageIcon,
  generation_failed: CircleAlertIcon,
  run_scored: CircleCheckIcon,
  run_held: PauseCircleIcon,
  bands_confirmed: CircleCheckIcon,
  invitation: MailIcon,
  export_ready: DownloadIcon,
  package_confirmed: PackageCheckIcon,
}

const TYPE_LABELS: Record<NotificationType, string> = {
  generation_complete: t('notifications.type.generation_complete'),
  generation_failed: t('notifications.type.generation_failed'),
  run_scored: t('notifications.type.run_scored'),
  run_held: t('notifications.type.run_held'),
  bands_confirmed: t('notifications.type.bands_confirmed'),
  invitation: t('notifications.type.invitation'),
  export_ready: t('notifications.type.export_ready'),
  package_confirmed: t('notifications.type.package_confirmed'),
}

type NotificationListProps = {
  initial: NotificationView[]
  initialCursor: string | null
}

export function NotificationList({ initial, initialCursor }: NotificationListProps) {
  const router = useRouter()
  const [appended, setAppended] = useState<NotificationView[]>([])
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set())
  const [loadingMore, setLoadingMore] = useState(false)
  const [pending, startTransition] = useTransition()

  const seen = new Set(initial.map((item) => item.id))
  const items = [...initial, ...appended.filter((item) => !seen.has(item.id))]
  const isRead = (item: NotificationView): boolean => item.readAt !== null || readIds.has(item.id)
  const unreadCount = items.filter((item) => !isRead(item)).length

  async function loadMore(): Promise<void> {
    if (cursor === null) return
    setLoadingMore(true)
    const result = await listNotificationsAction({ cursor })
    setLoadingMore(false)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setAppended((current) => [...current, ...result.data.items])
    setCursor(result.data.nextCursor)
  }

  function markRead(id: string): void {
    setReadIds((current) => new Set(current).add(id))
    startTransition(async () => {
      const result = await markNotificationReadAction({ id })
      if (!result.ok) {
        setReadIds((current) => {
          const next = new Set(current)
          next.delete(id)
          return next
        })
        toast.error(result.error.message)
        return
      }
      router.refresh()
    })
  }

  function markAllRead(): void {
    const ids = items.filter((item) => !isRead(item)).map((item) => item.id)
    setReadIds((current) => new Set([...current, ...ids]))
    startTransition(async () => {
      const result = await markAllNotificationsReadAction({})
      if (!result.ok) {
        setReadIds(new Set())
        toast.error(result.error.message)
        return
      }
      toast.success(t('notifications.markedAllRead'))
      router.refresh()
    })
  }

  if (items.length === 0) {
    return <EmptyState title={t('notifications.emptyTitle')} body={t('notifications.emptyBody')} />
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          disabled={unreadCount === 0 || pending}
          onClick={markAllRead}
        >
          <CheckCheckIcon aria-hidden="true" className="size-4" />
          {t('notifications.markAllRead')}
        </Button>
      </div>

      <ul aria-label={t('notifications.listLabel')} className="flex flex-col">
        {items.map((item) => {
          const Icon = ICONS[item.type]
          const read = isRead(item)
          return (
            <li
              key={item.id}
              className={cn(
                'border-line flex flex-wrap items-start gap-x-4 gap-y-2 border-b py-4 first:pt-0 last:border-b-0 last:pb-0',
                !read && 'border-l-primary -ml-3 border-l-2 pl-3',
              )}
            >
              <Icon aria-hidden="true" className="text-ink-faint mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1 basis-64">
                <p className={cn('text-ink text-body', !read && 'font-medium')}>
                  <span className="sr-only">{TYPE_LABELS[item.type]}</span>
                  {item.title}
                  {!read && <span className="sr-only">{t('notifications.unread')}</span>}
                </p>
                <p className="text-ink-muted text-body mt-1 max-w-[72ch] [overflow-wrap:anywhere]">
                  {item.body}
                </p>
                <p className="text-ink-muted text-mono-sm mt-1 font-mono tabular-nums">
                  <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {item.link !== null && (
                  <Link
                    href={item.link as Route}
                    className="text-primary text-meta focus-visible:outline-focus rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {t('notifications.open')}
                  </Link>
                )}
                {!read && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    aria-label={t('notifications.markReadLabel', { title: item.title })}
                    onClick={() => markRead(item.id)}
                  >
                    {t('notifications.markRead')}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {cursor !== null && (
        <Button
          variant="secondary"
          className="w-fit"
          disabled={loadingMore}
          aria-busy={loadingMore}
          onClick={() => {
            void loadMore()
          }}
        >
          {loadingMore && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
          {t('notifications.loadMore')}
        </Button>
      )}
    </div>
  )
}
