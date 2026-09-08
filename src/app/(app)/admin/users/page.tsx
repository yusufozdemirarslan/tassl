import type { Metadata } from 'next'
import { AdminNav } from '@/components/features/admin/admin-nav'
import { UserSearch } from '@/components/features/admin/user-search'
import { UserTable } from '@/components/features/admin/user-table'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { t } from '@/lib/i18n/t'
import { listUsers } from '@/server/modules/admin'
import { getViewer } from '../../viewer'

export const metadata: Metadata = { title: t('admin.users.title') }

// UI-050 → users (SYS-006, D-016). The search is a query parameter rather than client state, so a
// filtered list can be reloaded, linked to and gone back from; the table itself owns only the two
// things that change the screen without leaving it — a role, and the page after this one.
//
// The layout above has already refused anyone who is not a platform admin; `listUsers` refuses them
// again, which is the check that counts (08 §5).
export default async function AdminUsersPage({ searchParams }: PageProps<'/admin/users'>) {
  const [{ actor }, params] = await Promise.all([getViewer(), searchParams])
  const raw = params.q
  const query = (typeof raw === 'string' ? raw : (raw?.[0] ?? '')).trim()
  const page = await listUsers(actor, query ? { q: query } : {})

  return (
    <>
      <PageHeader title={t('admin.users.title')} description={t('admin.users.description')} />
      <AdminNav current="users" />
      {/* The page h1 already names the screen, so the panel carries no second copy of it. */}
      <Panel id="admin-users">
        <div className="flex flex-col gap-4">
          <UserSearch query={query} />
          <UserTable initial={page} query={query} selfId={actor.id} />
        </div>
      </Panel>
    </>
  )
}
