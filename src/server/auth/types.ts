// Session actor shape used by the request context, the route/action wrappers, and every permission
// helper (docs/tech/08-auth-authz.md §3, §5).
//
// `platformRole` is the one role an account holds (D-748): it is a single column on `user`, it is
// carried on the actor, and every helper decides from it. Institution and section memberships are
// tenancy and roster facts — which institution a person belongs to, which section roster they are
// on — and carry no role of their own.

/**
 * `user.platform_role` (08 §3, D-748), least to most: a Student takes the runs assigned to them; a
 * Scenario Editor also authors and publishes scenario packages; an Instructor runs courses,
 * assignments and review; a Platform Admin has full access.
 */
export type PlatformRole = 'student' | 'tassl_scenario_editor' | 'instructor' | 'admin'

export const PLATFORM_ROLES: readonly PlatformRole[] = [
  'student',
  'tassl_scenario_editor',
  'instructor',
  'admin',
]

/** What an account holds before an admin gives it anything else (the column default). */
export const DEFAULT_PLATFORM_ROLE: PlatformRole = 'student'

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
