// Wire contract of the `reliance` module (docs/tech/10-backend-spec-modules.md §8; 07-api-spec.md
// §7, §10). One Zod schema per view; instants leave as ISO strings, as everywhere else.
//
// Step 6.4 lands the read-only half: a claim can be *surfaced* — by opening the document it is
// sourced from (FR-031) — and read back. Stances, interrogation actions and escalations arrive with
// Phase 8, and their fields join `ClaimView` there rather than sitting here as constants that are
// always empty.
//
// **Two fields of 07 §10's `ClaimView` are deliberately absent, and one of them is a security
// rule.** `escalatable` is on the list 12 §8.1 keeps out of every student view in every state
// (FR-093): a flag that says which claims are worth escalating is the product telling a student
// where to look, and `student-view.ts` forbids the key by name, so a payload carrying it fails
// `tests/integration/security/student-view-invariants.test.ts`. What a student may be told is
// whether *they* can escalate right now — a fact about their run's remaining escalations, not about
// the claim — and Phase 8 answers that as `canEscalate` alongside the escalation itself (D-244).
// `availableActions` is the second: it is derived from the claim's authored verification paths, and
// the actions that read them land with Phase 8 too.
import { z } from 'zod'

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
 * One surfaced claim as its own student reads it (07 §7 `GET /runs/{runId}/claims`).
 *
 * `id` is the scenario claim's id, which is what every claim endpoint addresses, and `text` is the
 * claim verbatim — the same words the assistant said or the document carries (PRD §7.5). Nothing
 * authored *about* the claim travels: no evidence status, no failure family, no warranted stance,
 * no rationale, no trigger phrases, no carried values (12 §8.1, §8.2). The claim is the thing the
 * student takes a position on; what it deserved is the debrief's to say, after scoring.
 */
export const ClaimViewSchema = z.object({
  id: z.uuid(),
  key: z.string().min(1),
  text: z.string().min(1),
  surfacedBy: SurfacedBySchema,
  surfacedAt: z.iso.datetime(),
  inTurnWindow: z.boolean(),
  /** Null until the student takes one (FR-080); the control arrives in Phase 8. */
  stance: StanceSchema.nullable(),
  previousStance: StanceSchema.nullable(),
  stanceSetAt: z.iso.datetime().nullable(),
  /** The student marked the claim used in the Delegation Log (FR-060). */
  usedMarked: z.boolean(),
  /** Whether the run has recorded reliance on it by any route (FR-084, FR-101). */
  reliedOn: z.boolean(),
})
export type ClaimView = z.infer<typeof ClaimViewSchema>

export const RunIdParamsSchema = z.object({ runId: z.uuid() })
