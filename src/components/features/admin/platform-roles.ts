import { role } from '@/lib/i18n/messages/role'
import { scopedT } from '@/lib/i18n/scoped'
import type { PlatformRole } from '@/server/modules/admin/schema'

// The platform-role vocabulary UI-050's users table works in, written once because the table and
// its confirmation dialog both read it. A type from the module schema and no value: the labels are
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
