import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { PackagesTable } from '@/components/features/packages/packages-table'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import type { PlatformRole } from '@/server/modules/identity/schema'
import { listPackages, type PackageSummaryView } from '@/server/modules/scenarios'
import { getViewer } from '../viewer'

export const metadata: Metadata = { title: t('packages.title') }

// UI-040. The packages of the session's active institution — the same tenant the shell's switcher
// names — with the family warnings D-083 asks the list to carry.
//
// `listPackages` admits a Scenario Editor, an Instructor and the Platform Admin and refuses everyone
// else (D-748), so the role is read here first and a person who does not hold one of them is told
// so, rather than being handed the error boundary for a refusal that is not a fault. Hiding the rail
// item is the courtesy; this is the courtesy for the address typed by hand, and the service check
// behind it is the enforcement.
//
// An Instructor reads the shelf to choose a confirmed version for an assignment and to read it back
// in review; only a Scenario Editor or the admin authors, so only they are offered "New package".
//
// `package_created_from_seed` (AN-020) is emitted by the service on the screen that creates one;
// this screen fires no analytics of its own.

/** 08 §4, D-748: the roles that read a package, and the ones that also author it. */
const READER_ROLES: readonly PlatformRole[] = ['tassl_scenario_editor', 'instructor', 'admin']
const AUTHOR_ROLES: readonly PlatformRole[] = ['tassl_scenario_editor', 'admin']

/** UI-041 lands with this same step; the path is asserted until typegen has seen the route. */
const NEW_PACKAGE_HREF = '/packages/new' as Route

export default async function PackagesPage({ searchParams }: PageProps<'/packages'>) {
  const [{ actor, me }, query] = await Promise.all([getViewer(), searchParams])

  const membership =
    me.memberships.find((row) => row.organizationId === me.activeOrganizationId) ??
    me.memberships[0]

  if (!membership) {
    return (
      <>
        <PageHeader title={t('packages.title')} />
        <Panel>
          <EmptyState
            headingLevel={2}
            title={t('packages.noInstitutionTitle')}
            body={t('packages.noInstitutionBody')}
          />
        </Panel>
      </>
    )
  }

  if (!READER_ROLES.includes(me.platformRole)) {
    return (
      <>
        <PageHeader title={t('packages.title')} eyebrow={membership.name} />
        <Panel>
          <EmptyState
            headingLevel={2}
            title={t('packages.noAccessTitle')}
            body={t('packages.noAccessBody', { name: membership.name })}
          />
        </Panel>
      </>
    )
  }

  const raw = query.cursor
  const cursor = typeof raw === 'string' && raw.length > 0 ? raw : undefined

  // A hand-edited cursor is a bad address, not an incident: the first page is the honest answer.
  let page: { items: PackageSummaryView[]; nextCursor: string | null }
  try {
    page = await listPackages(actor, membership.organizationId, cursor ? { cursor } : {})
  } catch (error) {
    if (!isAppError(error) || error.code !== 'VALIDATION_ERROR') throw error
    page = await listPackages(actor, membership.organizationId, {})
  }

  const newPackage = AUTHOR_ROLES.includes(me.platformRole) ? (
    <Link href={NEW_PACKAGE_HREF} className={buttonVariants({ className: 'w-fit' })}>
      {t('packages.newPackage')}
    </Link>
  ) : undefined

  return (
    <>
      <PageHeader
        title={t('packages.title')}
        description={t('packages.description')}
        eyebrow={membership.name}
        {...(page.items.length > 0 && newPackage ? { actions: newPackage } : {})}
      />
      <Panel>
        {page.items.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title={t('packages.emptyTitle')}
            body={newPackage ? t('packages.emptyBody') : t('packages.emptyReaderBody')}
            {...(newPackage ? { action: newPackage } : {})}
          />
        ) : (
          <PackagesTable packages={page.items} nextCursor={page.nextCursor} />
        )}
      </Panel>
    </>
  )
}
