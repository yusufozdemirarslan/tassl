// GET /api/v1/package-versions/{versionId}/export (SYS-026): the package as a downloaded JSON file.
export { exportPackageVersionRoute as GET } from '@/server/modules/scenarios/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
