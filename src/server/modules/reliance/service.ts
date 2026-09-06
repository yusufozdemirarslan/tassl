// Service of the `reliance` module (docs/tech/10-backend-spec-modules.md §8; 07-api-spec.md §7;
// 08-auth-authz.md §4). Step 6.4 lands the two halves a run needs before the assistant exists:
// **surfacing** a claim, and **reading back** the claims surfaced so far (FR-031, D-077).
//
// Surfacing is what puts a claim in front of a student. Three things do it in the finished product
// — a delegation whose request matched the claim's triggers (Phase 7), the Turn window (Phase 9),
// and, from this step, opening the document a claim is sourced from (FR-031: "a stakeholder claim
// read from a document requires a stance like any other"). A claim is surfaced once per run: the
// second delegation that mentions it references the row the first one wrote rather than making a
// second (10 §7).
//
// Step 8.1 adds what a student *does* with a surfaced claim: the five stances (FR-080), the three
// interrogation actions (FR-070 to FR-073), the escalation and its two-per-run limit (FR-090 to
// FR-092), the named-field route into reliance (FR-101), and the query the Decision Lock's gate
// asks (FR-084).
//
// One rule runs through all three mutations and is the one most easily got wrong: **the cost is
// charged before the result is returned.** FR-072 puts the deduction at the moment the action
// starts, and `trace.append` stamps `clock_remaining_ms` from the run row as the transaction has it
// (10 §10) — so the charge is written, and only then is the event appended and the result built. An
// action that starts with time left completes even when its cost outruns the clock, which is
// `chargeCost`'s cap rather than a branch here.
//
// Four imports need a word.
//
//   * `runs/clock.ts` — `in_turn_window` and every clock reading are facts about the run's clock
//     (D-042, D-132), and the module that owns the clock is `runs`. Importing that one pure file is
//     the same reading, and the same resolution, as the trace module's import of it (10 §10):
//     copying `isInTurnWindow` here would make one rule two.
//   * `runs/limits.ts` — the action costs and the escalation limit are pilot parameters, and that
//     file is the one place in the codebase any of them is written (10 §10).
//   * `runs` (public) — `lockRunForMutation` is the seam every in-run mutation starts at: it takes
//     the row lock and materializes the run's timers, so no module applies its rules to a stale
//     run. It closes an import cycle with the runs service, which calls this module when a document
//     is opened; D-286 records why that is safe and why there is no other way in.
//   * `trace` — every run mutation appends its event in the transaction that made it (CLAUDE.md).
//     The same module owns the other rule this file needs: what a run's own student may read of
//     their room in a given state, which the claim table asks rather than restates
//     (`requireOwnerReadAccess`, D-279).
import { countWords, stripMarkup } from '@/lib/words'
import { requireRunOwner } from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
import { lockRunForMutation } from '@/server/modules/runs'
import { chargeCost, isInTurnWindow, type ClockRun } from '@/server/modules/runs/clock'
import { ACTION_COSTS, ESCALATIONS_PER_RUN, ESCALATION_COST_MS } from '@/server/modules/runs/limits'
import { append, requireOwnerReadAccess, type TraceRun } from '@/server/modules/trace'
import {
  actionNotAvailable,
  claimNotSurfaced,
  escalationLimitReached,
  escalationStatementInvalid,
  relianceNotWritable,
  runNotFound,
  stanceInvalid,
  RELIANCE_STATES,
} from './errors'
import { namedValueMatchesClaim, type CarriedValue, type ValueUnitValue } from './matching'
import { bySurfacing } from './ordering'
import * as repo from './repository'
import {
  ACTION_TYPES,
  ESCALATION_STATEMENT_MAX_CHARS,
  ESCALATION_STATEMENT_MIN_WORDS,
  StanceSchema,
  type ActionResult,
  type ActionTypeValue,
  type ClaimView,
  type EscalateInput,
  type EscalationResult,
  type StanceValue,
  type SurfacedByValue,
} from './schema'

/**
 * The run columns surfacing reads: what the trace needs to append (the tenant, the run, the
 * allocator), the clock's, and the version whose claims are being surfaced. A Drizzle `Run` row
 * satisfies it, which is what the caller holds from `findRunForUpdate`.
 */
export type SurfacingRun = TraceRun & ClockRun & { packageVersionId: string; variantId: string }

/**
 * What a surfacing answers: each claim as the student reads it, and whether *this* call put it in
 * front of them.
 *
 * It is a `ClaimView` and not a summary of one because of what the caller does with it. A
 * delegation's reply carries a claim card per surfaced claim (07 §7's `segment` event), and the card
 * is a `ClaimView` — so building one here, from the row this transaction just wrote, is what keeps
 * the stream from having to re-read the claims it has just surfaced through a projection that would
 * answer the state *before* the surfacing in a concurrent read.
 *
 * `inserted` is the difference between "the student has just met this claim" and "the student has
 * met it before and it came up again" (10 §7).
 */
