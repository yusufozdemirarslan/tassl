import { role } from '@/lib/i18n/messages/role'
import { scopedT } from '@/lib/i18n/scoped'
import type { PlatformRole } from '@/server/modules/admin/schema'

// The role vocabulary UI-050's users table works in, written once because the table, its
// confirmation dialog and the section roster all read it. Types from the module schema and no
// value: the labels are strings, and no Zod runtime crosses into the browser (D-186).
const t = scopedT(role)

/**
 * `user.platform_role` in the order the select offers them, most access first (08 §3, D-748): one
 * role per account, and these four are every role there is.
 */
export const PLATFORM_ROLES = [
  'admin',
  'tassl_scenario_editor',
  'instructor',
  'student',
] as const satisfies readonly PlatformRole[]

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  admin: t('role.admin'),
  tassl_scenario_editor: t('role.tassl_scenario_editor'),
  instructor: t('role.instructor'),
  student: t('role.student'),
}

export const PLATFORM_ROLE_ITEMS = PLATFORM_ROLES.map((value) => ({
  value,
  label: PLATFORM_ROLE_LABELS[value],
}))
