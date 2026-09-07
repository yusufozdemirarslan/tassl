// POST/GET /api/v1/package-versions/{versionId}/generation (docs/tech/07-api-spec.md §6; AI-001,
// FR-191, UI-042).
export {
  getGenerationStatusRoute as GET,
  startGenerationRoute as POST,
} from '@/server/modules/authoring/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 07 §1 "Timeouts": 300 s for the generation start. The enqueue is instant, but
// JOBS_DRAIN_ON_ENQUEUE lets this invocation drain the queue it just wrote to (D-012), and the work
// on the other side of that queue is a model call per step.
export const maxDuration = 300
