// GET /api/v1/runs/{runId}/defense (07-api-spec.md §7, FR-120, FR-126): the typed defense.
//
// It is the read that *opens*: the first call draws six to nine questions from the student's own run
// record and writes them to the trace, and every call after that returns the same interview with the
// answers already given marked, so a dropped connection resumes where it stopped (FR-126).
//
// There is no assistant and no Evidence Room behind it, and the trace, the Delegation Log and the
// claim table are all sealed in this state by one rule in the `trace` module (D-279).
export { getDefenseRoute as GET } from '@/server/modules/defense/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
