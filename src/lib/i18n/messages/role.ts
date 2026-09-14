// The four platform roles as people read them (08-auth-authz.md §3, D-748). One role per account,
// `user.platform_role`, and these are the only role names any screen prints.
import { scopedT } from '../scoped'

export const role = {
  'role.admin': 'Platform Admin',
  'role.tassl_scenario_editor': 'Scenario Editor',
  'role.instructor': 'Instructor',
  'role.student': 'Student',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(role)
