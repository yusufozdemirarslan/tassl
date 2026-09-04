import type { Metadata } from 'next'
import { NotificationList } from '@/components/features/notifications/notification-list'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { t } from '@/lib/i18n/t'
import { listNotifications } from '@/server/modules/notifications'
import { getViewer } from '../viewer'

export const metadata: Metadata = { title: t('notifications.title') }

// UI-011. The first page is read here, on the server; the list component owns the interaction
// (mark read, mark all read, load more by cursor). Nothing writes notifications yet — the run,
// scoring, and generation modules do, from Phase 5 onwards — so the empty state is what most
// accounts see today, and it is the honest one rather than a placeholder row.
export default async function NotificationsPage() {
  const { actor } = await getViewer()
  const page = await listNotifications(actor)

  return (
    <>
      <PageHeader title={t('notifications.title')} description={t('notifications.description')} />
      <Panel>
        <NotificationList initial={page.items} initialCursor={page.nextCursor} />
      </Panel>
    </>
  )
}
