'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { literal, object, type output } from 'zod/mini'
import { HourglassIcon, Loader2Icon, MailPlusIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormAlert, SubmitButton } from '@/components/features/account/form-feedback'
import {
  INVITATION_ROLES,
  ORGANIZATION_ROLE_LABELS,
  SECTION_ROLES,
  SECTION_ROLE_ITEMS,
  SECTION_ROLE_LABELS,
  type InviteRoleValue,
} from '@/components/features/roster/roster-roles'
import { EmptyState } from '@/components/layout/empty-state'
import { Panel } from '@/components/layout/panel'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
import { emailField } from '@/lib/auth/form-fields'
import { formatDateTime } from '@/lib/format/date-time'
import { useDeferredModule, type DeferredModule } from '@/lib/hooks/use-deferred-module'
import { roster } from '@/lib/i18n/messages/roster'
import { ui } from '@/lib/i18n/messages/ui'
import { scopedT } from '@/lib/i18n/scoped'
import { addSectionMemberAction, removeSectionMemberAction } from '@/server/modules/courses/actions'
import type { SectionMember, SectionRoleValue } from '@/server/modules/courses/schema'
import type { InvitationView } from '@/server/modules/tenancy/schema'

// UI-031. The page reads the roster and the institution's outstanding invitations; this component
// owns the four things the screen does with them: add a member by address, take one off the
// roster, invite an address that belongs to nobody in the institution yet, and show what has been
// invited. Both refusals the service can answer here are shown where the person is looking rather
// than in a toast that disappears:
//
//   NOT_SECTION_MEMBER → under the add form, with the invitation as the way forward (D-062);
//   MEMBER_HAS_RUNS    → in the row it refuses, because the row is what the reader is aiming at.
//
// The two consequential actions ask first. Removing someone unseats them on the spot and there is
// no undo, and "Invite to institution" sends mail; DESIGN.md asks a destructive action to be
// confirmed and UI-031 says the invite action opens the invitation form, so both now open an
// overlay. Neither overlay is part of the first paint: `./roster-dialogs` is one chunk fetched on
// the press that needs it (B4), and the roster paints two tables, an add form and its buttons.
//
// The bound on the address is `emailField` (src/lib/auth/form-fields), the same shape the public
// forms use: a client component never imports the module's schema, which would drag the full Zod
// runtime into the browser (D-186). The rule that decides anything still runs in the action.

// The roster's own vocabulary, plus the one shared line a deferred overlay shows when its chunk
// does not arrive (ui.actionLoadFailed).
const t = scopedT(roster, ui)

/** `load` must be a module-scope arrow holding a literal `import()` for the bundler to split it. */
const loadDialogs = () => import('@/components/features/roster/roster-dialogs')

type RosterDialogs = DeferredModule<typeof import('@/components/features/roster/roster-dialogs')>

/**
 * `listInvitations` resolves the seven-day expiry on the server and hands the screen a state, so
 * nothing here compares a deadline against the browser's own clock (D-177).
 */
const EXPIRED = 'expired'

/**
 * A 32 px row control is below the 40 px minimum this product commits to (DESIGN.md §Layout), and
 * growing the control would loosen a dense table. The radio primitive answers this the same way:
 * the drawn control keeps its size and a transparent `::after` carries the target, four pixels
 * above and below, which is what a pointer and a screen reader's touch exploration actually hit.
 */
const ROW_ACTION_HIT_AREA = 'relative after:absolute after:inset-x-0 after:-inset-y-1'

const addMemberSchema = object({
  email: emailField,
  role: literal(SECTION_ROLES, { error: t('roster.addRole') }),
})

type AddMemberValues = output<typeof addMemberSchema>

type SectionRosterProps = {
  sectionId: string
  sectionName: string
  /** The institution the section belongs to; an invitation is written against it, not the section. */
  organizationId: string
  members: readonly SectionMember[]
  /** The institution's outstanding invitations, pending and expired (UI-031). */
  invitations: readonly InvitationView[]
  /** True when the roster is longer than the pages the page read (see the page's cap). */
  truncated: boolean
}

