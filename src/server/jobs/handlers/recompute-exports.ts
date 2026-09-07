// recompute_exports handler: docs/tech/10-backend-spec.md §7 (`courses.recomputeExports`, singleton
// key `recompute:<courseId>`) and FR-206, D-095. An instructor changed what a band is worth, so
// every confirmed run in the course is repriced under the new mapping and re-exported with the
// reason `mapping_change`.
//
// The handler is four lines because the work is the service's (10 §3). What it owns is the one
// decision a queue makes: what a throw means. A throw is the retry signal — three attempts, 30 s
// backoff, then the `recompute_exports_dead` queue — and the service throws only when the course
// cannot be read at all. The payload carries the institution beside the course because a job has no
// session to resolve a tenant from, and every read the service makes is `tenantId`-first (D-006,
// D-447). A retry is safe by construction: repricing a run under the same mapping writes the same
// five numbers, and the export it files is a new version of an append-only ledger, so the run a
// second attempt reaches is priced once and filed twice rather than left half-corrected.
import { registerHandler, type JobHandler } from '@/server/jobs/handlers'
// The registry (10 §7) names `courses.recomputeExports` as this queue's handler; the boundaries
// policy lets a job handler reach a module through its public index.ts (D-173).
import { recomputeExports } from '@/server/modules/courses'

export const recomputeExportsHandler: JobHandler<'recompute_exports'> = async (payload, ctx) => {
  const result = await recomputeExports(payload)
  ctx.logger.info(
    {
      event: 'recompute_exports',
      courseId: result.courseId,
      repriced: result.repriced,
      exported: result.exported,
    },
    'mapping change recomputed',
  )
}

registerHandler('recompute_exports', recomputeExportsHandler)
