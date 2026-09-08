// POST /api/v1/package-versions/{versionId}/elements/{elementType}/{elementId}/regenerate
// (docs/tech/07-api-spec.md §6; FR-194, UI-043).
export { regenerateElementRoute as POST } from '@/server/modules/authoring/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The same reason the generation start carries it (07 §1 "Timeouts"): the enqueue is instant and
// the drain this invocation may run is a model call.
export const maxDuration = 300