export type SurfacedClaim = ClaimView & { inserted: boolean }

/**
 * Everything a `ClaimView` needs that is not on the two claim rows: the run's acts and its budget.
 *
 * It is assembled once per read and shared by every card, because none of it varies claim by claim
 * in a way a per-card query would answer better — the actions and the escalations are two reads of
 * the run, the paths are one read of the variant, and the escalations left are one number about the
 * run (D-244).
 */
type ClaimViewContext = {
  /** `variant_claim_states.verification_paths` by claim id; the answer key is never loaded (12 §8). */
  paths: ReadonlyMap<string, repo.VerificationPaths>
  actions: readonly repo.RunAction[]
  /** Newest first, so the first match for a claim is the reply the student is looking at. */
  escalations: readonly repo.RunEscalation[]
  remainingEscalations: number
}

/** The actions a claim offers, in cost order (FR-070, FR-071): the paths the author confirmed. */
function availableActionsOf(paths: repo.VerificationPaths | undefined): ActionTypeValue[] {
  if (!paths) return []
  return ACTION_TYPES.filter((type) => paths[type] !== undefined)
}

/** One `run_actions` row as the student reads it: the cost it took and the result it bought. */
function toActionResult(row: repo.RunAction): ActionResult {
  return {
    actionId: row.id,
    type: row.type as ActionTypeValue,
    clockCostMs: row.clockCostMs,
    result: row.result,
    inTurnWindow: row.inTurnWindow,
  }
}

/**
 * One `run_escalations` row in the student's form (D-116).
 *
 * `responseId` and `countsAgainstLimit` are on the row and are not on the result. A student who
 * could see that an escalation was answered by *this claim's* authored reply rather than by the
 * version's general one would know the author wrote a reply for it, which is a fact about what the
 * author thought worth arguing with — the map the run is asking them to draw.
 */
function toEscalationResult(row: repo.RunEscalation, remaining: number): EscalationResult {
  return {
    // The student's own sentence, which is why it is picked here rather than withheld: D-116's two
    // fields (`responseId`, `countsAgainstLimit`) are the authored bookkeeping and neither is below.
    statement: row.statement,
    responseText: row.responseText,
    clockCostMs: row.clockCostMs,
    remainingEscalations: remaining,
  }
}

/**
 * One surfaced claim as its own student reads it, built by picking from two rows (12 §8).
 *
 * The single place a `ClaimView` is constructed. `scenario_claims` carries the trigger phrases, the
 * carried values, the escalation reply and the author's rationale, and `variant_claim_states` next
 * to it carries the warranted stance and the planted flag; none of it is in the shape below. Having
 * one constructor rather than one per read is what makes that a fact about the codebase rather than
 * a property each caller has to keep.
 */
function toClaimView(
  runClaim: repo.RunClaim,
  claim: repo.ScenarioClaim,
  context: ClaimViewContext,
): ClaimView {
  const escalation = context.escalations.find((row) => row.claimId === claim.id)
  return {
    id: claim.id,
    key: claim.key,
    text: claim.text,
    surfacedBy: runClaim.surfacedBy,
    surfacedAt: runClaim.surfacedAt.toISOString(),
    inTurnWindow: runClaim.inTurnWindow,
    stance: runClaim.stance,
    previousStance: runClaim.previousStance,
    stanceSetAt: runClaim.stanceSetAt?.toISOString() ?? null,
    actions: context.actions
      .filter((row) => row.claimId === claim.id)
      .map((row) => toActionResult(row)),
    availableActions: availableActionsOf(context.paths.get(claim.id)),
    escalation: escalation ? toEscalationResult(escalation, context.remainingEscalations) : null,
    // A fact about the run, repeated on every card because the control is on the card. It is never
    // the claim's authored `escalatable`, which is the flag 12 §8.1 keeps out of every student view
    // in every state (D-244).
    canEscalate: context.remainingEscalations > 0,
    remainingEscalations: context.remainingEscalations,
    usedMarked: runClaim.usedMarked,
    reliedOn: runClaim.reliedOn,
  }
}

/** The three reads and the one number every claim view is built from. */
async function claimViewContext(
  runId: string,
  variantId: string,
  dbx?: repo.DbOrTx,
): Promise<ClaimViewContext> {
  const [paths, actions, escalations] = await Promise.all([
    repo.listVerificationPaths(variantId, dbx),
    repo.listActions(runId, {}, dbx),
    repo.listEscalations(runId, dbx),
  ])
  // Every escalation the run has spent, not the subset `counts_against_limit` marks (D-328). The
  // filter that used to be here made the counter a function of which claims carry an authored
  // reply, and in a package that is the same set as the claims worth escalating.
  return {
    paths,
    actions,
    escalations,
    remainingEscalations: Math.max(0, ESCALATIONS_PER_RUN - escalations.length),
  }
}

