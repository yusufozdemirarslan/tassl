// Session lookup used by defineRoute and defineAction.
// Until Phase 3 wires Better Auth there is no session store, so every request is anonymous and
// `auth: 'session'` routes answer 401 UNAUTHENTICATED (phase-00 step 0.5). Phase 3 replaces the
// body of getSession() with Better Auth's `auth.api.getSession({ headers })` and adds
// `import 'server-only'` (it will use next/headers).
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'

export async function getSession(headers: Headers): Promise<SessionUser | null> {
  void headers
  return null
}

export async function requireSession(headers: Headers): Promise<SessionUser> {
  const session = await getSession(headers)
  if (!session) throw new AppError('UNAUTHENTICATED')
  return session
}
