// GET, PATCH, DELETE /api/v1/me (docs/tech/07-api-spec.md §3). The handlers live in the identity
// module's router; this file is the App Router entry point for them.
export {
  deleteMe as DELETE,
  getMe as GET,
  updateMe as PATCH,
} from '@/server/modules/identity/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