// ---------------------------------------------------------------------------------------------
// Reliance (FR-084, FR-101, D-077)
// ---------------------------------------------------------------------------------------------

/**
 * Records that the run relied on a claim, and writes the `claim_used` event that says how (10 §8).
 *
 * The three routes are the three ways a student can lean on a claim without saying so in a stance:
 * marking it used in the Delegation Log (FR-060), naming its value in a brief field (FR-101), and
 * being handed it inside the Turn window (D-077). All three feed the same rule at the Decision
 * Lock — a claim relied on without a stance refuses the lock (FR-084) — which is why they are one
 * function rather than three, and why `relied_on_via` accumulates rather than being replaced.
 *
 * **Reliance is not taken back.** `usedMarked` follows the student's control, so unticking "used"
 * clears the mark; `relied_on_via` keeps `log_mark`, because the student told us they leaned on the
 * claim and the lock gate is what makes them take a position on it. A reversible route would be a
 * way to walk past the gate rather than through it (D-270).
 *
 * Idempotent: a second call for the same route writes no second event, so a log control pressed
 * twice records one act. The caller is told whether it was the first.
 */
export async function markClaimUsed(
  tx: repo.Tx,
  run: SurfacingRun,
  claimId: string,
  via: repo.ReliedOnVia,
  options: {
    delegationId?: string
    fieldKey?: string
    usedMarked?: boolean
    actorId?: string | null
    at?: Date
  } = {},
): Promise<{ recorded: boolean }> {
  const existing = await repo.findRunClaim(run.id, claimId, tx)
  if (!existing) return { recorded: false }

  const already = existing.reliedOnVia.includes(via)
  await repo.updateReliedOn(
    run.id,
    claimId,
    { via, ...(options.usedMarked === undefined ? {} : { usedMarked: options.usedMarked }) },
    tx,
  )
  if (already) return { recorded: false }

  await append(
    tx,
    run,
    'claim_used',
    {
      claim_id: claimId,
      via,
      ...(options.fieldKey === undefined ? {} : { field_key: options.fieldKey }),
      ...(options.delegationId === undefined ? {} : { delegation_id: options.delegationId }),
    },
    { actorId: options.actorId ?? null, occurredAt: options.at ?? new Date() },
  )
  return { recorded: true }
}

// ---------------------------------------------------------------------------------------------
// Surfacing (FR-031, D-077)
// ---------------------------------------------------------------------------------------------

/**
 * Puts claims in front of the student, once each (10 §8 `surfaceClaims`).
 *
 * `by` records what surfaced it — a delegation, a document, the Turn, the student — and `byId` the
 * thing itself, which is the delegation or document id. Both are the reviewer's context in the
 * replay and the input to the reading segment of the clock timeline.
 *
 * **Inside the Turn window, surfacing is also reliance** (D-077, FR-111). A claim the Turn puts in
 * front of a student in the twelve minutes they have to respond is one they have been made to
 * reckon with, so it counts as relied on by rule — `relied_on_via += turn_window` — and a
 * `claim_used { via: 'turn_window' }` event records that it did. Outside the window nothing is
 * implied: a claim the student read in a document is one they *saw*, and whether they leaned on it
 * is theirs to say with a stance.
 *
 * The ids are filtered through the run's own package version before anything is written, so a
 * claim from another version — or from another package entirely — cannot be surfaced onto this run
 * by a caller that got its matching wrong.
 */
export async function surfaceClaims(
  tx: repo.Tx,
  run: SurfacingRun,
  claimIds: readonly string[],
  by: SurfacedByValue,
  byId: string | null = null,
  at: Date = new Date(),
): Promise<SurfacedClaim[]> {
  const claims = await repo.listVersionClaims(run.packageVersionId, { ids: claimIds }, tx)
  if (claims.length === 0) return []

  // Built once, before the loop: a claim surfaced a second time may already carry actions and an
  // escalation, and the card the caller draws has to show them (FR-073).
  const context = await claimViewContext(run.id, run.variantId, tx)
  const inWindow = isInTurnWindow(run)
  const surfaced: SurfacedClaim[] = []

  // Sequential, not `Promise.all`: `append` allocates the next sequence from the row it is handed,
  // so several claims surfaced in one transaction take their numbers in the order they were
  // surfaced (NFR-005).
  for (const claim of claims) {
    const { runClaim, inserted } = await repo.upsertRunClaim(
      run.id,
      {
        claimId: claim.id,
        surfacedAt: at,
        surfacedBy: by,
        surfacedById: byId,
        inTurnWindow: inWindow,
      },
      tx,
    )
    if (inWindow) await markClaimUsed(tx, run, claim.id, 'turn_window', { at })

    // Re-read when the window marked it relied on, so the view the caller shows the student is the
    // row as this transaction leaves it rather than as `upsertRunClaim` found it.
    const current = inWindow
      ? ((await repo.findRunClaim(run.id, claim.id, tx)) ?? runClaim)
      : runClaim
    surfaced.push({ ...toClaimView(current, claim, context), inserted })
  }
  return surfaced
}