export function SectionRoster({
  sectionId,
  sectionName,
  organizationId,
  members,
  invitations,
  truncated,
}: SectionRosterProps) {
  const router = useRouter()
  const [removing, setRemoving] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<SectionMember | null>(null)
  const [removalRefusal, setRemovalRefusal] = useState<{ userId: string; message: string } | null>(
    null,
  )
  const [pending, startTransition] = useTransition()
  // What this screen has just sent, prepended until `router.refresh()` brings the row back from
  // the server; the id match is what retires the optimistic copy.
  const [justSent, setJustSent] = useState<readonly InvitationView[]>([])
  const dialogs = useDeferredModule(loadDialogs)
  const RemoveMemberDialog = dialogs.loaded?.RemoveMemberDialog

  const shownInvitations = [
    ...justSent.filter((sent) => !invitations.some((row) => row.id === sent.id)),
    ...invitations,
  ]

  function confirmRemoval(member: SectionMember): void {
    setRemovalRefusal(null)
    setConfirming(member)
    dialogs.request()
  }

  function remove(member: SectionMember): void {
    setRemoving(member.userId)
    setRemovalRefusal(null)
    startTransition(async () => {
      const result = await removeSectionMemberAction({ sectionId, userId: member.userId })
      setRemoving(null)
      // The dialog closes either way: Base UI hands focus back to the row's own control, which
      // points at the refusal below it when there is one.
      setConfirming(null)
      if (!result.ok) {
        // MEMBER_HAS_RUNS and every other refusal stay on the row until the reader acts on them.
        setRemovalRefusal({ userId: member.userId, message: result.error.message })
        return
      }
      toast.success(t('roster.removed', { name: member.name }))
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* An overlay whose chunk never arrived would leave a button that does nothing, so the
          screen says so and the next press retries the import. */}
      <FormAlert message={dialogs.status === 'failed' ? t('ui.actionLoadFailed') : null} />

      <Panel id="roster-members" title={t('roster.membersTitle')} headingLevel={2}>
        {members.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title={t('roster.membersEmptyTitle')}
            body={t('roster.membersEmptyBody')}
          />
        ) : (
          <Table>
            <TableCaption>{t('roster.membersCaption', { section: sectionName })}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('roster.columnName')}</TableHead>
                <TableHead scope="col">{t('roster.columnEmail')}</TableHead>
                <TableHead scope="col">{t('roster.columnRole')}</TableHead>
                <TableHead scope="col">
                  <span className="sr-only">{t('roster.columnActions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const refused =
                  removalRefusal?.userId === member.userId ? removalRefusal.message : null
                const refusalId = `roster-refusal-${member.userId}`
                const busy = pending && removing === member.userId
                return (
                  <TableRow key={member.userId}>
                    <TableCell className="text-ink">{member.name}</TableCell>
                    <TableCell className="text-ink-muted">{member.email}</TableCell>
                    <TableCell>{SECTION_ROLE_LABELS[member.role]}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className={ROW_ACTION_HIT_AREA}
                          aria-haspopup="dialog"
                          aria-busy={busy}
                          aria-label={t('roster.removeLabel', { name: member.name })}
                          {...(refused === null ? {} : { 'aria-describedby': refusalId })}
                          onClick={() => confirmRemoval(member)}
                        >
                          {busy && (
                            <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
                          )}
                          {t('roster.remove')}
                        </Button>
                        {refused !== null && (
                          <p
                            id={refusalId}
                            role="alert"
                            className="border-red bg-red-soft text-ink text-meta max-w-[44ch] rounded-md border p-2 text-left whitespace-normal"
                          >
                            {refused}
                          </p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {truncated && (
          <p className="text-ink-muted text-meta mt-3">
            {t('roster.truncated', { count: members.length })}
          </p>
        )}
      </Panel>

      <AddMemberPanel
        sectionId={sectionId}
        organizationId={organizationId}
        dialogs={dialogs}
        onInvited={(invitation) => {
          setJustSent((current) => [invitation, ...current])
          router.refresh()
        }}
      />

      <Panel
        id="roster-invitations"
        title={t('roster.invitationsTitle')}
        description={t('roster.invitationsDescription')}
        headingLevel={2}
      >
        {shownInvitations.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title={t('roster.invitationsEmptyTitle')}
            body={t('roster.invitationsEmptyBody')}
          />
        ) : (
          <Table>
            <TableCaption>{t('roster.invitationsCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('roster.columnEmail')}</TableHead>
                <TableHead scope="col">{t('roster.columnRole')}</TableHead>
                <TableHead scope="col">{t('roster.columnStatus')}</TableHead>
                <TableHead scope="col">{t('roster.invitationsExpires')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownInvitations.map((invitation) => {
                const expired = invitation.status === EXPIRED
                return (
                  <TableRow key={invitation.id}>
                    <TableCell className="text-ink">{invitation.email}</TableCell>
                    <TableCell>{ORGANIZATION_ROLE_LABELS[invitation.role]}</TableCell>
                    <TableCell className="text-ink">
                      {/* Semantic color is the icon; the text beside it stays ink and says the
                          state in words (DESIGN.md: the Amber-Is-Not-Text rule). */}
                      <span className="inline-flex items-center gap-1.5">
                        {expired ? (
                          <HourglassIcon aria-hidden="true" className="text-amber size-4" />
                        ) : (
                          <SendIcon aria-hidden="true" className="text-primary size-4" />
                        )}
                        {expired ? t('roster.invitationExpired') : t('roster.invitationPending')}
                      </span>
                    </TableCell>
                    <TableCell className="text-mono-sm font-mono tabular-nums">
                      <time dateTime={invitation.expiresAt}>
                        {formatDateTime(invitation.expiresAt)}
                      </time>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Panel>

      {RemoveMemberDialog && confirming !== null && (
        <RemoveMemberDialog
          name={confirming.name}
          email={confirming.email}
          sectionName={sectionName}
          open
          onOpenChange={(next) => {
            // Cancel, Escape and the scrim all land here; a removal in flight owns the dialog.
            if (!next && !pending) setConfirming(null)
          }}
          pending={pending && removing === confirming.userId}
          onConfirm={() => remove(confirming)}
        />
      )}
    </div>
  )
}

/**
 * The add form and the invitation that grows out of its one interesting refusal. `notMember` holds
 * the address the service did not recognise, so the invitation is offered for exactly that address
 * and that seat rather than for whatever the fields hold by the time the button is pressed.
 *
 * The invitation itself is a form in a dialog, not a press: `./roster-dialogs` arrives with the
 * press that asks for it and sends nothing until Send.
 */
function AddMemberPanel({
  sectionId,
  organizationId,
  dialogs,
  onInvited,
}: {
  sectionId: string
  organizationId: string
  dialogs: RosterDialogs
  onInvited: (invitation: InvitationView) => void
}) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const [notMember, setNotMember] = useState<{
    email: string
    /** What the add form asked for, so the form comes back to it once the invitation is away. */
    sectionRole: SectionRoleValue
    role: InviteRoleValue
  } | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const InviteMemberDialog = dialogs.loaded?.InviteMemberDialog

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddMemberValues>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { email: '', role: 'student' },
  })

  async function onSubmit(values: AddMemberValues): Promise<void> {
    setFormError(null)
    setNotMember(null)
    const result = await addSectionMemberAction({ sectionId, ...values })
    if (!result.ok) {
      setFormError(result.error.message)
      // The address belongs to nobody in the institution yet: the way forward is an invitation.
      if (result.error.code === 'NOT_SECTION_MEMBER') {
        setNotMember({
          email: values.email,
          sectionRole: values.role,
          role: INVITATION_ROLES[values.role],
        })
      }
      return
    }
    toast.success(t('roster.added', { email: result.data.email }))
    reset({ email: '', role: values.role })
    router.refresh()
  }

  return (
    <Panel
      id="roster-add"
      title={t('roster.addTitle')}
      description={t('roster.addDescription')}
      headingLevel={2}
    >
      <form noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
        <div className="flex max-w-[48ch] flex-col gap-5">
          <Field data-invalid={errors.email ? 'true' : undefined}>
            <FieldLabel htmlFor="roster-add-email">{t('roster.addEmail')}</FieldLabel>
            <Input
              id="roster-add-email"
              type="email"
              autoComplete="off"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'roster-add-email-error' : undefined}
              {...register('email')}
            />
            <FieldError id="roster-add-email-error">{errors.email?.message}</FieldError>
          </Field>

          <Field>
            <FieldLabel htmlFor="roster-add-role">{t('roster.addRole')}</FieldLabel>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select
                  items={SECTION_ROLE_ITEMS}
                  value={field.value}
                  onValueChange={(value: SectionRoleValue | null) => {
                    // Base UI can report an empty selection; the roster always holds a role.
                    if (value !== null) field.onChange(value)
                  }}
                >
                  <SelectTrigger id="roster-add-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SECTION_ROLE_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          <FormAlert
            message={formError}
            action={
              notMember === null ? undefined : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className={ROW_ACTION_HIT_AREA}
                  aria-haspopup="dialog"
                  onClick={() => {
                    setInviteOpen(true)
                    dialogs.request()
                  }}
                >
                  <MailPlusIcon aria-hidden="true" className="size-4" />
                  {t('roster.inviteAction')}
                </Button>
              )
            }
          />

          <SubmitButton pending={isSubmitting}>{t('roster.addSubmit')}</SubmitButton>
        </div>
      </form>

      {InviteMemberDialog && inviteOpen && notMember !== null && (
        <InviteMemberDialog
          orgId={organizationId}
          email={notMember.email}
          role={notMember.role}
          open
          onOpenChange={setInviteOpen}
          onInvited={(invitation) => {
            onInvited(invitation)
            // The refusal that offered the invitation has been answered; the form starts again on
            // the seat it was asking for.
            reset({ email: '', role: notMember.sectionRole })
            setNotMember(null)
            setFormError(null)
          }}
        />
      )}
    </Panel>
  )
}
