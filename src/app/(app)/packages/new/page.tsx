import type { Metadata } from 'next'
import { ImportPackageTrigger, SeedForm } from '@/components/features/packages/seed-form'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { t } from '@/lib/i18n/t'
import type { OrganizationRole } from '@/server/modules/identity/schema'
import { getViewer } from '../../viewer'

export const metadata: Metadata = { title: t('packageNew.title') }

// UI-041 (FR-190). A package family is written into the session's active institution — the tenant
// the shell's switcher names — from a case the author holds the rights to adapt.
//
// The seat is read here so a person who does not hold it is told so, rather than filling a long
// form and being refused by `createPackageFromSeed` at the end of it. Hiding the rail item and the
// list's button is the courtesy; this is the courtesy for the address typed by hand, and the
// service check behind the action is the enforcement (08 §4).
//
// Generation (AI-001) arrives in Phase 12; until then the form creates the package and the version
// is filled by hand in the confirmation workspace or brought in from an export. `SeedForm` says so
// on the control that cannot act and again on the package it just made.
//
// Import is therefore the only route to a populated version in this build, so its control sits in
// the header rather than under the form: a person who arrives with an export in hand finds it
// before reading eight fields and a case-sized textarea.

/** 08 §4: the two institution seats that read and write a package. */
const AUTHOR_ROLES: readonly OrganizationRole[] = ['instructor', 'scenario_author']

export default async function NewPackagePage() {
  const { me } = await getViewer()

  const membership =
    me.memberships.find((row) => row.organizationId === me.activeOrganizationId) ??
    me.memberships[0]

  if (!membership) {
    return (
      <>
        <PageHeader title={t('packageNew.title')} />
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
        <PageHeader title={t('packageNew.title')} eyebrow={membership.name} />
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

  return (
    <>
      <PageHeader
        title={t('packageNew.title')}
        description={t('packageNew.description')}
        eyebrow={membership.name}
        actions={<ImportPackageTrigger orgId={membership.organizationId} />}
      />
      <SeedForm orgId={membership.organizationId} />
    </>
  )
}