/**
 * Surfaces the claims a document carries (10 §8 `surfaceDocumentClaims`, FR-031).
 *
 * A claim whose `source_kind` is `document` is one the student can read for themselves, so opening
 * that document is what puts it in front of them — no delegation required, and no assistant. It is
 * called by `runs.openDocument` inside the transaction that writes the `document_open` event, so
 * the claim appears in the same instant the room records the read.
 *
 * Opening the same document twice surfaces nothing the second time: `upsertRunClaim` keeps the
 * first surfacing, which is the one that says when the student first met the claim.
 */
export async function surfaceDocumentClaims(
  tx: repo.Tx,
  run: SurfacingRun,
  documentId: string,
  at: Date = new Date(),
): Promise<SurfacedClaim[]> {
  const claims = await repo.listVersionClaims(
    run.packageVersionId,
    { sourceDocumentId: documentId },
    tx,
  )
  return surfaceClaims(
    tx,
    run,
    claims.map((claim) => claim.id),
    'document',
    documentId,
    at,
  )
}

// ---------------------------------------------------------------------------------------------
// The read (07 §7 `GET /runs/{runId}/claims`)
// ---------------------------------------------------------------------------------------------

/**
 * The claims this run has surfaced, oldest first, as their own student reads them (10 §8).
 *
 * Built by picking fields from two rows — the run's `run_claims` and the authored `scenario_claims`
 * — and never by handing back either. `scenario_claims` carries the trigger phrases, the carried
 * values, the escalation reply and the author's rationale, and `variant_claim_states` next to it
 * carries the warranted stance and whether the claim is the planted defect; none of it is in the
 * shape below, and none of it is loaded by this query (12 §8, D-117).
 *
 * **Which claims, and whether any at all, are two questions.** The second one is the run's state,
 * and it is not this module's to answer twice: the claim table with its stances is the room, the
 * defense is what a student can say without the room (UI-026, FR-120), and `trace.listEvents` and
 * `assistant.listDelegations` refuse there off one table in `trace/owner-view.ts` (D-233). This
 * read asks that same table through `requireOwnerReadAccess` rather than keeping a third list of
 * states that would drift from the other two in silence (D-279).
 *
 * The tier it answers is not used here: a `ClaimView` has no field that opens at `scored` — the
 * warranted stance and the evidence status are never in it, in any state, for anybody — so sealed
 * or not sealed is the whole of the question.
 */
export async function listRunClaims(actor: SessionUser, runId: string): Promise<ClaimView[]> {
  // The refusal this read makes first is not this module's either: a run the actor does not own
  // answers NOT_FOUND rather than FORBIDDEN, because 08 §4 gives a student no read of another
  // student's run at all — saying the id resolves is already more than they may know. There is no
  // `errors.ts` in this module yet for the same reason: 10 §8's six codes belong to the stances and
  // the interrogation actions, and each will land with the rule that raises it (Phase 8).
  const scope = await requireRunOwner(actor, runId)
  await requireOwnerReadAccess(scope.organizationId, runId)

  const run = await repo.findRunPackage(scope.organizationId, runId)
  if (!run) runNotFound()

  const [rows, context] = await Promise.all([
    repo.listRunClaims(runId),
    claimViewContext(runId, run.variantId),
  ])
  return rows.map(({ runClaim, claim }) => toClaimView(runClaim, claim, context))
}

// ---------------------------------------------------------------------------------------------
// The student's three acts on a surfaced claim (FR-070 to FR-073, FR-080, FR-085, FR-090 to FR-092)
//
// All three begin the same way and the order is the same every time, because each step is a rule
// that must hold before the next one is allowed to matter:
//
//   1. `requireRunOwner` — 08 §4 gives a student every in-run capability on their own run and none
//      on anyone else's, and a foreign run answers NOT_FOUND so an id cannot be probed.
//   2. `lockRunForMutation` — the row lock, with the run's timers already materialized, so a run
//      whose clock ran out while the student was typing meets its own auto-lock rather than this.
//   3. The state gate — `working` or `turn_open`, and nowhere else (10 §8).
//   4. The claim — surfaced on *this* run, or `CLAIM_NOT_SURFACED`.
//   5. The charge, where there is one, **before** the result (FR-072).
//   6. The row, then the event, in the transaction that made the change (CLAUDE.md).
// ---------------------------------------------------------------------------------------------

/** The locked, timer-materialized run row every mutation here works from. */
type LockedRun = Awaited<ReturnType<typeof lockRunForMutation>>

