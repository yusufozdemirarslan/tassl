// Wire contract of the `reliance` module (docs/tech/10-backend-spec-modules.md §8; 07-api-spec.md
// §7, §10). One Zod schema per view; instants leave as ISO strings, as everywhere else.
//
// Step 6.4 landed the read-only half: a claim can be *surfaced* — by opening the document it is
// sourced from (FR-031) — and read back. Step 8.1 adds the three acts a student performs on a
// surfaced claim, and the fields those acts put on `ClaimView`: the stance (FR-080), the
// interrogation actions (FR-070 to FR-073) and the escalation (FR-090 to FR-092).
//
// **One field of 07 §10's `ClaimView` is deliberately absent, and it is a security rule.**
// `escalatable` is on the list 12 §8.1 keeps out of every student view in every state (FR-093): a
// flag that says which claims are worth escalating is the product telling a student where to look,
// and `student-view.ts` forbids the key by name, so a payload carrying it fails
// `tests/integration/security/student-view-invariants.test.ts`. What a student may be told is
// whether *they* can escalate right now — a fact about their run's two remaining escalations, not
// about the claim — and that is `canEscalate` beside `remainingEscalations` (D-244).
import { z } from 'zod'
import { stripMarkup } from '@/lib/words'

/** `run_claims.surfaced_by` (06 §3.4): how the claim came to be in front of the student. */
export const SurfacedBySchema = z.enum(['delegation', 'document', 'turn', 'student'])
export type SurfacedByValue = z.infer<typeof SurfacedBySchema>

/** `stance` (06 §3.3): the five stances FR-080 offers. */
export const StanceSchema = z.enum(['accept', 'verify', 'challenge', 'reject', 'escalate'])
export type StanceValue = z.infer<typeof StanceSchema>

/** How a claim came to count as relied on (06 §3.4 `relied_on_via`, FR-084, FR-101). */
export const ReliedOnViaSchema = z.enum(['log_mark', 'named_field', 'turn_window'])
export type ReliedOnViaValue = z.infer<typeof ReliedOnViaSchema>

/**
 * The three interrogation actions a run offers (FR-070, FR-071).
 *
 * `action_type` in the database carries a fourth member, `stakeholder_interview`, which no
 * verification path in the build's data model defines and no endpoint offers; the enum on the wire
 * is 07 §7's three, which are the ones `verification_paths` can answer.
 */
export const ActionTypeSchema = z.enum(['source_trace', 'replication_check', 'decomposition_check'])
export type ActionTypeValue = z.infer<typeof ActionTypeSchema>

/**
 * The order the actions are offered in, and the order `availableActions` lists them.
 *
 * A fixed order, not the order the author wrote the paths in: the claim card is polled while the
 * student works (D-274), and a menu that reshuffles under the cursor is a defect they would rightly
 * report. It is also the order of ascending cost, which is the order UI-023 shows them in.
 */
export const ACTION_TYPES: readonly ActionTypeValue[] = [
  'source_trace',
  'replication_check',
  'decomposition_check',
]

/**
 * What one interrogation action cost and produced (07 §10 `ActionResult`).
 *
 * `result` is the authored `verification_paths[type]` payload verbatim (FR-070, FR-071): the
 * document, passage, date and author a Source Trace leads to, the re-run a Replication Check
 * reports, the steps a Decomposition Check lists. Its keys are the author's — snake_case, as the
 * package stores them — because the value is carried, not rewritten. Nothing is added to it and
 * nothing is judged about it: FR-073 is that Tassl never says a claim is wrong.
 */
export const ActionResultSchema = z.object({
  actionId: z.uuid(),
  type: ActionTypeSchema,
  clockCostMs: z.number().int().nonnegative(),
  result: z.record(z.string(), z.unknown()),
  inTurnWindow: z.boolean(),
})
export type ActionResult = z.infer<typeof ActionResultSchema>

/** The escalations one run may spend on claims that carry an authored reply (FR-092). */
export const ESCALATION_LIMIT = 2

/**
 * What an escalation returned, in the student's form (07 §10, D-116).
 *
 * `responseId` and `countsAgainstLimit` are **not** here and are not coming. Whether a claim carries
 * an authored colleague reply is a fact about what the author thought worth arguing with, and a
 * student who could see which of their escalations counted could read defect placement off the
 * bookkeeping; `student-view.ts` forbids both keys before the run is scored, so a payload carrying
 * them fails the invariants suite. The replay and the debrief show them afterwards.
 */
