// Minimal session actor shape used by the request context and wrappers.
// Phase 3 (Better Auth) widens this with roles and memberships; the fields below stay.
export type SessionUser = {
  id: string
  email: string
  name: string
  emailVerified: boolean
  activeOrganizationId: string | null
}
