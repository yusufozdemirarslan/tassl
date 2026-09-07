// Public interface of the `records` module (docs/tech/10-backend-spec-modules.md §14).
// Other modules, Server Components, and job handlers import from here; never from ./service,
// ./repository, or ./errors.
//
// `writeCourseExport` is the seam the `review` module's confirmation reaches this one through — it
// takes the transaction and the run row rather than an actor, the same shape `trace.append` has and
// for the same reason: the file and the band decision it records must commit together (D-087). Every
// other export below takes an actor and names its guard.
//
// `getRecord` is the Judgment Record itself (FR-170): the four graphs, the confirmed bands with
// their notes, the mode and variant, and the record-form trace — never the weight, the mapping or
// the points, at any depth (FR-172, D-421, D-439). `sample` is D-035's illustrative fixtures, behind
// `FEATURE_SAMPLE_DATA` and carrying their own label (FR-254).
export {
  exportRecord,
  getCourseExport,
  getRecord,
  listCourseExports,
  listRunExports,
  sample,
  writeCourseExport,
} from './service'

export type {
  ExportableRun,
  ExportReason,
  ExportSummary,
  RecordBand,
  RecordView,
  SampleQueue,
  SampleTrajectory,
} from './service'

export {
  ExportSummarySchema,
  RecordBandSchema,
  RecordViewSchema,
  SAMPLE_LABEL,
  SampleQueueSchema,
  SampleTrajectorySchema,
} from './schema'