/**
 * Records a stance and the `stance_set` event that says what it replaced (FR-080, FR-081, FR-085).
 *
 * `action_ids` is every interrogation action run on this claim *before* the stance, which is what
 * makes "traced, then accepted" a different row from "accepted" in the debrief (FR-075) and what
 * the defense's verification question is selected from (10 §9). `previous_stance` is the stance
 * this one replaces, and both are kept: a student who traces a claim and then changes their mind
 * has done the thing the run is measuring, and the record has to show the change rather than only
 * where it landed.
 *
 * It is a helper rather than the whole of `setStance` because an escalation sets the stance too
 * (10 §8), and a stance set two ways would otherwise be two rules.
 */
async function applyStance(
  tx: repo.Tx,
  run: LockedRun,
  runClaim: repo.RunClaim,
  stance: StanceValue,
  at: Date,
  actorId: string,
): Promise<void> {
  const actions = await repo.listActions(run.id, { claimId: runClaim.claimId }, tx)
  await repo.setStance(run.id, runClaim.claimId, { stance, stanceSetAt: at }, tx)
  await append(
    tx,
    run,
    'stance_set',
    {
      claim_id: runClaim.claimId,
      stance,
      previous_stance: runClaim.stance,
      action_ids: actions.map((action) => action.id),
      in_turn_window: isInTurnWindow(run),
    },
    { actorId, occurredAt: at },
  )
}

/** One claim as the student now reads it, after a mutation has committed. */
async function readClaimView(tenantId: string, runId: string, claimId: string): Promise<ClaimView> {
  const run = await repo.findRunPackage(tenantId, runId)
  if (!run) runNotFound()
  const [row, context] = await Promise.all([
    repo.findRunClaimWithClaim(runId, claimId),
    claimViewContext(runId, run.variantId),
  ])
  if (!row) claimNotSurfaced()
  return toClaimView(row.runClaim, row.claim, context)
}

/**
 * `PUT /runs/{runId}/claims/{claimId}/stance` (07 §7, FR-080): the student's position on a claim.
 *
 * It charges nothing. Taking a position is the act the run is about, and the clock is spent on
 * *checking* — the interrogation actions and the escalation — not on deciding.
 *
 * **`escalate` is a stance like any other here.** Choosing it records that the student wants a
 * colleague's read; it does not fetch one, and it costs nothing. The reply is `escalate` below,
 * which is a separate act with a separate charge, so a student may take the stance without ever
 * spending the five minutes (10 §8).
 *
 * The stance is parsed again rather than trusted: the route and the action both validate the enum,
 * and this is the rule read where the rule lives, so a Server Component or a future caller that did
 * not come through either meets `STANCE_INVALID` instead of writing a value the column would reject.
 */
export async function setStance(
  actor: SessionUser,
  runId: string,
  claimId: string,
  stance: StanceValue,
): Promise<ClaimView> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const parsed = StanceSchema.safeParse(stance)
  if (!parsed.success) stanceInvalid()

  await repo.withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    if (!RELIANCE_STATES.includes(run.state)) relianceNotWritable(run.state)

    const runClaim = await repo.findRunClaim(runId, claimId, tx)
    if (!runClaim) claimNotSurfaced()

    await applyStance(tx, run, runClaim, parsed.data, new Date(), actor.id)
  })

  return readClaimView(tenantId, runId, claimId)
}

/**
 * The two columns a charge writes, picked out of the clock's patch.
 *
 * `chargeCost` answers the same `ClockPatch` shape `pause`, `resume` and `credit` answer, and only
 * two of its members can come from a charge. Naming them is what keeps this module from having a
 * second route to `paused_at` or `credited_ms`, which belong to the runs module's own rules.
 */
function clockCharge(patch: { chargedMs?: number; turnWindowEndsAt?: Date }): repo.ClockCharge {
  return {
    ...(patch.chargedMs === undefined ? {} : { chargedMs: patch.chargedMs }),
    ...(patch.turnWindowEndsAt === undefined ? {} : { turnWindowEndsAt: patch.turnWindowEndsAt }),
  }
}

/**
 * `POST /runs/{runId}/claims/{claimId}/actions` (07 §7, FR-070 to FR-073): an interrogation action.
 *
 * Three things happen in this order and the order is the specification.
 *
 *   * **The action must be one the claim offers.** `verification_paths` on the run's variant is the
 *     author's list, and an action with no authored result would have nothing to return (FR-071).
 *     Source Trace is on it for every sourced claim; the two checks only where the author wrote one
 *     (D-284).
 *   * **The cost is charged, and the charge is written, before the result is built** (FR-072). The
 *     clock the trace stamps on the `action` event is read from the run row by `trace.append`, so
 *     charging afterwards would record the time the student had before they spent it. `chargeCost`
 *     refuses a clock with nothing left — `CLOCK_EXPIRED` on the working clock,
 *     `TURN_WINDOW_EXPIRED` inside the Turn window (D-132) — and caps the cost at what was left, so
 *     a four-minute check begun with one minute on the clock costs one minute and completes. That
 *     cap is the whole of "an action once started completes"; there is no branch for it here.
 *   * **The result is the author's, verbatim** (FR-070). Nothing is added to it, nothing is
 *     computed from it, and nothing anywhere says whether the claim it describes is right (FR-073).
 */
