'use client'

import { FilterIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { t } from '@/lib/i18n/messages/admin'
import type { InstitutionRef } from '@/server/modules/admin/schema'

// UI-050's "filter by org", as a GET form: the institution lands in the address, so a filtered log
// can be reloaded and linked to, and the "show more" below it carries the same filter.
//
// `ALL` is a sentinel rather than an empty value: an empty option in a select is a hole a reader
// cannot tell from an unset control, and the page strips the sentinel before it reaches the
// service — where `orgId` is an institution id or nothing at all (07 §9).
export const ALL_INSTITUTIONS = 'all'

export function AuditFilter({
  institutions,
  orgId,
  limit,
}: {
  institutions: readonly InstitutionRef[]
  /** The institution the page was rendered for, or '' for every institution. */
  orgId: string
  /**
   * `INSTITUTION_FILTER_LIMIT` (D-572), passed rather than imported (D-600).
   *
   * The constant lives in the module's `schema.ts`, and that file is classic Zod: a *value* import
   * from it here would put Zod's namespace object — `toJSONSchema`, the locale table, every schema
   * class — in this page's chunks, which is 90,656 bytes gzip and what put `/admin/audit` over
   * budget (16 §3.2, D-184). The page is a Server Component and already reads the module, so it
   * hands the cap down as a number and the type import beside it erases at compile time.
   */
  limit: number
}) {
  const items = [
    { value: ALL_INSTITUTIONS, label: t('admin.audit.filterAll') },
    ...institutions.map((institution) => ({ value: institution.id, label: institution.name })),
  ]

  return (
    <form method="get" action="/admin/audit" className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-56 flex-col gap-1">
        <span id="admin-audit-filter-label" className="text-ink text-meta font-medium">
          {t('admin.audit.filterLabel')}
        </span>
        <Select name="orgId" items={items} defaultValue={orgId === '' ? ALL_INSTITUTIONS : orgId}>
          <SelectTrigger className="w-full" aria-labelledby="admin-audit-filter-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" variant="secondary">
        <FilterIcon aria-hidden="true" className="size-4" />
        {t('admin.audit.filterSubmit')}
      </Button>
      {/* The list is capped (D-572). An instrument that silently drops the row you are looking for
          is worse than one that admits its range, so it says so rather than reading empty. */}
      {institutions.length >= limit && (
        <p className="text-ink-muted text-meta max-w-measure basis-full">
          {t('admin.audit.filterTruncated', { count: limit })}
        </p>
      )}
    </form>
  )
}
