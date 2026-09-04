// Better Auth mount point (docs/tech/08-auth-authz.md §1). Every Better Auth endpoint — sign-up,
// sign-in, verification, password reset, Google callback, organization and invitation routes — is
// served from /api/auth/*. The library owns the request handling here: no defineRoute wrapper, no
// business logic. Its own origin check (`trustedOrigins`) and rate limiter run inside the handler.
import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/server/auth/auth'

// The handler opens database connections and hashes passwords: Node runtime only (05 §2).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const { GET, POST } = toNextJsHandler(auth)
