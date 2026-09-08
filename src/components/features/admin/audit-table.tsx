'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2Icon } from 'lucide-react'
import { EmptyState } from '@/components/layout/empty-state'
import { RecordDisclosure } from '@/components/layout/record-disclosure'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/format/date-time'
import { admin } from '@/lib/i18n/messages/admin'
import { ui } from '@/lib/i18n/messages/ui'
import { scopedT } from '@/lib/i18n/scoped'
import { toastError } from '@/lib/toast'
import { listAuditLogAction } from '@/server/modules/admin/actions'
import type { AuditEntry, AuditEntryPage } from '@/server/modules/admin/schema'

// UI-050's audit table. Append-only rows, newest first, with the institution filter carried in the
// address by the page above and into every "show more" from here.
//
// It is the same artifact the instructor's replay reads — an append-only, time-ordered event log —
// so it is drawn the same way (`features/review/replay-trace.tsx`): the timestamp is the row's
// header, in mono with tabular figures inside a `<time>`, and the row's own record opens in a
// native `<details>` rather than being thrown away. `audit_logs.metadata` is where a role change
// says what it changed *from* (`{ from, to, sessionsRevoked }`), and a log that records that and
// does not show it answers the only question an incident asks with a shrug (D-576).
//
// The actor and the institution are ids and are shown as ids: an audit row is read next to a log
// line and a request id, and resolving one to a name would be a second read per row that could
// disagree with what the row actually recorded. A row with no actor is the system (a job, the
// seed); a row with no institution is a platform act, which is what a role change is.

const t = scopedT(admin, ui)

export function AuditTable({
  initial,
  orgId,
}: {
  initial: AuditEntryPage
  /** The institution the page was rendered for, or '' for every institution. */
  orgId: string
}) {
  const [items, setItems] = useState<readonly AuditEntry[]>(initial.items)
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor)
  const [loading, setLoading] = useState(false)

  async function loadMore(): Promise<void> {
    if (cursor === null || loading) return
    setLoading(true)
    const result = await listAuditLogAction(orgId ? { cursor, orgId } : { cursor })
    setLoading(false)
    if (!result.ok) {
      toastError(result.error.message)
      return
    }
    setItems((current) => [...current, ...result.data.items])
    setCursor(result.data.nextCursor)
  }

  if (items.length === 0) {
    return (
      <EmptyState
        headingLevel={2}
        title={orgId ? t('admin.audit.emptyFiltered') : t('admin.audit.empty')}
        body={orgId ? t('admin.audit.emptyFilteredBody') : t('admin.audit.emptyBody')}
        action={
          orgId ? (
            <Link href="/admin/audit" className={buttonVariants({ variant: 'secondary' })}>
              {t('admin.audit.emptyFilteredAction')}
            </Link>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Table className="min-w-3xl">
        <TableCaption>{t('admin.audit.caption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('admin.audit.columnTime')}</TableHead>
            <TableHead scope="col">{t('admin.audit.columnAction')}</TableHead>
            <TableHead scope="col">{t('admin.audit.columnTarget')}</TableHead>
            <TableHead scope="col">{t('admin.audit.columnActor')}</TableHead>
            <TableHead scope="col">{t('admin.audit.columnOrg')}</TableHead>
            <TableHead scope="col">{t('admin.audit.columnRequest')}</TableHead>
            <TableHead scope="col">{t('admin.audit.columnRecord')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => (
            <TableRow key={row.id}>
              <TableHead
                scope="row"
                className="text-ink-muted text-mono-sm align-top font-mono tabular-nums"
              >
                <time dateTime={row.createdAt}>{formatDateTime(row.createdAt)}</time>
              </TableHead>
              <TableCell className="text-ink text-mono-sm align-top font-mono">
                {row.action}
              </TableCell>
              <TableCell className="text-mono-sm align-top font-mono break-words">
                {row.targetType} {row.targetId}
              </TableCell>
              <TableCell className="text-mono-sm align-top font-mono break-words">
                {row.actorId ?? t('admin.audit.systemActor')}
              </TableCell>
              <TableCell className="text-mono-sm align-top font-mono break-words">
                {row.organizationId ?? t('admin.audit.platformOrg')}
              </TableCell>
              <TableCell className="text-mono-sm align-top font-mono break-words">
                {row.requestId}
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                <RecordDisclosure
                  record={row.metadata}
                  label={t('admin.audit.openRecord')}
                  emptyLabel={t('admin.audit.noRecord')}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {cursor !== null && (
        <Button
          variant="secondary"
          className="w-fit"
          disabled={loading}
          aria-busy={loading}
          onClick={() => {
            void loadMore()
          }}
        >
          {loading && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
          {loading ? t('admin.audit.loadMoreBusy') : t('admin.audit.loadMore')}
        </Button>
      )}
    </div>
  )
}
