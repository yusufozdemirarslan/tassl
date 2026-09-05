// POST /api/v1/package-versions/{versionId}/confirm (docs/tech/07-api-spec.md §6, FR-192).
export { confirmPackageVersionRoute as POST } from '@/server/modules/scenarios/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
