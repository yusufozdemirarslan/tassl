// Browser auth client (docs/tech/08-auth-authz.md §1). Components call `authClient.signIn.email`,
// `signUp.email`, `signOut`, `requestPasswordReset`, `resetPassword`, `sendVerificationEmail`,
// `changePassword`, `listSessions` and the session revocations; every call goes to /api/auth on the
// same origin, so no baseURL is needed.
//
// No organization plugin: nothing in the browser calls `authClient.organization.*` — institutions,
// invitations and the active-institution switch are Server Actions in `@/server/modules/tenancy`,
// where the permission helpers run (D-183).
//
// The client is imported statically, not on demand: loading it lazily saved 11.6 KB of gzip per
// page and made the auth flows flaky in Firefox, where an import in flight while the page is
// navigating is aborted (D-188).
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient()
