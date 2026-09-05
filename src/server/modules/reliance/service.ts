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
// Stances, interrogation actions and escalations are Phase 8. They are absent rather than stubbed:
// nothing here returns an empty list standing in for a rule that has not been written.
//
// Two imports need a word.
//
//   * `runs/clock.ts` — `in_turn_window` is a fact about the run's clock (D-042, D-132), and the
//     module that owns the clock is `runs`. Importing that one pure file is the same reading, and
//     the same resolution, as the trace module's import of it (10 §10): copying `isInTurnWindow`
//     here would make one rule two, and going through the runs module's public index would make
//     these two modules a cycle, because the runs service calls this one when a document is opened.
//   * `trace` — surfacing inside the Turn window writes a `claim_used` event (D-077), and every run
//     mutation appends its event in the transaction that made it (CLAUDE.md). The same module owns
//     the other rule this file needs: what a run's own student may read of their room in a given
//     state, which the claim table asks rather than restates (`requireOwnerReadAccess`, D-279).
import { requireRunOwner } from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
import { isInTurnWindow, type ClockRun } from '@/server/modules/runs/clock'
import { append, requireOwnerReadAccess, type TraceRun } from '@/server/modules/trace'
import * as repo from './repository'
import type { ClaimView, SurfacedByValue } from './schema'

/**
 * The run columns surfacing reads: what the trace needs to append (the tenant, the run, the
 * allocator), the clock's, and the version whose claims are being surfaced. A Drizzle `Run` row
 * satisfies it, which is what the caller holds from `findRunForUpdate`.
 */
export type SurfacingRun = TraceRun & ClockRun & { packageVersionId: string }

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
 * One surfaced claim as its own student reads it, built by picking from two rows (12 §8).
 *
 * The single place a `ClaimView` is constructed. `scenario_claims` carries the trigger phrases, the
 * carried values, the escalation reply and the author's rationale, and `variant_claim_states` next
 * to it carries the warranted stance and the planted flag; none of it is in the shape below. Having
 * one constructor rather than one per read is what makes that a fact about the codebase rather than
 * a property each caller has to keep.
 */
const toClaimView = (runClaim: repo.RunClaim, claim: repo.ScenarioClaim): ClaimView => ({
  id: claim.id,
  key: claim.key,
  text: claim.text,
  surfacedBy: runClaim.surfacedBy,
  surfacedAt: runClaim.surfacedAt.toISOString(),
  inTurnWindow: runClaim.inTurnWindow,
  stance: runClaim.stance,
  previousStance: runClaim.previousStance,
  stanceSetAt: runClaim.stanceSetAt?.toISOString() ?? null,
  usedMarked: runClaim.usedMarked,
  reliedOn: runClaim.reliedOn,
})

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
    surfaced.push({ ...toClaimView(current, claim), inserted })
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

  const rows = await repo.listRunClaims(runId)
  return rows.map(({ runClaim, claim }) => toClaimView(runClaim, claim))
}
