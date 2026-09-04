// Session actor shape used by the request context, the route/action wrappers, and every permission
// helper (docs/tech/08-auth-authz.md §3, §5).
//
// `platformRole` is the only role carried on the actor: it is a single column on `user` and every
// helper needs it. Organization and section roles are per resource, so the helpers in
// ./permissions.ts read them for the id being checked rather than loading them onto every request.

/** `user.platform_role` (08 §3). `admin` satisfies every platform-role check. */
export type PlatformRole = 'none' | 'tassl_scenario_editor' | 'admin'

export const PLATFORM_ROLES: readonly PlatformRole[] = ['none', 'tassl_scenario_editor', 'admin']

export const isPlatformRole = (value: unknown): value is PlatformRole =>
  typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value)

export type SessionUser = {
  id: string
  email: string
  name: string
  emailVerified: boolean
  activeOrganizationId: string | null
  platformRole: PlatformRole
}
