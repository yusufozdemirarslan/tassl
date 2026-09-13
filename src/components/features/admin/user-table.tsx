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
import {
  listUsersAction,
  setInstitutionRoleAction,
  setPlatformRoleAction,
} from '@/server/modules/admin/actions'
import type {
  AdminMembership,
  AdminUser,
  AdminUserPage,
  AssignableInstitutionRole,
  PlatformRole,
} from '@/server/modules/admin/schema'
import {
  INSTITUTION_ROLES,
  INSTITUTION_ROLE_ITEMS,
  INSTITUTION_ROLE_LABELS,
  PLATFORM_ROLE_ITEMS,
  PLATFORM_ROLE_LABELS,
  isAssignableInstitutionRole,
} from './platform-roles'
import { useRefresh } from '@/lib/hooks/use-refresh'

// UI-050's users table. The first page is rendered on the server; this component owns the three
// things the screen does with it — set a platform role, make somebody a Student or an Instructor of
// an institution they belong to (D-747), and ask for the page after this one.
//
// A role change is asked about before it happens, because it is not only a role change: the service
// revokes every session the person holds, so pressing it signs somebody out mid-sentence. The
// dialog says that in the sentence a person reads before they confirm (DESIGN.md: a consequential
// action is confirmed), and the row updates in place afterwards rather than reloading the table,
// so an admin working down a list does not lose their position.
//
// The two role columns are two different questions and stay two controls. A platform role is a
// right over Tassl; an institution role is a seat in one institution, so a person with seats in two
// institutions has two controls, each named for the person *and* the institution. The select offers
// Student and Instructor; a seat outside the two is shown on the trigger and is not offered back.
//
// Two rows carry no control at all, and each says why rather than showing a control that refuses:
// the actor's own row (the service refuses a self-change — a demotion would revoke the sessions it
// is being made from) and a soft-deleted account (it holds no seat to give). Neither state is drawn
// in red: refusal red is for a refusal, an error or a defect row (DESIGN.md §Semantic), and a
// person who closed their account is none of the three (D-577).

const t = scopedT(admin, ui)

type Pending =
  | { kind: 'platform'; user: AdminUser; role: PlatformRole }
  | {
      kind: 'institution'
      user: AdminUser
      membership: AdminMembership
      role: AssignableInstitutionRole
    }

/** The dialog's two sentences for whichever change is pending. */
function confirmation(pending: Pending): { title: string; body: string } {
  if (pending.kind === 'platform') {
    return {
      title: t('admin.users.confirmTitle'),
      body: t('admin.users.confirmBody', {
        name: pending.user.name,
        from: PLATFORM_ROLE_LABELS[pending.user.platformRole],
        role: PLATFORM_ROLE_LABELS[pending.role],
      }),
    }
  }
  return {
    title: t('admin.users.institutionConfirmTitle'),
    body: t('admin.users.institutionConfirmBody', {
      name: pending.user.name,
      institution: pending.membership.organizationName,
      from: INSTITUTION_ROLE_LABELS[pending.membership.role],
      role: INSTITUTION_ROLE_LABELS[pending.role],
    }),
  }
}

/** The toast after a change the service accepted, read off the account it returned. */
function savedMessage(pending: Pending, saved: AdminUser): string {
  if (pending.kind === 'platform') {
    return t('admin.users.roleSaved', {
      name: saved.name,
      role: PLATFORM_ROLE_LABELS[saved.platformRole],
    })
  }
  const seat = saved.memberships.find(
    (membership) => membership.organizationId === pending.membership.organizationId,
  )
  return t('admin.users.institutionRoleSaved', {
    name: saved.name,
    institution: pending.membership.organizationName,
    role: INSTITUTION_ROLE_LABELS[seat?.role ?? pending.role],
  })
}

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
    const result =
      pending.kind === 'platform'
        ? await setPlatformRoleAction({ userId: pending.user.id, role: pending.role })
        : await setInstitutionRoleAction({
            userId: pending.user.id,
            organizationId: pending.membership.organizationId,
            role: pending.role,
          })
    setSaving(false)
    if (!result.ok) {
      setPending(null)
      toastError(result.error.message)
      return
    }
    const saved = result.data
    setItems((current) => current.map((row) => (row.id === saved.id ? saved : row)))
    setPending(null)
    toastSuccess(savedMessage(pending, saved))
    // The audit log on the next tab has a new row in it.
    refresh()
  }

  const dialog = pending ? confirmation(pending) : null

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
      <Table className="min-w-4xl">
        <TableCaption>{t('admin.users.caption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('admin.users.columnName')}</TableHead>
            <TableHead scope="col">{t('admin.users.columnEmail')}</TableHead>
            <TableHead scope="col">{t('admin.users.columnRole')}</TableHead>
            <TableHead scope="col">{t('admin.users.columnInstitutionRole')}</TableHead>
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
                        setPending({ kind: 'platform', user: row, role: value })
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
                <TableCell className="align-top">
                  {row.memberships.length === 0 ? (
                    <span className="text-ink-muted text-meta">
                      {t('admin.users.institutionNone')}
                    </span>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {row.memberships.map((membership) => (
                        <li key={membership.organizationId} className="flex flex-col gap-1">
                          <span className="text-ink-muted text-meta">
                            {membership.organizationName}
                          </span>
                          {isSelf || isDeleted ? (
                            <span className="text-ink">
                              {INSTITUTION_ROLE_LABELS[membership.role]}
                            </span>
                          ) : (
                            <Select
                              items={INSTITUTION_ROLE_ITEMS}
                              value={membership.role}
                              onValueChange={(value: string | null) => {
                                if (value === null || value === membership.role) return
                                if (!isAssignableInstitutionRole(value)) return
                                setPending({
                                  kind: 'institution',
                                  user: row,
                                  membership,
                                  role: value,
                                })
                              }}
                            >
                              <SelectTrigger
                                className="w-full"
                                aria-label={t('admin.users.institutionRoleLabel', {
                                  name: row.name,
                                  institution: membership.organizationName,
                                })}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {INSTITUTION_ROLES.map((value) => (
                                  <SelectItem key={value} value={value}>
                                    {INSTITUTION_ROLE_LABELS[value]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </li>
                      ))}
                    </ul>
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
            <AlertDialogTitle>{dialog?.title ?? t('admin.users.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{dialog?.body ?? ''}</AlertDialogDescription>
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