export async function runAction(
  actor: SessionUser,
  runId: string,
  claimId: string,
  type: ActionTypeValue,
): Promise<ActionResult> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  return repo.withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    if (!RELIANCE_STATES.includes(run.state)) relianceNotWritable(run.state)

    const runClaim = await repo.findRunClaim(runId, claimId, tx)
    if (!runClaim) claimNotSurfaced()

    const paths = await repo.findVerificationPaths(run.variantId, claimId, tx)
    const authored = paths?.[type]
    if (!authored) actionNotAvailable(type)

    const startedAt = new Date()
    const inTurnWindow = isInTurnWindow(run)
    const charged = chargeCost(run, ACTION_COSTS[type], startedAt)
    await repo.applyClockCharge(tenantId, runId, clockCharge(charged.patch), tx)

    const result: Record<string, unknown> = { ...authored }
    const action = await repo.insertAction(
      runId,
      {
        claimId,
        type,
        clockCostMs: charged.appliedMs,
        result,
        startedAt,
        completedAt: new Date(),
        inTurnWindow,
        clockRemainingMs: Math.round(charged.remainingMsBefore - charged.appliedMs),
      },
      tx,
    )

    await append(
      tx,
      run,
      'action',
      {
        action_id: action.id,
        type,
        claim_id: claimId,
        clock_cost_ms: charged.appliedMs,
        result,
        in_turn_window: inTurnWindow,
      },
      { actorId: actor.id, occurredAt: startedAt },
    )

    return toActionResult(action)
  })
}

/**
 * D-089's rule, read where the rule lives: one sentence, three words to 280 characters.
 *
 * Markup is stripped first (10 §5), so the length and the word count are of the text that will be
 * stored and read back rather than of the paste it arrived in. Both bounds answer
 * `ESCALATION_STATEMENT_INVALID` with which half was broken, so a client without a form can say so.
 */
function escalationStatement(raw: string): string {
  const statement = stripMarkup(raw)
  if (statement.length > ESCALATION_STATEMENT_MAX_CHARS) escalationStatementInvalid('too_long')
  if (countWords(statement) < ESCALATION_STATEMENT_MIN_WORDS) {
    escalationStatementInvalid('too_short')
  }
  return statement
}

/**
 * `POST /runs/{runId}/claims/{claimId}/escalation` (07 §7, FR-090 to FR-092): the colleague's read.
 *
 * The student states in one sentence what they cannot evaluate and a colleague answers, verbatim,
 * for five minutes of the clock. Which reply they get is decided by the package and never told to
 * them:
 *
 *   * A claim the author wrote a reply for answers with that reply, `response_id = 'claim'`.
 *   * Every other claim answers with the version's general reply, `response_id = 'general'`.
 *
 * **Every escalation costs one of the run's two, whichever reply answered (D-328).** FR-090 to
 * FR-092 originally spent the budget only on the authored replies, and that generosity was an
 * oracle: an author writes a prepared reply for precisely the claim worth escalating — in the
 * fixture package C7 is the only claim with an authored reply and the only claim whose warranted
 * stance is `escalate` — so a counter that moved on some claims and not others announced which
 * ones they were, and so did a refusal that answered `ESCALATION_LIMIT_REACHED` on one claim and
 * succeeded on the next. CLAUDE.md's invariant ("students never see warranted stances … before
 * their run is scored") outranks the generosity, so the budget is one rule with no exceptions and
 * the third escalation is refused whatever it lands on.
 *
 * `counts_against_limit` is still written on the row and still travels on the trace: it records
 * which kind of reply was given, which is what the reviewer and the debrief read. It simply no
 * longer decides anything the student can observe.
 *
 * The student's result carries neither `response_id` nor `counts_against_limit` (D-116): a reply
 * that announced itself as "the authored one" would say the author thought this claim worth arguing
 * with, which is defect placement by another route. What they are told is the reply, their own
 * sentence back, what it cost, and how many escalations the run has left.
 *
 * The stance follows the act: an escalation on a claim the student has not already marked `escalate`
 * sets it, with its own `stance_set` event, because the stance matrix and the confidence line are
 * built from the trace and a stance no event records is a stance those graphs cannot see (D-285).
 */
