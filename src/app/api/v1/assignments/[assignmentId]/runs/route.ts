// POST /api/v1/assignments/{assignmentId}/runs — start a run (07-api-spec.md §7, FR-231).
// GET  /api/v1/assignments/{assignmentId}/runs — the assignment's runs for its section's reviewers
// (07 §7, UI-032). The two verbs belong to different modules: starting a run is the runs module's,
// listing every student's runs on an assignment is the courses module's (10 §3).
export { listAssignmentRunsRoute as GET } from '@/server/modules/courses/router'
export { startRunRoute as POST } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
