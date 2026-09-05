// Organization roles as people read them (08-auth-authz.md §3)
import { scopedT } from '../scoped'

export const role = {
  'role.student': 'Student',
  'role.instructor': 'Instructor',
  'role.teaching_assistant': 'Teaching assistant',
  'role.scenario_author': 'Scenario author',
  'role.program_lead': 'Program lead',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(role)
