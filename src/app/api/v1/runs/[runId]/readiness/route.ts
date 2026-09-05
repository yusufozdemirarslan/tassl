// GET /api/v1/runs/{runId}/readiness (07-api-spec.md §7, FR-010): the sixteen items and the instant
// the check closes, for the run's own student. The items carry the student's own answers so a check
// reopened after the browser closed resumes where it was left (FR-017); they never carry the key
// that is right (FR-012).
export { getReadinessRoute as GET } from '@/server/modules/runs/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
