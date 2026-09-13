// PUT /api/v1/admin/users/{userId}/institution-role (07 §9, D-747): Student or Instructor in one
// institution, the person's section seats there with it, the revocation of their sessions, and the
// `role.set` audit row, in one transaction.
export { adminSetInstitutionRole as PUT } from '@/server/modules/admin/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
