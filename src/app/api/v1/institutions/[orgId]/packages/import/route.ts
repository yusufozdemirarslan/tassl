// POST /api/v1/institutions/{orgId}/packages/import (docs/tech/07-api-spec.md §6, SYS-026).
export { importPackageRoute as POST } from '@/server/modules/scenarios/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
