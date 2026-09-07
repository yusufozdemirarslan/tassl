// Public interface of the `debrief` module (docs/tech/10-backend-spec-modules.md §13).
// Other modules, Server Components, and job handlers import from here; never from ./service,
// ./assembly, ./repository, or ./errors.
//
// Two functions, and both name their actor first. `getDebrief` is the one document the run's own
// student and the reviewers of their section both read (FR-154); `answerDebrief` is the student's
// alone, and is what closes the run (FR-152).
//
// `DEBRIEF_SECTION_ORDER` is exported because the order is a product rule rather than a layout
// (FR-151): the debrief walks the run in the order the run happened, and the screen that draws it
// reads the order from here rather than restating it.
export { answerDebrief, getDebrief, DEBRIEF_SECTION_ORDER } from './service'

export type {
  DebriefAnswers,
  DebriefBand,
  DebriefPoints,
  DebriefQuestions,
  DebriefSection,
  DebriefView,
} from './service'

export {
  DebriefAnswersSchema,
  DebriefSectionKeySchema,
  DebriefViewSchema,
  RunIdParamsSchema,
} from './schema'

export type { DebriefLabels, DebriefSectionKey } from './schema'
