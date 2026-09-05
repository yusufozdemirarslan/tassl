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
import type { OrganizationRole } from '@/server/modules/identity/schema'
import { listPackages, type PackageSummaryView } from '@/server/modules/scenarios'
import { getViewer } from '../viewer'

export const metadata: Metadata = { title: t('packages.title') }

// UI-040. The packages of the session's active institution — the same tenant the shell's switcher
// names — with the family warnings D-083 asks the list to carry.
//
// `listPackages` admits an instructor or a scenario author and refuses everyone else, so the seat
// is read here first and a person who does not hold it is told so, rather than being handed the
// error boundary for a refusal that is not a fault. Hiding the rail item is the courtesy; this is
// the courtesy for the address typed by hand, and the service check behind it is the enforcement.
//
// `package_created_from_seed` (AN-020) is emitted by the service on the screen that creates one;
// this screen fires no analytics of its own.

/** 08 §4: the two institution seats that read and write a package. */
const AUTHOR_ROLES: readonly OrganizationRole[] = ['instructor', 'scenario_author']

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

  if (!AUTHOR_ROLES.includes(membership.role)) {
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

  const newPackage = (
    <Link href={NEW_PACKAGE_HREF} className={buttonVariants({ className: 'w-fit' })}>
      {t('packages.newPackage')}
    </Link>
  )

  return (
    <>
      <PageHeader
        title={t('packages.title')}
        description={t('packages.description')}
        eyebrow={membership.name}
        {...(page.items.length > 0 ? { actions: newPackage } : {})}
      />
      <Panel>
        {page.items.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title={t('packages.emptyTitle')}
            body={t('packages.emptyBody')}
            action={newPackage}
          />
        ) : (
          <PackagesTable packages={page.items} nextCursor={page.nextCursor} />
        )}
      </Panel>
    </>
  )
}