export async function escalate(
  actor: SessionUser,
  runId: string,
  claimId: string,
  input: EscalateInput,
): Promise<EscalationResult> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  return repo.withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    if (!RELIANCE_STATES.includes(run.state)) relianceNotWritable(run.state)

    // The sentence is checked *after* the room's gate, not before it (D-331). Every other refusal
    // in this module sits behind `lockRunForMutation`, and a student whose run is locked or paused
    // being told their sentence is too short is being asked to rewrite a form that is closed.
    const statement = escalationStatement(input.statement)

    const row = await repo.findRunClaimWithClaim(runId, claimId, tx)
    if (!row) claimNotSurfaced()

    // The budget, read and spent without asking what kind of claim this is (D-328). The refusal is
    // therefore the same on every surfaced claim, which is the half of the fix `escalationLimitReached`
    // could not provide on its own.
    const spentSoFar = await repo.countEscalations(runId, tx)
    if (spentSoFar >= ESCALATIONS_PER_RUN) escalationLimitReached()

    const authored = row.claim.escalationReply?.trim() ?? ''
    const counts = authored.length > 0

    const responseText = counts
      ? authored
      : ((await repo.findGeneralEscalationReply(tenantId, run.packageVersionId, tx)) ?? '')

    const at = new Date()
    const inTurnWindow = isInTurnWindow(run)
    const charged = chargeCost(run, ESCALATION_COST_MS, at)
    await repo.applyClockCharge(tenantId, runId, clockCharge(charged.patch), tx)

    const escalation = await repo.insertEscalation(
      runId,
      {
        claimId,
        statement,
        responseId: counts ? 'claim' : 'general',
        responseText,
        clockCostMs: charged.appliedMs,
        countsAgainstLimit: counts,
        inTurnWindow,
      },
      tx,
    )

    await append(
      tx,
      run,
      'escalation',
      {
        escalation_id: escalation.id,
        claim_id: claimId,
        statement,
        response_id: counts ? 'claim' : 'general',
        response_text: responseText,
        clock_cost_ms: charged.appliedMs,
        counts_against_limit: counts,
        in_turn_window: inTurnWindow,
      },
      { actorId: actor.id, occurredAt: at },
    )

    if (row.runClaim.stance !== 'escalate') {
      await applyStance(tx, run, row.runClaim, 'escalate', at, actor.id)
    }

    // This one included, and with no `counts` term: D-328's whole point is that the number the
    // student reads moves the same amount whatever claim they spent it on.
    const remaining = Math.max(0, ESCALATIONS_PER_RUN - spentSoFar - 1)
    return toEscalationResult(escalation, remaining)
  })
}

// ---------------------------------------------------------------------------------------------
// Reliance from the brief, and the Decision Lock's gate (FR-084, FR-101, D-076)
// ---------------------------------------------------------------------------------------------

/** One named-field match: which claim, which field, and whether this call was the first. */
export type NamedFieldMark = { claimId: string; fieldKey: string; recorded: boolean }

/**
 * Marks every claim whose figure the student named in a brief field as relied on (FR-101, D-076).
 *
 * Typing a claim's number into a named numeric field is the student saying they leaned on it
 * without saying so in a stance, so it joins the log mark and the Turn window as a third route into
 * `relied_on_via` — and the Decision Lock then asks them for a stance on it (FR-084). The
 * arithmetic is `matching.ts`, which is D-076's unit normalization and tolerance and nothing else.
 *
 * **Only surfaced claims.** `markClaimUsed` writes nothing for a claim with no `run_claims` row, and
 * that is the rule rather than an omission: a claim the student was never shown is not one they can
 * have relied on, and a lock gate that refused over one would be asking for a stance on a sentence
 * nobody read. A figure that matches no claim at all is not lost either — FR-025 makes it an
 * assumption, and the defense asks where it came from.
 *
 * Deterministic in both loops: the fields in authored order, the claims in surfacing order, so a
 * brief with two fields matching the same claim always records the same field first.
 */
export async function markReliedOnFromNamedFields(
  tx: repo.Tx,
  run: SurfacingRun,
  namedValues: Readonly<Record<string, number>>,
  options: { actorId?: string | null; at?: Date } = {},
): Promise<NamedFieldMark[]> {
  const entered = new Map(
    Object.entries(namedValues).filter(
      ([, value]) => typeof value === 'number' && Number.isFinite(value),
    ),
  )
  if (entered.size === 0) return []

  const [fields, claims] = await Promise.all([
    repo.listVersionNamedFields(run.packageVersionId, tx),
    repo.listRunClaims(run.id, {}, tx),
  ])

  const at = options.at ?? new Date()
  const marks: NamedFieldMark[] = []
  for (const field of fields) {
    const value = entered.get(field.key)
    if (value === undefined) continue
    for (const { claim } of claims) {
      const carried = claim.carriedValues as readonly CarriedValue[]
      if (!namedValueMatchesClaim(field.key, value, field.unit as ValueUnitValue, carried)) continue
      const { recorded } = await markClaimUsed(tx, run, claim.id, 'named_field', {
        fieldKey: field.key,
        actorId: options.actorId ?? null,
        at,
      })
      marks.push({ claimId: claim.id, fieldKey: field.key, recorded })
    }
  }
  return marks
}

