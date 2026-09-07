// GET /api/v1/runs/{runId}/record (07-api-spec.md §7, FR-170): the student's own Judgment Record —
// the four graphs, the confirmed bands with their notes, the mode and variant, and the run's trace
// in the record form. Never the weight, the mapping or the points, at any depth (FR-172, D-421).
export { getRecordRoute as GET } from '@/server/modules/records/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
