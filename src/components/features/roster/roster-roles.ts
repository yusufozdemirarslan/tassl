import { t } from '@/lib/i18n/t'
import type { SectionRoleValue } from '@/server/modules/courses/schema'
import type { OrganizationRoleValue } from '@/server/modules/tenancy/schema'

// The two role vocabularies UI-031 works in, written once because the screen and the invitation
// dialog behind it both read them and the dialog is a separate chunk (B4, see ./roster-dialogs).
// Types only from the module schemas: the labels are strings, and no Zod runtime crosses into the
// browser (D-186).

/** The section roles a roster row can hold (`section_memberships.role`, 08 §3). */
export const SECTION_ROLES = ['student', 'instructor', 'ta'] as const

export const SECTION_ROLE_LABELS: Record<SectionRoleValue, string> = {
  student: t('roster.roleStudent'),
  instructor: t('roster.roleInstructor'),
  ta: t('roster.roleTa'),
}

export const SECTION_ROLE_ITEMS = SECTION_ROLES.map((role) => ({
  value: role,
  label: SECTION_ROLE_LABELS[role],
}))

export const ORGANIZATION_ROLE_LABELS: Record<OrganizationRoleValue, string> = {
  student: t('role.student'),
  instructor: t('role.instructor'),
  teaching_assistant: t('role.teaching_assistant'),
  scenario_author: t('role.scenario_author'),
  program_lead: t('role.program_lead'),
}

/**
 * The seats a roster may invite into. A scenario author and a program lead are institution
 * appointments rather than teaching seats, so a section roster does not hand those out; the
 * institution screens do.
 */
export const INVITE_ROLE_VALUES = [
  'student',
  'instructor',
  'teaching_assistant',
] as const satisfies readonly OrganizationRoleValue[]

export type InviteRoleValue = (typeof INVITE_ROLE_VALUES)[number]

export const INVITE_ROLE_ITEMS = INVITE_ROLE_VALUES.map((role) => ({
  value: role,
  label: ORGANIZATION_ROLE_LABELS[role],
}))

/**
 * The institution role an invitation carries for someone who will hold this section role. A section
 * TA is a teaching assistant of the institution; the other two names are the same in both
 * vocabularies (08 §3).
 */
export const INVITATION_ROLES: Record<SectionRoleValue, InviteRoleValue> = {
  student: 'student',
  instructor: 'instructor',
  ta: 'teaching_assistant',
}