export const EscalationResultSchema = z.object({
  responseText: z.string(),
  clockCostMs: z.number().int().nonnegative(),
  remainingEscalations: z.number().int().min(0).max(ESCALATION_LIMIT),
})
export type EscalationResult = z.infer<typeof EscalationResultSchema>

/**
 * One surfaced claim as its own student reads it (07 §7 `GET /runs/{runId}/claims`).
 *
 * `id` is the scenario claim's id, which is what every claim endpoint addresses, and `text` is the
 * claim verbatim — the same words the assistant said or the document carries (PRD §7.5). Nothing
 * authored *about* the claim travels: no evidence status, no failure family, no warranted stance,
 * no rationale, no trigger phrases, no carried values (12 §8.1, §8.2). The claim is the thing the
 * student takes a position on; what it deserved is the debrief's to say, after scoring.
 *
 * The three fields that carry a rule rather than a value:
 *
 *   * `availableActions` — the actions the claim's confirmed verification paths answer (FR-071).
 *     It is what the author authored, so the menu offers nothing that would come back empty.
 *   * `canEscalate` and `remainingEscalations` — facts about the *run*, repeated on every claim
 *     because the control is on the claim card. Neither varies from claim to claim, which is what
 *     keeps them from saying anything about this one (D-244).
 *   * `escalation` — the reply to an escalation the student actually raised, and null everywhere
 *     else. It is the only route by which an authored colleague reply reaches a student.
 */
export const ClaimViewSchema = z.object({
  id: z.uuid(),
  key: z.string().min(1),
  text: z.string().min(1),
  surfacedBy: SurfacedBySchema,
  surfacedAt: z.iso.datetime(),
  inTurnWindow: z.boolean(),
  /** Null until the student takes one (FR-080). */
  stance: StanceSchema.nullable(),
  previousStance: StanceSchema.nullable(),
  stanceSetAt: z.iso.datetime().nullable(),
  /** Every action run on this claim, oldest first, with the result it bought (FR-073). */
  actions: z.array(ActionResultSchema),
  /** The actions this claim offers, in cost order (FR-071). */
  availableActions: z.array(ActionTypeSchema),
  /** The reply to this student's escalation on this claim, or null (FR-090). */
  escalation: EscalationResultSchema.nullable(),
  /** Whether the run has an escalation left to spend (FR-092, D-244). */
  canEscalate: z.boolean(),
  remainingEscalations: z.number().int().min(0).max(ESCALATION_LIMIT),
  /** The student marked the claim used in the Delegation Log (FR-060). */
  usedMarked: z.boolean(),
  /** Whether the run has recorded reliance on it by any route (FR-084, FR-101). */
  reliedOn: z.boolean(),
})
export type ClaimView = z.infer<typeof ClaimViewSchema>

export const ClaimListSchema = z.array(ClaimViewSchema)

// ---------------------------------------------------------------------------------------------
// Inputs (10 §17): one schema per input, shared by the form, the action and the route
// ---------------------------------------------------------------------------------------------

export const RunIdParamsSchema = z.object({ runId: z.uuid() })
export const ClaimParamsSchema = z.object({ runId: z.uuid(), claimId: z.uuid() })

/** `PUT /runs/{runId}/claims/{claimId}/stance` (FR-080). */
export const SetStanceSchema = z.object({ stance: StanceSchema })
export type SetStanceInput = z.infer<typeof SetStanceSchema>

/** `POST /runs/{runId}/claims/{claimId}/actions` (FR-070). */
export const RunActionSchema = z.object({ type: ActionTypeSchema })
export type RunActionInput = z.infer<typeof RunActionSchema>

/** D-089: one sentence — at least three words, at most 280 characters, markup stripped first. */
export const ESCALATION_STATEMENT_MAX_CHARS = 280
export const ESCALATION_STATEMENT_MIN_WORDS = 3

/**
 * `POST /runs/{runId}/claims/{claimId}/escalation` (FR-090).
 *
 * The character bound is here because it is the wire contract 07 §7 publishes; the word bound is
 * not, because a `refine` on a string field answers `VALIDATION_ERROR` and D-089's rule deserves
 * its own code. Both are read again in the service, which is where the rule lives and where every
 * caller meets it as `ESCALATION_STATEMENT_INVALID` (10 §8).
 */
export const EscalateSchema = z.object({
  statement: z.string().overwrite(stripMarkup).min(1).max(ESCALATION_STATEMENT_MAX_CHARS),
})
export type EscalateInput = z.infer<typeof EscalateSchema>
