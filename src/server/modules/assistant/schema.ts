// Wire contract of the `assistant` module (docs/tech/10-backend-spec-modules.md §7; 07-api-spec.md
// §7, §10). One Zod schema per input, shared by the route, the Server Action and the form that
// submits it; one schema per view, which the route validates against before serializing.
//
// Like every module schema this file carries no server import, so a Server Component may read its
// types (04 §2). That is also why the Delegation Log's claim rows are declared here rather than
// borrowed from `reliance/schema.ts`: a module schema may reach `src/lib` and nothing else, and the
// log's row is a smaller thing than a claim card anyway — FR-060 asks the log for "which claims
// resulted, which the student marked as used, and the stance each carried", which is exactly the
// five fields of `DelegationClaimSchema` and none of the surfacing detail a `ClaimView` carries.
//
// **Two fields of 07 §10's `DelegationView` are optional here, and the reason is a security rule.**
// `flags` and `unverifiedNumbers` are present for a reviewer and absent for the student whose run
// it is. The trace's owner view already draws that line for the same two fields of the `delegation`
// event (`trace/owner-view.ts`): reviewer flags are an instructor's observation about the run
// (FR-055, 12 §8.1), and the reviewer's *list* of unverified numbers is what D-068 hands the faculty
// seat so a consequential claim that slipped through can be neutralized — an audit of the guard's
// own work, alongside the flags that say the reply was rebuilt or redacted, and nothing a student's
// screen has a use for. `student-view.ts` forbids the key `flags` by name in every state, so a
// student payload carrying it fails `tests/integration/security/student-view-invariants.test.ts`.
// 07 §10 lists both as required and is corrected with D-269.
//
// **The student is not left with nothing, and never was meant to be** (D-068, D-281). The other half
// of D-068 — the figure "rendered with a subtle marker" — travels inside `responseText`, where the
// guard wrote it, so this view carries it for the owner and the reviewer alike without a field for
// either of them to gate. Marking a figure is provenance, not defect status: the figures a claim
// carries are in the claim's own text, which no guard reads, so a marked number distinguishes no
// claim from any other (FR-056) and makes the assistant's own assumption the student's to defend
// (FR-025).
import { z } from 'zod'
import { stripMarkup } from '@/lib/words'

// ---------------------------------------------------------------------------------------------
// Path parameters
// ---------------------------------------------------------------------------------------------

export const RunIdParamsSchema = z.object({ runId: z.uuid() })
export const DelegationParamsSchema = z.object({ runId: z.uuid(), delegationId: z.uuid() })

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

/** 11 §3: the assistant refuses a request longer than this with `ASSISTANT_REQUEST_TOO_LONG`. */
export const DELEGATION_REQUEST_MAX_CHARS = 2000
/** 10 §7: the optional one-line "why" on a Delegation Log entry (FR-060). */
export const DELEGATION_WHY_MAX_CHARS = 200
/** 07 §7: the purpose on an outside-tool declaration (FR-061). */
export const OUTSIDE_TOOL_PURPOSE_MAX_CHARS = 500

/**
 * What a delegation carries on the wire: the student's request, and nothing else.
 *
 * Shape only, deliberately: the length rule lives in the service, so a request over the limit is
 * answered `ASSISTANT_REQUEST_TOO_LONG` (10 §7) rather than the generic `VALIDATION_ERROR` a
 * `.max()` here would produce — the same split `LockFrameInputSchema` and `LockFrameSchema` make
 * for `FRAME_INVALID`. Markup is stripped before the length is measured, so a paste is measured as
 * the model will read it (10 §5).
 */
export const DelegateInputSchema = z.strictObject({ request: z.string() })
export type DelegateInput = z.infer<typeof DelegateInputSchema>

/** The service's rule over the same field: stripped, non-empty, at most 2,000 characters. */
export const DelegationRequestSchema = z
  .string()
  .overwrite(stripMarkup)
  .pipe(z.string().min(1).max(DELEGATION_REQUEST_MAX_CHARS))

/**
 * `PATCH /runs/{runId}/delegations/{delegationId}` (07 §7, FR-060): the why line, the used marks,
 * or both. Both optional, and an empty body is a no-op rather than a refusal — the log's controls
 * are independent, and a screen that sends only the field the student touched should not have to
 * send the other one back.
 *
 * `why` is the student's own sentence and is stored as they wrote it, markup aside. It is not word
 * limited: FR-060 calls it "an optional one-line 'why'", and 10 §7 bounds it in characters.
 */
export const UpdateDelegationSchema = z.strictObject({
  why: z.string().overwrite(stripMarkup).pipe(z.string().max(DELEGATION_WHY_MAX_CHARS)).nullish(),
  usedClaimIds: z.array(z.uuid()).optional(),
})
export type UpdateDelegationInput = z.infer<typeof UpdateDelegationSchema>

