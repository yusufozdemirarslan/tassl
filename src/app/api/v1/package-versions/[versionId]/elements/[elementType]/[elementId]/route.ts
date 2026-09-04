// PATCH /api/v1/package-versions/{versionId}/elements/{elementType}/{elementId} (07 §6, FR-192).
export { updateElementRoute as PATCH } from '@/server/modules/scenarios/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
