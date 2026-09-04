// POST /api/v1/package-versions/{versionId}/regenerate (07 §6, FR-195): the next draft version.
export { regeneratePackageVersionRoute as POST } from '@/server/modules/scenarios/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
