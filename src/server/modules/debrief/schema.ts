// Wire contract of the `debrief` module (docs/tech/10-backend-spec-modules.md §13, §17;
// 07-api-spec.md §7). One Zod schema per input, shared by the route, the Server Action and the form
// that submits it; one schema per view, which the route validates against before serializing.
//
// Like every module schema this file carries no server import, so a Server Component may read its
// types and a Client Component never imports it (D-186). The four graph payloads the sections carry
// are declared as plain JSON objects for the reason `review/schema.ts` states at its own head: each
// is built and validated by `scoring`, a module schema may reach nothing but `src/lib` (04 §2), and
// a second copy here would be a second thing to keep true.
//
// **Everything in this file is a student payload**, which is the difference from the replay. The
// debrief is the run's own student reading their own run after it has been scored, and a reviewer
// reading exactly the same document (FR-154). So the shapes below carry what 12 §8.2 releases at
// scoring — the warranted stance, the evidence status, the defect kind, the authored rationale — and
// none of what 12 §8.1 withholds in every state. In particular the band shape here is a projection
// and not `scoring`'s `BandView`: `quotes` and `evidenceEventSeqs` are reviewer-only in every state
// (`trace/owner-view.ts`), and `decidedBy` names a colleague of the instructor rather than anything
// about the run.
import { z } from 'zod'
import { wordLimit } from '@/lib/words'

/** Every run-addressed route of this module (07 §7's `/runs/{runId}/debrief…`). */
export const RunIdParamsSchema = z.object({ runId: z.uuid() })
export type RunIdParams = z.infer<typeof RunIdParamsSchema>

/** `run_bands.dimension` and `run_bands.decision` restated; a module schema imports only `src/lib`. */
export const DimensionSchema = z.enum([
  'framing',
  'delegation',
  'verification',
  'calibration',
  'decision_quality',
  'adaptation',
  'ownership',
])
export type DimensionValue = z.infer<typeof DimensionSchema>

export const BandSchema = z.enum(['novice', 'developing', 'proficient', 'professional'])
export type BandValue = z.infer<typeof BandSchema>

export const BandDecisionSchema = z.enum(['confirmed', 'overridden', 'unassessed'])

export const StanceSchema = z.enum(['accept', 'verify', 'challenge', 'reject', 'escalate'])
export type StanceValue = z.infer<typeof StanceSchema>

/**
 * The twelve sections, in the order FR-151 fixes and 10 §13 repeats.
 *
 * The order is declared here rather than in the component tree because it is a product rule and not
 * a layout: the debrief walks the run in the order the run happened, and a screen that reordered it
 * would be telling a different story from the trace. `DEBRIEF_SECTION_ORDER` below is what the
 * service assembles against and what `tests/unit/debrief/assembly.test.ts` asserts.
 */
export const DEBRIEF_SECTION_ORDER = [
  'frame_beside_decision',
  'stance_matrix',
  'missed_defects',
  'probe',
  'confidence_line',
  'turn_beside_frame',
  'clock_timeline',
  'counterfactual',
  'bands',
  'points',
  'done_well',
  'questions',
] as const
export const DebriefSectionKeySchema = z.enum(DEBRIEF_SECTION_ORDER)
export type DebriefSectionKey = z.infer<typeof DebriefSectionKeySchema>

/**
 * One section of the debrief.
 *
 * A section a run cannot support carries `available: false` **with a reason**, and is never omitted
 * (FR-155, FR-004): a page that quietly dropped the missed-defect section would read as a run with
 * nothing to say about its defects, which is a different sentence from "your decision rested on no
 * authored defect". `reason` is the sentence, already interpolated, because the reason names run
 * facts (which events are missing, which graph) that no screen holds.
 *
 * `data` is `null` for the four sections whose contents are top-level fields of the view — `bands`,
 * `points`, `done_well` and `questions`. They are top-level because 07 §7's `DebriefView` puts them
 * there, and they are in the section list as well because the order is the product rule: a screen
 * walks `sections` and reaches for the field the key names.
 */
export const DebriefSectionSchema = z.object({
  key: DebriefSectionKeySchema,
  available: z.boolean(),
  reason: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  data: z.unknown().nullable(),
})
export type DebriefSection = z.infer<typeof DebriefSectionSchema>

/**
 * One dimension as the student reads it (FR-151, FR-004, FR-182).
 *
 * `band` is the *effective* band — the instructor's decision where one was made, the draft where it
 * was not, with a correction as a floor that raises and never lowers (D-422) — so the seven values
 * here are the seven the points are computed from and the reader cannot be shown one number and
 * given another. `decision` is null while the bands are draft, which is what makes the two versions
 * of this page the same page (FR-150).
 *
 * There is no `quotes` and no `evidenceEventSeqs`. Both are reviewer-only in every state: a quote is
 * what a model read took out of the student's own free text to place a band, and a stored sequence
 * number carries the trace's real numbering past the renumbering that hides the probe (FR-053). What
 * FR-151 means by "with evidence" is the graphs the band was read from, which travel as `graphKeys`
 * beside the graphs themselves — the same reading `records.getRecord` takes (D-438).
 */
