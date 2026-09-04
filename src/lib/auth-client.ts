// Browser auth client (docs/tech/08-auth-authz.md §1). Components call `authClient.signIn.email`,
// `signUp.email`, `signOut`, `requestPasswordReset`, `resetPassword`, and the organization actions;
// every call goes to /api/auth on the same origin, so no baseURL is needed.
//
// The access-control statement and roles live in `@/lib/auth/access-control`, so the same
// definitions ship to the browser without `src/lib` importing `src/server` (04 §2, D-170).
import { organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { ac, roles } from '@/lib/auth/access-control'

export const authClient = createAuthClient({ plugins: [organizationClient({ ac, roles })] })

export const { signIn, signOut, signUp, useSession } = authClient