/**
 * `POST /runs/{runId}/outside-tool-declaration` (07 §7, FR-061).
 *
 * The one thing worth saying about this schema is what is not in it. There is no field for whether
 * the tool was allowed, no enumeration of tools, and no acknowledgement to tick: FR-061 makes the
 * declaration a standing control that writes one event and has no other effect, and FR-062 forbids
 * detection, inference and enforcement anywhere in the product. A shape with a policy field in it
 * would be the beginning of one.
 */
export const DeclareOutsideToolSchema = z.strictObject({
  purpose: z
    .string()
    .overwrite(stripMarkup)
    .pipe(z.string().min(1).max(OUTSIDE_TOOL_PURPOSE_MAX_CHARS)),
})
export type DeclareOutsideToolInput = z.infer<typeof DeclareOutsideToolSchema>

/**
 * FR-055's mark, as a value rather than only as a member of the enum below.
 *
 * `run_delegations.flags` is shared with the guards and the probe (`rebuilt`, `filtered`,
 * `no_commentary`, `probe`, `discarded_late`), so every reader that asks "did a reviewer mark this
 * exchange?" has to name this one string — `scoring/repository.ts` does, to build the exclusion
 * FR-055 asks for (D-481). It is here rather than in `service.ts` because 04 §2 lets another
 * module's repository import a module *schema* and nothing else of it.
 */
export const DELEGATION_OUT_OF_SCENARIO_FLAG = 'out_of_scenario' as const

/** FR-055: the one flag a reviewer may add to a delegation from the replay (Phase 11's screen). */
export const DelegationFlagSchema = z.enum([DELEGATION_OUT_OF_SCENARIO_FLAG])
export type DelegationFlagValue = z.infer<typeof DelegationFlagSchema>

export const FlagDelegationSchema = z.strictObject({ flag: DelegationFlagSchema })
export type FlagDelegationInput = z.infer<typeof FlagDelegationSchema>

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

/** `stance` (06 §3.3), restated rather than imported from the database or another module (04 §2). */
export const StanceSchema = z.enum(['accept', 'verify', 'challenge', 'reject', 'escalate'])
export type StanceValue = z.infer<typeof StanceSchema>

/**
 * One claim as the Delegation Log lists it (FR-060): the claim, the stance it carries now, and
 * whether the student marked it used.
 *
 * Nothing authored *about* the claim travels — no evidence status, no failure family, no warranted
 * stance, no trigger phrases, no rationale (12 §8). This is the same discipline `ClaimView` keeps
 * one module along, and the log is a narrower view than that one rather than a copy of it.
 */
export const DelegationClaimSchema = z.object({
  id: z.uuid(),
  key: z.string().min(1),
  text: z.string().min(1),
  stance: StanceSchema.nullable(),
  usedMarked: z.boolean(),
})
export type DelegationClaim = z.infer<typeof DelegationClaimSchema>

/** One number the assistant asserted that no claim, document or request put in front of it (D-068). */
export const UnverifiedNumberSchema = z.object({ value: z.string(), context: z.string() })
export type UnverifiedNumber = z.infer<typeof UnverifiedNumberSchema>

/**
 * One entry of the Delegation Log (07 §7 `GET /runs/{runId}/delegations`, FR-060).
 *
 * `responseText` is the reply as it was stored — after the numeric guard and the defect-word filter
 * ran over the assistant's own prose (11 §3), never the raw model output — and it carries both of
 * the reply's markers: `[[claim:<id>]]`, which is what lets the log render the same claim cards the
 * panel did, and `[[figure:…]]` round a figure no claim, document or request sourced (D-281), which
 * is what lets it render the same marks. A reply is stored once and read by the student, the log and
 * the replay, so all three read the same sentences.
 *
 * `failed` is a delegation whose provider never answered (FR-001). Its `responseText` is empty and
 * its row exists because it was written before the stream started: a run that paused mid-answer
 * says what it was doing rather than showing a gap.
 */
export const DelegationViewSchema = z.object({
  id: z.uuid(),
  /** The delegation's own ordinal in this run's log, from 1; not a trace sequence number. */
  seq: z.int().positive(),
  requestText: z.string(),
  responseText: z.string(),
  claims: z.array(DelegationClaimSchema),
  why: z.string().nullable(),
  inTurnWindow: z.boolean(),
  failed: z.boolean(),
  createdAt: z.iso.datetime(),
  /** Reviewer only (12 §8.1): the guard flags and a reviewer's own `out_of_scenario`. */
  flags: z.array(z.string()).optional(),
  /**
   * Reviewer only (12 §8.2): D-068's list, so the faculty seat can neutralize a consequential claim
   * that slipped through. The student sees the same figures marked in `responseText`, not listed.
   */
  unverifiedNumbers: z.array(UnverifiedNumberSchema).optional(),
})
export type DelegationView = z.infer<typeof DelegationViewSchema>

export const DelegationListSchema = z.array(DelegationViewSchema)
