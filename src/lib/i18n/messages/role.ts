// Organization roles as people read them (08-auth-authz.md §3)
import { scopedT } from '../scoped'

export const role = {
  'role.student': 'Student',
  'role.instructor': 'Instructor',
  'role.teaching_assistant': 'Teaching assistant',
  'role.scenario_author': 'Scenario author',
  'role.program_lead': 'Program lead',

  // Platform roles (08 §3, `user.platform_role`). A right over Tassl itself rather than a seat in
  // an institution, which is why the admin screen names them apart from the five above (UI-050).
  'role.platform.none': 'None',
  'role.platform.tassl_scenario_editor': 'Scenario editor',
  'role.platform.admin': 'Platform admin',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(role)
