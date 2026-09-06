// Public interface of the `defense` module (docs/tech/10-backend-spec-modules.md §9).
// Other modules, Server Components, and job handlers import from here; never from ./service,
// ./repository, ./selection, ./follow-up, or ./errors.
//
// Three functions, and all three name an actor first, like every other endpoint in the codebase:
// they are reached from a route or a Server Action and take the run's row lock themselves. There is
// no seam of the `trace.append` shape here, because nothing else in the product writes a defense.
//
// `selectQuestions` and `followUpReasonFor` are deliberately absent. Both are pure and both are
// tested directly by `tests/unit/defense/*`, which reaches the internal files as a unit test may;
// exporting them would publish the run-record conditions and the follow-up trigger as things another
// module could apply, and a second caller of either would be a second answer to "what is this
// student asked". Phase 10's scoring reads the questions and answers from the trace, like everything
// else it reads.
export { answerQuestion, completeDefense, openDefense } from './service'

export {
  ANSWER_MAX_CHARS,
  DefenseAnswerInputSchema,
  DefenseAnswerResultSchema,
  DefenseQuestionSchema,
  DefenseViewSchema,
  QuestionKindSchema,
} from './schema'

export type {
  DefenseAnswerInput,
  DefenseAnswerResult,
  DefenseAnswerView,
  DefenseQuestion,
  DefenseView,
  QuestionKindValue,
} from './schema'
