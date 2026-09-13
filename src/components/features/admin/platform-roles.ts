import { role } from '@/lib/i18n/messages/role'
import { scopedT } from '@/lib/i18n/scoped'
import type {
  AssignableInstitutionRole,
  InstitutionRole,
  PlatformRole,
} from '@/server/modules/admin/schema'

// The role vocabulary UI-050's users table works in, written once because the table and its
// confirmation dialog both read it. Types from the module schema and no value: the labels are
// strings, and no Zod runtime crosses into the browser (D-186).
const t = scopedT(role)

/** `user.platform_role` in the order the select offers them, least to most (08 §3, D-007). */
export const PLATFORM_ROLES = ['none', 'tassl_scenario_editor', 'admin'] as const

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  none: t('role.platform.none'),
  tassl_scenario_editor: t('role.platform.tassl_scenario_editor'),
  admin: t('role.platform.admin'),
}

export const PLATFORM_ROLE_ITEMS = PLATFORM_ROLES.map((value) => ({
  value,
  label: PLATFORM_ROLE_LABELS[value],
}))

/**
 * The institution seats the select offers, as two separate choices (D-747). The other three are
 * seats a person can already hold, so they have labels below, but the admin area does not hand them
 * out: a teaching assistant, scenario author or program lead is made one on the roster.
 */
export const INSTITUTION_ROLES = [
  'student',
  'instructor',
] as const satisfies readonly AssignableInstitutionRole[]

/** `member.role` as people read it, the same words the roster and the invitation use (08 §3). */
export const INSTITUTION_ROLE_LABELS: Record<InstitutionRole, string> = {
  student: t('role.student'),
  instructor: t('role.instructor'),
  teaching_assistant: t('role.teaching_assistant'),
  scenario_author: t('role.scenario_author'),
  program_lead: t('role.program_lead'),
}

/**
 * Every seat's label, for the select's trigger: a person who holds one of the three the select does
 * not offer still sees the seat they hold, rather than a raw value or a blank.
 */
export const INSTITUTION_ROLE_ITEMS = (
  Object.keys(INSTITUTION_ROLE_LABELS) as InstitutionRole[]
).map((value) => ({ value, label: INSTITUTION_ROLE_LABELS[value] }))

export function isAssignableInstitutionRole(value: string): value is AssignableInstitutionRole {
  return (INSTITUTION_ROLES as readonly string[]).includes(value)
}
