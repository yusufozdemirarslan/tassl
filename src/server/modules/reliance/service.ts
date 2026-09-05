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
//     mutation appends its event in the transaction that made it (CLAUDE.md).
import { requireRunOwner } from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
import { isInTurnWindow, type ClockRun } from '@/server/modules/runs/clock'
import { append, type TraceRun } from '@/server/modules/trace'
import * as repo from './repository'
import type { ClaimView, SurfacedByValue } from './schema'

/**
 * The run columns surfacing reads: what the trace needs to append (the tenant, the run, the
 * allocator), the clock's, and the version whose claims are being surfaced. A Drizzle `Run` row
 * satisfies it, which is what the caller holds from `findRunForUpdate`.
 */
export type SurfacingRun = TraceRun & ClockRun & { packageVersionId: string }

/** What a surfacing answers: the claims it wrote a row for, and the ones already in the room. */
export type SurfacedClaim = { claimId: string; key: string; text: string; inserted: boolean }

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
    const { inserted } = await repo.upsertRunClaim(
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
    if (inWindow) {
      await repo.updateReliedOn(run.id, claim.id, { via: 'turn_window' }, tx)
      await append(
        tx,
        run,
        'claim_used',
        { claim_id: claim.id, via: 'turn_window' },
        { occurredAt: at },
      )
    }
    surfaced.push({ claimId: claim.id, key: claim.key, text: claim.text, inserted })
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
 */
export async function listRunClaims(actor: SessionUser, runId: string): Promise<ClaimView[]> {
  // The only refusal this read can make, and it is not this module's: a run the actor does not own
  // answers NOT_FOUND rather than FORBIDDEN, because 08 §4 gives a student no read of another
  // student's run at all — saying the id resolves is already more than they may know. There is no
  // `errors.ts` in this module yet for the same reason: 10 §8's six codes belong to the stances and
  // the interrogation actions, and each will land with the rule that raises it (Phase 8).
  await requireRunOwner(actor, runId)

  const rows = await repo.listRunClaims(runId)
  return rows.map(({ runClaim, claim }) => ({
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
  }))
}
