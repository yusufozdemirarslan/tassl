'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/layout/empty-state'
import { formatDateTime } from '@/lib/format/date-time'
import { admin } from '@/lib/i18n/messages/admin'
import { ui } from '@/lib/i18n/messages/ui'
import { scopedT } from '@/lib/i18n/scoped'
import { toastError, toastSuccess } from '@/lib/toast'
import { listUsersAction, setPlatformRoleAction } from '@/server/modules/admin/actions'
import type { AdminUser, AdminUserPage, PlatformRole } from '@/server/modules/admin/schema'
import { PLATFORM_ROLE_ITEMS, PLATFORM_ROLE_LABELS } from './platform-roles'
import { useRefresh } from '@/lib/hooks/use-refresh'

// UI-050's users table. The first page is rendered on the server; this component owns the two
// things the screen does with it — set a platform role, and ask for the page after this one.
//
// A role change is asked about before it happens, because it is not only a role change: the service
// revokes every session the person holds, so pressing it signs somebody out mid-sentence. The
// dialog says that in the sentence a person reads before they confirm (DESIGN.md: a consequential
// action is confirmed), and the row updates in place afterwards rather than reloading the table,
// so an admin working down a list does not lose their position.
//
// Two rows carry no control at all, and each says why rather than showing a control that refuses:
// the actor's own row (the service refuses a self-change — a demotion would revoke the sessions it
// is being made from) and a soft-deleted account (it holds no seat to give). Neither state is drawn
// in red: refusal red is for a refusal, an error or a defect row (DESIGN.md §Semantic), and a
// person who closed their account is none of the three (D-577).

const t = scopedT(admin, ui)

type Pending = { user: AdminUser; role: PlatformRole }

export function UserTable({
  initial,
  query,
  selfId,
}: {
  initial: AdminUserPage
  /** The email prefix the page was rendered with; carried into every "show more". */
  query: string
  selfId: string
}) {
  const refresh = useRefresh()
  const [items, setItems] = useState<readonly AdminUser[]>(initial.items)
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [saving, setSaving] = useState(false)

  async function loadMore(): Promise<void> {
    if (cursor === null || loading) return
    setLoading(true)
    const result = await listUsersAction(query ? { cursor, q: query } : { cursor })
    setLoading(false)
    if (!result.ok) {
      toastError(result.error.message)
      return
    }
    setItems((current) => [...current, ...result.data.items])
    setCursor(result.data.nextCursor)
  }

  async function confirm(): Promise<void> {
    if (!pending) return
    setSaving(true)
    const result = await setPlatformRoleAction({ userId: pending.user.id, role: pending.role })
    setSaving(false)
    if (!result.ok) {
      setPending(null)
      toastError(result.error.message)
      return
    }
    const saved = result.data
    setItems((current) => current.map((row) => (row.id === saved.id ? saved : row)))
    setPending(null)
    toastSuccess(
      t('admin.users.roleSaved', {
        name: saved.name,
        role: PLATFORM_ROLE_LABELS[saved.platformRole],
      }),
    )
    // The audit log on the next tab has a new row in it.
    refresh()
  }

  if (items.length === 0) {
    return (
      <EmptyState
        headingLevel={2}
        title={query ? t('admin.users.emptySearch') : t('admin.users.empty')}
        body={query ? t('admin.users.emptySearchBody') : t('admin.users.emptyBody')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Table className="min-w-3xl">
        <TableCaption>{t('admin.users.caption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('admin.users.columnName')}</TableHead>
            <TableHead scope="col">{t('admin.users.columnEmail')}</TableHead>
            <TableHead scope="col">{t('admin.users.columnRole')}</TableHead>
            <TableHead scope="col">{t('admin.users.columnJoined')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row) => {
            const isSelf = row.id === selfId
            const isDeleted = row.deletedAt !== null
            return (
              <TableRow key={row.id}>
                <TableHead scope="row" className="text-ink align-top font-medium">
                  <span className="flex flex-wrap items-center gap-2">
                    {row.name}
                    {isSelf && <Badge variant="outline">{t('admin.users.selfLabel')}</Badge>}
                    {isDeleted && (
                      <Badge variant="secondary">{t('admin.users.deletedLabel')}</Badge>
                    )}
                  </span>
                </TableHead>
                <TableCell className="text-mono-sm align-top font-mono break-words">
                  {row.email}
                </TableCell>
                <TableCell className="align-top">
                  {isSelf || isDeleted ? (
                    <span className="flex flex-col gap-1">
                      <span className="text-ink">{PLATFORM_ROLE_LABELS[row.platformRole]}</span>
                      <span className="text-ink-muted text-meta">
                        {isSelf ? t('admin.users.roleSelfNote') : t('admin.users.roleDeletedNote')}
                      </span>
                    </span>
                  ) : (
                    <Select
                      items={PLATFORM_ROLE_ITEMS}
                      value={row.platformRole}
                      onValueChange={(value: PlatformRole | null) => {
                        if (value === null || value === row.platformRole) return
                        setPending({ user: row, role: value })
                      }}
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-label={t('admin.users.roleLabel', { name: row.name })}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLATFORM_ROLE_ITEMS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell className="text-ink-muted align-top whitespace-nowrap">
                  {formatDateTime(row.createdAt)}
                </TableCell>
              </TableRow>
            )
          })}
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
          {loading ? t('admin.users.loadMoreBusy') : t('admin.users.loadMore')}
        </Button>
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next && !saving) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.users.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending
                ? t('admin.users.confirmBody', {
                    name: pending.user.name,
                    from: PLATFORM_ROLE_LABELS[pending.user.platformRole],
                    role: PLATFORM_ROLE_LABELS[pending.role],
                  })
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>
              {t('admin.users.confirmCancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="primary"
              disabled={saving}
              aria-busy={saving}
              onClick={() => {
                void confirm()
              }}
            >
              {saving && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
              {t('admin.users.confirmSubmit')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
