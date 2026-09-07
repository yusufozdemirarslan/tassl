// Public interface of the `records` module (docs/tech/10-backend-spec-modules.md §14).
// Other modules, Server Components, and job handlers import from here; never from ./service,
// ./repository, or ./errors.
//
// Phase 10 exports the two export paths. `writeCourseExport` is the seam the `review` module's
// confirmation reaches this one through — it takes the transaction and the run row rather than an
// actor, the same shape `trace.append` has and for the same reason: the file and the band decision
// it records must commit together (D-087). The reads take an actor and name their guard.
//
// `getRecord` and `exportRecord`'s screen — the Judgment Record with its four graphs and confirmed
// bands — arrive in Phase 11 with the page that renders them.
export { exportRecord, getCourseExport, listCourseExports, writeCourseExport } from './service'

export type { ExportableRun, ExportReason, ExportSummary } from './service'

export { ExportSummarySchema } from './schema'
