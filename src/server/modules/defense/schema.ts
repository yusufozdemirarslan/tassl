// Validation schemas and view shapes of the `defense` module (docs/tech/10-backend-spec-modules.md
// §9, §17; 07-api-spec.md §7; FR-120 to FR-126).
//
// One rule governs every shape here, and it is the product invariant rather than a preference:
// **each is a list of the fields a student may see, and nothing is ever built by removing a field
// from something wider** (12 §8, D-117). The bank behind a question carries the authored follow-up
// prompt, the expected-answer notes the faculty seat reads against, the selecting condition and the
// bank key — every one of them forbidden in a student payload (`student-view.ts`) — so
// `DefenseQuestionSchema` names its six fields and a seventh cannot appear because somebody added a
// column. The `question_id` behind a rendered question is absent for the same reason the trace
// classifies it `reviewer_only` (12 §8.1): it is the bank row, and the bank is the instrument.
//
// The four artifact shapes below are **restated**, not imported. A module `schema.ts` may reach
// `src/lib` and nothing else (04 §2), so this file cannot name `runs/schema.ts`'s `FrameSchema` or
// `BriefViewSchema` — the same constraint D-336 met one module along. The service builds them from
// `runs.getDecision`, which is the one read of the frozen record (D-341), so the values are the
// runs module's; only the wire shape is written twice.
import { z } from 'zod'

/** `run_defense_questions` addresses one question of one run (07 §7). */
export const RunIdParamsSchema = z.object({ runId: z.uuid() })
export type RunIdParams = z.infer<typeof RunIdParamsSchema>

export const QuestionParamsSchema = z.object({ runId: z.uuid(), runQuestionId: z.uuid() })
export type QuestionParams = z.infer<typeof QuestionParamsSchema>

/** `defense_questions.kind` (DATA-024): the seven run-record conditions, plus the fill (FR-121). */
export const QuestionKindSchema = z.enum([
  'provenance',
  'figure_provenance',
  'verification',
  'assumption',
  'confidence',
  'frame_vs_response',
  'counterfactual',
  'default',
])
export type QuestionKindValue = z.infer<typeof QuestionKindSchema>

/** 10 §9: an answer is at most 5,000 characters. */
export const ANSWER_MAX_CHARS = 5_000

/**
 * One answer as it arrives on the wire (07 §7's `DefenseAnswer`).
 *
 * Shape only. The 5,000-character rule is applied in the service, so it holds for a Server Action, a
 * job, or any caller that did not come through the route (D-287) — and so the refusal is the one
 * `details { field, reason }` shape the frame and the brief already answer with.
 *
 * `durationMs` is the time from the question receiving focus to the press of submit (UI-026), which
 * is the client's measurement to make: the server sees one request and cannot tell thinking from a
 * closed laptop. It is recorded, never scored on its own.
 */
export const DefenseAnswerInputSchema = z.strictObject({
  text: z.string(),
  durationMs: z.number(),
})
export type DefenseAnswerInput = z.infer<typeof DefenseAnswerInputSchema>

/** The rule the service applies to an answer: markup stripped, at most 5,000 characters. */
export const DefenseAnswerSchema = z.strictObject({
  text: z.string().max(ANSWER_MAX_CHARS),
  durationMs: z.int().min(0),
})
export type DefenseAnswer = z.infer<typeof DefenseAnswerSchema>

/** The answer a student already gave, read back when they resume (FR-126). */
export const DefenseAnswerViewSchema = z.object({
  /** Empty is a real answer and is itself evidence (FR-124), so this is not `.min(1)`. */
  text: z.string(),
  answeredAt: z.iso.datetime(),
})
export type DefenseAnswerView = z.infer<typeof DefenseAnswerViewSchema>

/**
 * One question as the student meets it (07 §7's `DefenseQuestion`).
 *
 * `text` is the rendered sentence — the author's template with the student's own claim, figure,
 * stance or assumption filled in (FR-122) — and it is stored, not re-rendered on each read: the
 * question the trace records is the question that was asked.
 *
 * `followUpOf` is the run question this one follows up (FR-123), so UI-026 can draw it beneath its
 * parent rather than as the next item in the interview.
 */
export const DefenseQuestionSchema = z.object({
  runQuestionId: z.uuid(),
  seq: z.int().min(1),
  kind: QuestionKindSchema,
  text: z.string().min(1),
  answered: z.boolean(),
  followUpOf: z.uuid().nullable(),
  answer: DefenseAnswerViewSchema.nullable(),
})
export type DefenseQuestion = z.infer<typeof DefenseQuestionSchema>

