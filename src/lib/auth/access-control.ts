// Better Auth access control for the organization plugin (docs/tech/08-auth-authz.md §3). It sits in
// src/lib because the browser auth client loads the same statement and roles (D-170); it has no
// server imports.
//
// One role per account (D-748): Tassl's roles live on `user.platform_role` and are enforced by
// src/server/auth/permissions.ts. A `member` row is membership and nothing else, so the plugin knows
// exactly one role — its own default, `member` — and the database refuses any other value. The
// permission below is the plugin's precondition for the two invitation calls Tassl makes through it;
// who may invite is decided by the tenancy service before the plugin is reached.
import { createAccessControl } from 'better-auth/plugins/access'

export const statement = {
  invitation: ['create', 'cancel'],
} as const

export const ac = createAccessControl(statement)

/** The plugin's single membership role; `member.role` can hold nothing else. */
export const MEMBERSHIP_ROLE = 'member'

export const roles = {
  [MEMBERSHIP_ROLE]: ac.newRole({ invitation: ['create', 'cancel'] }),
}
