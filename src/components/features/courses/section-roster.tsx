'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { literal, object, type output } from 'zod/mini'
import { Loader2Icon, MailPlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormAlert, SubmitButton } from '@/components/features/account/form-feedback'
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
import { t } from '@/lib/i18n/t'
import { addSectionMemberAction, removeSectionMemberAction } from '@/server/modules/courses/actions'
import { inviteMemberAction } from '@/server/modules/tenancy/actions'
import type { SectionMember, SectionRoleValue } from '@/server/modules/courses/schema'
import type { InvitationView, OrganizationRoleValue } from '@/server/modules/tenancy/schema'

// UI-031. The page reads the roster; this component owns the three things the screen does with it:
// add a member by address, remove one, and — when the address belongs to nobody in the institution
// — invite them instead. Both refusals the service can answer here are shown where the person is
// looking rather than in a toast that disappears:
//
//   NOT_SECTION_MEMBER → under the add form, with the invitation as the way forward (D-062);
//   MEMBER_HAS_RUNS    → in the row it refuses, because the row is what the reader is aiming at.
//
// The bound on the address is `emailField` (src/lib/auth/form-fields), the same shape the public
// forms use: a client component never imports the module's schema, which would drag the full Zod
// runtime into the browser (D-186). The rule that decides anything still runs in the action.

/** The section roles a roster row can hold (`section_memberships.role`, 08 §3). */
const SECTION_ROLES = ['student', 'instructor', 'ta'] as const

const SECTION_ROLE_LABELS: Record<SectionRoleValue, string> = {
  student: t('roster.roleStudent'),
  instructor: t('roster.roleInstructor'),
  ta: t('roster.roleTa'),
}

/**
 * The institution role an invitation carries for someone who will hold this section role. A section
 * TA is a teaching assistant of the institution; the other two names are the same in both
 * vocabularies (08 §3).
 */
const INVITATION_ROLES: Record<SectionRoleValue, OrganizationRoleValue> = {
  student: 'student',
  instructor: 'instructor',
  ta: 'teaching_assistant',
}

const ORGANIZATION_ROLE_LABELS: Record<OrganizationRoleValue, string> = {
  student: t('role.student'),
  instructor: t('role.instructor'),
  teaching_assistant: t('role.teaching_assistant'),
  scenario_author: t('role.scenario_author'),
  program_lead: t('role.program_lead'),
}

const ROLE_ITEMS = SECTION_ROLES.map((role) => ({
  value: role,
  label: SECTION_ROLE_LABELS[role],
}))

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
  /** True when the roster is longer than the pages the page read (see the page's cap). */
  truncated: boolean
}

export function SectionRoster({
  sectionId,
  sectionName,
  organizationId,
  members,
  truncated,
}: SectionRosterProps) {
  const router = useRouter()
  const [removing, setRemoving] = useState<string | null>(null)
  const [removalRefusal, setRemovalRefusal] = useState<{ userId: string; message: string } | null>(
    null,
  )
  const [pending, startTransition] = useTransition()
  const [invitations, setInvitations] = useState<InvitationView[]>([])

  function remove(member: SectionMember): void {
    setRemoving(member.userId)
    setRemovalRefusal(null)
    startTransition(async () => {
      const result = await removeSectionMemberAction({ sectionId, userId: member.userId })
      setRemoving(null)
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
                return (
                  <TableRow key={member.userId}>
                    <TableCell className="text-ink">{member.name}</TableCell>
                    <TableCell className="text-ink-muted [overflow-wrap:anywhere] whitespace-normal">
                      {member.email}
                    </TableCell>
                    <TableCell>{SECTION_ROLE_LABELS[member.role]}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending && removing === member.userId}
                          aria-busy={pending && removing === member.userId}
                          aria-label={t('roster.removeLabel', { name: member.name })}
                          {...(refused === null ? {} : { 'aria-describedby': refusalId })}
                          onClick={() => remove(member)}
                        >
                          {pending && removing === member.userId && (
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
        onInvited={(invitation) => setInvitations((current) => [invitation, ...current])}
      />

      <Panel
        id="roster-invitations"
        title={t('roster.invitationsTitle')}
        description={t('roster.invitationsDescription')}
        headingLevel={2}
      >
        {invitations.length === 0 ? (
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
                <TableHead scope="col">{t('roster.invitationsExpires')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell className="text-ink [overflow-wrap:anywhere] whitespace-normal">
                    {invitation.email}
                  </TableCell>
                  <TableCell>{ORGANIZATION_ROLE_LABELS[invitation.role]}</TableCell>
                  <TableCell className="text-mono-sm font-mono tabular-nums">
                    <time dateTime={invitation.expiresAt}>
                      {formatDateTime(invitation.expiresAt)}
                    </time>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  )
}

/**
 * The add form and the invitation that grows out of its one interesting refusal. `notMember` holds
 * the address the service did not recognise, so the invitation is sent for exactly that address and
 * that role rather than for whatever the fields hold by the time the button is pressed.
 */
function AddMemberPanel({
  sectionId,
  organizationId,
  onInvited,
}: {
  sectionId: string
  organizationId: string
  onInvited: (invitation: InvitationView) => void
}) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const [notMember, setNotMember] = useState<{ email: string; role: SectionRoleValue } | null>(null)
  const [inviting, setInviting] = useState(false)

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
        setNotMember({ email: values.email, role: values.role })
      }
      return
    }
    toast.success(t('roster.added', { email: result.data.email }))
    reset({ email: '', role: values.role })
    router.refresh()
  }

  async function invite(): Promise<void> {
    if (notMember === null) return
    setInviting(true)
    const result = await inviteMemberAction({
      orgId: organizationId,
      email: notMember.email,
      role: INVITATION_ROLES[notMember.role],
    })
    setInviting(false)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    toast.success(t('roster.invited', { email: result.data.email }))
    onInvited(result.data)
    setNotMember(null)
    setFormError(null)
    reset({ email: '', role: notMember.role })
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
                  items={ROLE_ITEMS}
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
                    {ROLE_ITEMS.map((item) => (
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
                  disabled={inviting}
                  aria-busy={inviting}
                  onClick={() => {
                    void invite()
                  }}
                >
                  {inviting ? (
                    <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <MailPlusIcon aria-hidden="true" className="size-4" />
                  )}
                  {t('roster.inviteAction')}
                </Button>
              )
            }
          />

          <SubmitButton pending={isSubmitting}>{t('roster.addSubmit')}</SubmitButton>
        </div>
      </form>
    </Panel>
  )
}
