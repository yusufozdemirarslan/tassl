import type { Metadata } from 'next'
import { AdminNav } from '@/components/features/admin/admin-nav'
import { ALL_INSTITUTIONS, AuditFilter } from '@/components/features/admin/audit-filter'
import { AuditTable } from '@/components/features/admin/audit-table'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { t } from '@/lib/i18n/t'
import { INSTITUTION_FILTER_LIMIT, listAuditLog, listInstitutions } from '@/server/modules/admin'
import { getViewer } from '../../viewer'

export const metadata: Metadata = { title: t('admin.audit.title') }

// UI-050 → audit log (SYS-006, DATA-048). The institution filter is a query parameter, so a
// filtered log can be reloaded and linked to; `all` is the filter's own sentinel and is stripped
// here, because the service takes an institution id or nothing (07 §9).
//
// The filter's cap is read here and passed down rather than imported by the control itself: this
// page is a Server Component, so `INSTITUTION_FILTER_LIMIT` costs the browser nothing, while the
// same import inside the `'use client'` control put the whole of classic Zod in this route's
// chunks (16 §3.2, D-600).
export default async function AdminAuditPage({ searchParams }: PageProps<'/admin/audit'>) {
  const [{ actor }, params] = await Promise.all([getViewer(), searchParams])
  const raw = params.orgId
  const selected = (typeof raw === 'string' ? raw : (raw?.[0] ?? '')).trim()
  const orgId = selected === ALL_INSTITUTIONS ? '' : selected

  const [page, institutions] = await Promise.all([
    listAuditLog(actor, orgId ? { orgId } : {}),
    listInstitutions(actor),
  ])

  return (
    <>
      <PageHeader title={t('admin.audit.title')} description={t('admin.audit.description')} />
      <AdminNav current="audit" />
      {/* The page h1 already names the screen, so the panel carries no second copy of it. */}
      <Panel id="admin-audit">
        <div className="flex flex-col gap-4">
          <AuditFilter institutions={institutions} orgId={orgId} limit={INSTITUTION_FILTER_LIMIT} />
          <AuditTable initial={page} orgId={orgId} />
        </div>
      </Panel>
    </>
  )
}
