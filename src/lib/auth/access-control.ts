// Better Auth access control (docs/tech/08-auth-authz.md §3). It sits in src/lib because the
// browser auth client loads the same statement and roles (D-170); it has no server imports.
import { createAccessControl } from 'better-auth/plugins/access'

export const statement = {
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  course: ['create', 'update', 'read'],
  package: ['create', 'read', 'confirm', 'generate'],
  agreement: ['read', 'update'],
  report: ['read'],
} as const

export const ac = createAccessControl(statement)

export const roles = {
  student: ac.newRole({ course: ['read'] }),
  instructor: ac.newRole({
    course: ['create', 'update', 'read'],
    invitation: ['create', 'cancel'],
    member: ['create'],
    package: ['create', 'read', 'confirm', 'generate'],
  }),
  teaching_assistant: ac.newRole({ course: ['read'] }),
  scenario_author: ac.newRole({
    package: ['create', 'read', 'confirm', 'generate'],
    course: ['read'],
  }),
  program_lead: ac.newRole({
    organization: ['update'],
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
    agreement: ['read', 'update'],
    report: ['read'],
    course: ['read'],
  }),
}

export type OrganizationRole = keyof typeof roles
