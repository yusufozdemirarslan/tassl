// PUT /api/v1/review/runs/{runId}/bands/{dimension} (07-api-spec.md §8, FR-181): confirm the draft,
// override it with a note, or set the dimension unassessed. The seventh decision confirms the run,
// computes its points and writes the first course export.
export { decideBandRoute as PUT } from '@/server/modules/review/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
