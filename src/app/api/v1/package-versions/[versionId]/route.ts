// GET /api/v1/package-versions/{versionId} (docs/tech/07-api-spec.md §6, FR-180, FR-195, FR-198).
export { getPackageVersionRoute as GET } from '@/server/modules/scenarios/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