/** A relied-on claim with no stance: what the lock gate refuses over, in the words it names it by. */
export type UnstancedReliedOnClaim = {
  claimId: string
  claimKey: string
  claimText: string
  surfacedAt: Date
}

/**
 * The claims this run relied on and took no position on, oldest first (FR-084).
 *
 * The Decision Lock is refused over the *first* of these and names it, so the order is the rule and
 * not a convenience: `surfaced_at` is when the student met the claim, and the one they met first is
 * the one they have had longest to take a position on. Ties — several claims surfaced by one
 * delegation — break on the authored position, so the same run always names the same claim (D-274).
 *
 * A claim surfaced but never relied on is absent, and that is FR-084's whole shape: reading a claim
 * costs nothing and commits to nothing, and only leaning on one — a log mark, a named figure, the
 * Turn window — turns it into a question the student has to answer before locking.
 */
export async function findUnstancedReliedOn(
  tx: repo.DbOrTx,
  run: { id: string },
): Promise<UnstancedReliedOnClaim[]> {
  const rows = await repo.listRunClaims(run.id, { reliedOn: true, unstanced: true }, tx)
  return rows
    .map(({ runClaim, claim }) => ({
      claim,
      order: { surfacedAt: runClaim.surfacedAt, position: claim.position, key: claim.key },
    }))
    .sort((a, b) => bySurfacing(a.order, b.order))
    .map(({ claim, order }) => ({
      claimId: claim.id,
      claimKey: claim.key,
      claimText: claim.text,
      surfacedAt: order.surfacedAt,
    }))
}

/**
 * The claims the Turn window put in front of the student and they have taken no position on, oldest
 * first (FR-111).
 *
 * FR-084's gate one state later, over the set FR-111 names: *"any new claim surfaced in the window
 * requires a stance"*. `run_claims.in_turn_window` is exactly that fact — the column is written at
 * the surfacing from the run's own clock (`runs/clock.ts`'s `isInTurnWindow`) and is never
 * rewritten — so the set is the same one `ClaimView.inTurnWindow` marks on the cards the student is
 * looking at, and the gate and the screen cannot disagree about which claims it means.
 *
 * A claim the student met *before* the window is deliberately not in it, whether or not the Turn
 * also lands on it. It was there to take a position on for the whole working period, FR-084's gate
 * read it at the Decision Lock, and an auto-lock is allowed to record it unstanced (FR-105) — so
 * refusing the Turn response over it would hold the student to a gate their run has already passed.
 *
 * It is here rather than in `runs` for the reason `findUnstancedReliedOn` is: `run_claims` is this
 * module's table, and a second reader of it in another module would be a second definition of the
 * rule (D-292).
 */
export async function findUnstancedWindowClaims(
  tx: repo.DbOrTx,
  run: { id: string },
): Promise<UnstancedReliedOnClaim[]> {
  const rows = await repo.listRunClaims(run.id, { inTurnWindow: true, unstanced: true }, tx)
  return rows
    .map(({ runClaim, claim }) => ({
      claim,
      order: { surfacedAt: runClaim.surfacedAt, position: claim.position, key: claim.key },
    }))
    .sort((a, b) => bySurfacing(a.order, b.order))
    .map(({ claim, order }) => ({
      claimId: claim.id,
      claimKey: claim.key,
      claimText: claim.text,
      surfacedAt: order.surfacedAt,
    }))
}

/**
 * Every claim this run has relied on by any route, in the same order (FR-084, FR-101, D-077).
 *
 * The Decision Lock's own record: `decision_locked.relied_on_claim_ids` is the whole set, and
 * `unstanced_relied_on_claim_ids` is the part of it the gate would have refused over — which at an
 * explicit lock is empty by construction and at an auto-lock is whatever the clock caught (10 §8).
 * It is here rather than in `runs` for the reason every other query of `run_claims` is: reliance is
 * this module's column, and a second reader of `relied_on_via` in another module would be a second
 * definition of what "relied on" means (D-292).
 */
export async function findReliedOn(
  tx: repo.DbOrTx,
  run: { id: string },
): Promise<UnstancedReliedOnClaim[]> {
  const rows = await repo.listRunClaims(run.id, { reliedOn: true }, tx)
  return rows
    .map(({ runClaim, claim }) => ({
      claim,
      order: { surfacedAt: runClaim.surfacedAt, position: claim.position, key: claim.key },
    }))
    .sort((a, b) => bySurfacing(a.order, b.order))
    .map(({ claim, order }) => ({
      claimId: claim.id,
      claimKey: claim.key,
      claimText: claim.text,
      surfacedAt: order.surfacedAt,
    }))
}
