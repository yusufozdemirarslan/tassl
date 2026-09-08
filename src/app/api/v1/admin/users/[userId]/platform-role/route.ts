// PUT /api/v1/admin/users/{userId}/platform-role (07 §9, SYS-006): the seat, the revocation of
// that person's sessions, and the `role.set` audit row, in one transaction.
export { adminSetPlatformRole as PUT } from '@/server/modules/admin/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