// ---------------------------------------------------------------------------------------------
// The artifacts (UI-026): the frame, the filed brief, the addendum and the Turn response
//
// Restated from `runs/schema.ts` for the boundary reason in this file's header. They carry no field
// that shape does not: `speedOutlier` and `autoLocked` are instructor observations (FR-106) and are
// absent there too.
// ---------------------------------------------------------------------------------------------

/** The frame locked before the assistant was in the room (FR-041). */
export const DefenseFrameSchema = z.object({
  decision: z.string(),
  assumptions: z.array(z.string()).length(3),
  position: z.string(),
  confidence: z.int().min(0).max(100),
  lockedAt: z.iso.datetime(),
})
export type DefenseFrame = z.infer<typeof DefenseFrameSchema>

/** The brief as filed (FR-100). `briefRationale` is the student's own 250 words (D-329). */
export const DefenseBriefSchema = z.object({
  recommendation: z.string(),
  briefRationale: z.string(),
  assumptions: z.array(z.string()).length(3),
  changeMyMind: z.string(),
  confidence: z.int().min(0).max(100).nullable(),
  namedValues: z.record(z.string(), z.number()),
  updatedAt: z.iso.datetime(),
  lockedAt: z.iso.datetime().nullable(),
})
export type DefenseBrief = z.infer<typeof DefenseBriefSchema>

/** The one post-lock addendum, rendered apart from the brief it is never part of (FR-107). */
export const DefenseAddendumSchema = z.object({
  text: z.string().min(1),
  createdAt: z.iso.datetime(),
})
export type DefenseAddendum = z.infer<typeof DefenseAddendumSchema>

/** Hold, revise or reverse, or the implicit hold the window recorded (FR-112, FR-113, D-335). */
export const DefenseTurnResponseSchema = z.object({
  response: z.enum(['hold', 'revise', 'reverse']),
  justification: z.string().nullable(),
  confidence: z.int().min(0).max(100).nullable(),
  implicit: z.boolean(),
  lockedAt: z.iso.datetime(),
})
export type DefenseTurnResponse = z.infer<typeof DefenseTurnResponseSchema>

/** The author's own label and unit for a named field, so the brief reads back in their words. */
export const DefenseNamedFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  unit: z.enum(['percent', 'ratio', 'months', 'usd', 'count', 'other']),
})
export type DefenseNamedField = z.infer<typeof DefenseNamedFieldSchema>

/**
 * `GET /runs/{runId}/defense` (07 §7, FR-120): the interview and the record it is about.
 *
 * **There is no assistant and no Evidence Room on it, and there is no route to either from here**
 * (FR-120). That is the whole design of this shape: the defense is what the student can say with
 * nothing in front of them but their own work, so what travels is their own work — the frame, the
 * brief, the addendum, the Turn response — and the questions. The trace, the Delegation Log and the
 * claim table are all sealed in this state by one rule in the module that owns them
 * (`trace.requireOwnerReadAccess`, D-279), so there is no second tab that hands the room back.
 *
 * `addendum` and `namedFields` are on it and are not in 07 §7's example (D-341): UI-026's artifacts
 * panel lists the addendum, and a brief read back as `premium_payback_months: 11` is a brief in the
 * database's words rather than the author's.
 */
export const DefenseViewSchema = z.object({
  questions: z.array(DefenseQuestionSchema),
  artifacts: z.object({
    frame: DefenseFrameSchema.nullable(),
    brief: DefenseBriefSchema.nullable(),
    addendum: DefenseAddendumSchema.nullable(),
    turnResponse: DefenseTurnResponseSchema.nullable(),
    namedFields: z.array(DefenseNamedFieldSchema),
  }),
})
export type DefenseView = z.infer<typeof DefenseViewSchema>

/**
 * What an answer answers (07 §7): the next question to put in front of the student, and the
 * follow-up this answer earned.
 *
 * They are two fields rather than one because they are two different things.
 * `followUpQuestion` is asked *about this answer* and UI-026 draws it beneath the question it
 * belongs to; `next` is where the interview goes on, the first question still without an answer, and
 * it is null when the follow-up is the only thing left.
 *
 * It is `followUpQuestion` and not 07 §7's `followUp` because `followUp` is the name
 * `student-view.ts` reserves for the bank's *authored prompt*, which no student payload may carry
 * under any meaning — the same collision D-329 resolved by renaming the brief's `rationale`, and
 * resolved the same way (D-343). What travels here is a question that was asked, which the student
 * is about to read.
 */
export const DefenseAnswerResultSchema = z.object({
  next: DefenseQuestionSchema.nullable(),
  followUpQuestion: DefenseQuestionSchema.nullable(),
})
export type DefenseAnswerResult = z.infer<typeof DefenseAnswerResultSchema>