export const DebriefBandSchema = z.object({
  dimension: DimensionSchema,
  band: BandSchema.nullable(),
  status: z.enum(['drafted', 'unassessed']),
  /**
   * `run_bands.draft_reason`: the stored `UnassessedReason` when the dimension holds no band, and
   * empty when it holds one. It is the **identifier** — `no_evidence`, `graph_unavailable` — and
   * not FR-004's sentence, which this comment claimed and the card believed (D-515). The sentence
   * is `src/lib/band-prose.ts`'s, drawn by `BandCard` from this value; the wire carries the name so
   * a reader of the API gets something stable to switch on.
   */
  reason: z.string(),
  decision: BandDecisionSchema.nullable(),
  note: z.string().nullable(),
  /** The recorded reason the band sits where it does (`run_bands.rationale`). */
  rationale: z.string(),
  graphKeys: z.array(z.string()),
  /** True when a correction the instructor entered moved this dimension up (FR-005). */
  raisedByCorrection: z.boolean(),
})
export type DebriefBand = z.infer<typeof DebriefBandSchema>

/** `courses.mapping` restated: what each band is worth in this course's gradebook (FR-202). */
export const MappingSchema = z.object({
  novice: z.number(),
  developing: z.number(),
  proficient: z.number(),
  professional: z.number(),
})

/**
 * The course's arithmetic over this run's bands (FR-202, FR-203, D-091).
 *
 * Three numbers rather than one, each named for what it is, because a single "points" field would
 * have to be labelled by the reader and would be labelled wrongly on the day it mattered.
 * `draft` is what the pipeline computed from the draft bands and reaches no export; `confirmed`
 * exists only once every dimension carries a decision; `effective` is FR-005's floor after a
 * correction and is null when the run has had none.
 */
export const DebriefPointsSchema = z.object({
  mapping: MappingSchema,
  /** Percent of the course grade this run is worth: the assignment's, or the course default. */
  weight: z.number(),
  /** How many of the seven dimensions the arithmetic divides by (FR-202). */
  assessed: z.int().min(0),
  draft: z.number().nullable(),
  confirmed: z.number().nullable(),
  effective: z.number().nullable(),
})
export type DebriefPoints = z.infer<typeof DebriefPointsSchema>

/**
 * The two questions (FR-152).
 *
 * `canAnswer` is the reviewer's half of FR-154. The debrief is one document for both readers, and
 * the one thing that differs is that a reviewer has no form: the two questions are the student's
 * reflection on their own run, not a field a reviewer fills. The server answers the question rather
 * than the screen inferring it from a role.
 */
export const DebriefQuestionsSchema = z.object({
  answered: z.boolean(),
  canAnswer: z.boolean(),
  stanceToChange: z.string().nullable(),
  doDifferently: z.string().nullable(),
  answeredAt: z.iso.datetime().nullable(),
})
export type DebriefQuestions = z.infer<typeof DebriefQuestionsSchema>

/**
 * What the page must always say (FR-141, FR-150, FR-235).
 *
 * `version` is the one that carries a rule: `debrief_opened` is written once per version, and draft
 * and confirmed are two versions (10 §13). `uncalibrated` is always true in this build and is on the
 * wire anyway, because a screen that had to remember to say so would one day forget.
 */
export const DebriefLabelsSchema = z.object({
  version: z.enum(['draft', 'confirmed']),
  uncalibrated: z.boolean(),
  isWalkthrough: z.boolean(),
  viewer: z.enum(['owner', 'reviewer']),
  mode: z.enum(['guided', 'standard', 'open']),
  variant: z.enum(['defective', 'sound']),
})
export type DebriefLabels = z.infer<typeof DebriefLabelsSchema>

/** A document another module owns, carried through this one unchanged (see the file header). */
const foreignDocument = z.record(z.string(), z.unknown())

/** `GET /runs/{runId}/debrief` (07 §7, FR-150 to FR-155). */
export const DebriefViewSchema = z.object({
  run: foreignDocument,
  sections: z.array(DebriefSectionSchema),
  bands: z.array(DebriefBandSchema),
  points: DebriefPointsSchema,
  questions: DebriefQuestionsSchema,
  doneWell: z.string(),
  labels: DebriefLabelsSchema,
})

/**
 * `POST /runs/{runId}/debrief/answers` (07 §7, FR-152; 10 §17 `DebriefAnswersSchema`).
 *
 * Each is 100 words, applied to the stripped and trimmed text (D-200), and each has to say
 * something: a blank answer files a `debrief_answer` event that records nothing and moves the run to
 * Recorded on the strength of it.
 */
export const DebriefAnswersSchema = z.object({
  stanceToChange: wordLimit(100).min(1),
  doDifferently: wordLimit(100).min(1),
})
export type DebriefAnswers = z.infer<typeof DebriefAnswersSchema>
