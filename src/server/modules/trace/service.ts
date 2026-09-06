// Service of the `trace` module (docs/tech/10-backend-spec-modules.md §10; 10-backend-spec.md §6;
// 07-api-spec.md §7; 08-auth-authz.md §4, §5). The append-only event log: FR-007, FR-241, NFR-005.
//
// Two functions, and one rule each.
//
// `append` is the only writer. Every run mutation in this codebase calls it inside the transaction
// that made the change (ADR-017), holding the run row under `select … for update`. What makes the
// sequence gapless is the compare-and-set in `allocateSeq`: the allocation is conditional on the
// `next_event_seq` the caller read, so two writers cannot take the same number and neither can skip
// one, and a mutation that never held the lock is refused with `SEQUENCE_CONFLICT` instead of
// quietly writing an event with somebody else's number. The lock's job is different and just as
// necessary — it makes a contending mutation *wait* for the row and arrive with a fresh allocator,
// rather than fail the compare-and-set. Correctness from the compare-and-set, liveness from the
// lock, and a rollback takes its allocation back with it.
//
// `listEvents` is the reader, for the run's owner and its section's reviewers. A reviewer receives
// the events as written — the trace is the record. An owner receives a projection built entirely by
// `owner-view.ts`: what they may read depends on the run's state, their payloads are picked field
// by field from a table the compiler forces to be complete, and their sequence is renumbered.
import { isAppError } from '@/lib/errors'
import { requireRunOwner, requireRunReviewer } from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
// The clock is a pure function of the run row (D-042), and every event stores the reading it was
// written at. It is imported from the `runs` module's own file rather than through that module's
// index because `runs.service` writes trace events: going through the index would make the two
// modules a cycle, and copying eleven lines of arithmetic here would make D-042 two things.
import { isInTurnWindow, remainingMs, remainingWindowMs } from '@/server/modules/runs/clock'
import { exportInvalid, payloadInvalid, runNotFound, sequenceConflict, traceSealed } from './errors'
import { buildTraceExport } from './export'
import { traceExportSchema, type TraceExport, type TraceExportForm } from './export-schema'
import { ownerAccessFor, ownerPayload, type OwnerAccess } from './owner-view'
import {
  allocateSeq,
  findExportRun,
  findExportScore,
  findRunState,
  insertEvent,
  listEventsForRun,
  listExportActionsByClaim,
  listExportClaims,
  listExportConfirmations,
  listExportReadiness,
  type DbOrTx,
  type RunEvent,
  type TraceClock,
  type TraceRun,
  type Tx,
} from './repository'
import {
  EVENT_PAYLOAD_SCHEMAS,
  type EventPayload,
  type RunEventTypeValue,
  type TraceEventView,
} from './schema'

export type { TraceClock, TraceRun } from './repository'

// The export document's schemas, forwarded so `index.ts` has one door into this module (see the
// note there and in `runs/index.ts`).
export {
  CourseTraceExportSchema,
  RecordTraceExportSchema,
  TRACE_EXPORT_VERSION,
  TraceExportSchema,
  X_TASSL_EXTENSIONS,
  traceExportSchema,
} from './export-schema'

export type {
  CourseTraceExport,
  RecordTraceExport,
  TraceExport,
  TraceExportClaimRow,
  TraceExportForm,
} from './export-schema'

/** What a writer may say about an event beyond its payload (10 §10). */
export type AppendOptions = {
  /** The seat that caused it; absent for a system event such as a timer materialization. */
  actorId?: string | null
  /**
   * The instant it happened, when that is not now: a timer writes the expiry instant it computed,
   * so the event is stamped exactly regardless of when the read that materialized it arrived
   * (NFR-002). Defaults to `now`.
   */
  occurredAt?: Date
}

// ---------------------------------------------------------------------------------------------
// Appending (FR-007, NFR-005)
// ---------------------------------------------------------------------------------------------

/**
 * The clock reading an event written at `at` carries. Inside the Turn window it is the window's
 * remaining time, not the working clock's (10 §10, D-132); outside the working period and the
 * window it is null. Both clock functions already answer null when they do not apply, so this is
 * only the choice of which one to ask.
 *
 * The argument is the clock the *transaction* returned, never a row the caller read earlier. That
 * is the whole guard: `clock_remaining_ms` is what Phase 10's clock timeline is drawn from, and a
 * mutation that charges an action's cost and then appends must stamp the charged reading, not the
 * one it happened to be holding.
 */
function clockReadingFor(clock: TraceClock, at: Date): number | null {
  const reading = isInTurnWindow(clock) ? remainingWindowMs(clock, at) : remainingMs(clock, at)
  return reading === null ? null : boundedReading(reading)
}

/**
 * How far past its zero a clock is allowed to be recorded as, and why there is a bound at all.
 *
 * `run_events.clock_remaining_ms` is an `integer`, and a run whose clock has run out keeps ticking
 * down until something moves it on — which in this build is the auto-lock applier Phase 9 brings.
 * Left unbounded, a run abandoned in `working` passes int4 twenty-five days later and then *every*
 * append fails on a Postgres 22003 the screen has no code to act on: the run cannot be locked,
 * cannot be closed, cannot be voided. The same shape D-249 found in a document open, in the column
 * beside it.
 *
 * A day is the bound for the same reason it is there: a clock more than a day past zero is not a
 * long sitting, it is an absence, and the event's own `occurred_at` still says how long. Overrun
 * inside a day — every real one — is recorded exactly (D-253).
 */
const CLOCK_OVERRUN_FLOOR_MS = -86_400_000

const boundedReading = (ms: number): number => Math.max(CLOCK_OVERRUN_FLOOR_MS, ms)

/**
 * Appends one event to the run's trace and returns the row.
 *
 * `tx` must be the transaction that made the change the event records, and `run` must be the row
 * that transaction locked with `runs.repository.findRunForUpdate`. `run.nextEventSeq` is the
 * allocator: this function takes it, moves the column on, and moves the caller's copy on with it,
 * so a mutation that writes several events in one transaction simply calls `append` again with the
 * same object.
 *
 * The allocator is the *only* thing taken from the caller's copy of the row, and the only thing
 * kept in step with it. Everything else the event records about the run — the clock, and the state
 * the clock is read against — comes back from `allocateSeq`, which is an `update … returning` and
 * therefore answers the row as this transaction has it, after every write the mutation has already
 * made. `TraceRun` no longer carries those columns at all, so "stamped from a stale clock" is not a
 * mistake a caller can make.
 *
 * The payload is parsed against its type's schema first. A payload that does not match is a defect
 * in the caller, not a request the reader can fix, so it is refused before the insert rather than
 * stored for Phase 10 to trip over.
 */
export async function append<T extends RunEventTypeValue>(
  tx: Tx,
  run: TraceRun,
  type: T,
  payload: EventPayload<T>,
  opts: AppendOptions = {},
): Promise<RunEvent> {
  const parsed = EVENT_PAYLOAD_SCHEMAS[type].safeParse(payload)
  if (!parsed.success) payloadInvalid(type, parsed.error.issues)

  const occurredAt = opts.occurredAt ?? new Date()
  const allocated = await allocateSeq(run.organizationId, run.id, run.nextEventSeq, tx)
  if (allocated === undefined) sequenceConflict(run.id, run.nextEventSeq)
  run.nextEventSeq = allocated.seq + 1

  return insertEvent(
    run.id,
    {
      seq: allocated.seq,
      type,
      occurredAt,
      clockRemainingMs: clockReadingFor(allocated.clock, occurredAt),
      actorId: opts.actorId ?? null,
      // The parsed value is the payload as `run_events.payload` stores it: the column's type is the
      // open jsonb shape, and the narrow one belongs to the reader that knows the event's type.
      payload: parsed.data as Record<string, unknown>,
    },
    tx,
  )
}

// ---------------------------------------------------------------------------------------------
// Reading (FR-007)
//
// 10 §10 used to say the owner's view "omits nothing". It cannot mean that, and the spec line is
// corrected with this step. A reviewer's view omits nothing — that is the record. An owner is a
// student sitting the exercise, and their view is governed by three separate rules, none of which
// an event type gets to opt out of:
//
//   1. **Whether they may read at all**, from the run's state (`owner-view.ts`,
//      `TRACE_OWNER_ACCESS`). Through the defense the trace is sealed, because the defense is what
//      a student can say with nothing in front of them but their own frame, brief, addendum and
//      Turn response (UI-026). The trace holds every delegation with its request and response text,
//      every action result, every document open and every stance: served in a second tab it is the
//      room the screen has just taken away.
//   2. **Which fields**, from `OWNER_FIELD_VISIBILITY` — a pick, not a deletion (12 §8), over a
//      table the compiler will not let anyone leave incomplete, with `after_scored` as the tier
//      that carries D-117's "never before the run is scored".
//   3. **Which sequence number**, here. See `denseSeq` below.
// ---------------------------------------------------------------------------------------------

/**
 * Event types an owner does not see at all. The Sycophancy Probe only works while the student
 * cannot tell a scripted reversal from a real one (FR-053, D-088), and the debrief is where the
 * probe transcript is shown to them, after the run is scored (10 §13) — through the debrief's own
 * projection, not through this endpoint, which is why the type stays hidden in every state.
 */
const OWNER_HIDDEN_TYPES: ReadonlySet<RunEventTypeValue> = new Set(['probe_fired'])

function toView(event: RunEvent, seq: number, payload: Record<string, unknown>): TraceEventView {
  return {
    seq,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    clockRemainingMs: event.clockRemainingMs,
    actorId: event.actorId,
    payload,
  }
}

/** Which of the two readers the actor is; a run neither owns nor reviews answered NOT_FOUND. */
async function requireOwnerOrReviewer(
  actor: SessionUser,
  runId: string,
): Promise<{ viewer: 'owner' | 'reviewer'; organizationId: string }> {
  try {
    const scope = await requireRunOwner(actor, runId)
    return { viewer: 'owner', organizationId: scope.organizationId }
  } catch (error) {
    // `requireRunOwner` answers NOT_FOUND both for a run that does not exist and for one belonging
    // to another student (08 §4), so a reviewer arrives here too and is asked for their role next.
    if (!isAppError(error) || error.code !== 'NOT_FOUND') throw error
  }
  try {
    const scope = await requireRunReviewer(actor, runId)
    return { viewer: 'reviewer', organizationId: scope.organizationId }
  } catch (error) {
    // The reviewer guard answers FORBIDDEN to a section member holding the wrong role, which here
    // is one thing only: a classmate of the run's owner. Passing that through would confirm the run
    // exists to the one reader 08 §4 gives no read of it at all.
    if (isAppError(error) && error.code === 'FORBIDDEN') runNotFound()
    throw error
  }
}

/**
 * What the run's **owner** may read of their room right now, or the refusal when the answer is
 * nothing (`owner-view.ts`, D-233). Exported, because it is not the trace endpoint's question.
 *
 * Three endpoints hand a student their own room back: `GET /runs/{runId}/trace` (every event),
 * `GET /runs/{runId}/delegations` (every request with the reply it got and the claims it raised)
 * and `GET /runs/{runId}/claims` (the claim table with its stances). They differ in shape and in
 * nothing else that matters here — a student in the defense who is refused the first and served the
 * second has been handed back the room UI-026 takes away, and FR-120's "unaided" means nothing.
 *
 * So the three ask **one** function, over the one table in `owner-view.ts`, rather than keeping a
 * state list each. Three copies is three chances to drift, and the drift is silent: nobody adding a
 * run state or moving a boundary would think to look in the assistant module for a rule the trace
 * module owns (D-279).
 *
 * The answer is the tier, not a boolean, because a caller that has fields of its own to gate needs
 * to know whether the run is merely open or actually scored. `listEvents` uses it that way; the
 * other two do not, and say why at their own call sites.
 */
export async function requireOwnerReadAccess(
  tenantId: string,
  runId: string,
): Promise<Exclude<OwnerAccess, 'sealed'>> {
  // Decided before the room is read, not after: a student in the defense never causes their
  // delegations, claims or events to be loaded, so there is nothing in memory for a later mistake
  // to serve.
  const state = await findRunState(tenantId, runId)
  // The caller's permission check already resolved the run inside this tenant, so a miss here is
  // the run disappearing between two statements; NOT_FOUND is the same answer it would have given.
  if (state === undefined) runNotFound()
  const access = ownerAccessFor(state)
  if (access === 'sealed') traceSealed(state)
  return access
}

/**
 * One stored event as a server-side pipeline reads it: the record, not a reader's view.
 *
 * The payload is the open jsonb the column holds. Narrowing it belongs to the reader that knows
 * which type it is asking about — `EVENT_PAYLOAD_SCHEMAS` is exported for exactly that — and a
 * pipeline that walks every event of a run reads a handful of fields from a handful of types.
 */
export type TraceRecordEvent = {
  seq: number
  type: RunEventTypeValue
  occurredAt: Date
  payload: Record<string, unknown>
}

/**
 * The run's trace as written, for a pipeline **inside the server** — not for a reader.
 *
 * The third function other modules take from this one, and the same shape of seam as `append`: it
 * is reached with a run id the caller's permission helper has already resolved, and it applies no
 * view rule of its own. `listEvents` above is the reader's function and is where `owner-view.ts`
 * lives; this is the record, and every field of it, including the `reviewer_only` ones.
 *
 * Two pipelines need it and neither is a reader. The defense's question selection is a pure
 * function of the run's own events (10 §9), which is what gives each rendered question the
 * `selecting_event_seq` the replay reads it back by; Phase 10's scoring reads the same list to
 * build the graphs. Both turn events into something else and hand *that* to a student — so the
 * events never leave the server, and the projections they produce are guarded where they are built.
 */
export async function readEvents(runId: string, dbx?: DbOrTx): Promise<TraceRecordEvent[]> {
  const events = await listEventsForRun(runId, dbx)
  return events.map((event) => ({
    seq: event.seq,
    type: event.type,
    occurredAt: event.occurredAt,
    payload: event.payload,
  }))
}

/**
 * The run's trace in sequence order, for its owner or a reviewer of its section (FR-007).
 *
 * The owner's `seq` is **renumbered densely**, 1..N over the events they can see, and is not the
 * `run_events.seq` the row was written with. It has to be. `probe_fired` is dropped from their
 * view, so passing the stored number through leaves a hole — a trace that reads 1, 2, 3, 5, 6 — and
 * the missing 4 sits exactly where the Sycophancy Probe fired, which is immediately after the
 * delegation whose reversal was scripted. FR-053 and D-088 hold only while a student cannot tell a
 * scripted reversal from a real one, and a hole in their own trace tells them. `owner-view.ts`
 * withholds the payload fields that carry stored sequences for the same reason
 * (`defense_question.selecting_event_seq`, `draft_band.evidence_event_seqs`, `draft_band.quotes`).
 * The reviewer keeps the real sequence, because the reviewer's view is the record.
 *
 * Not paginated: 07 §7 answers this endpoint with an array, and a run's trace is bounded by the
 * run — a few hundred events at the top end — so a cursor would buy nothing and would make the
 * export and the replay reassemble what the database already returns in order.
 */
export async function listEvents(actor: SessionUser, runId: string): Promise<TraceEventView[]> {
  const { viewer, organizationId } = await requireOwnerOrReviewer(actor, runId)
  if (viewer === 'reviewer') {
    const record = await listEventsForRun(runId)
    return record.map((event) => toView(event, event.seq, event.payload))
  }

  const access = await requireOwnerReadAccess(organizationId, runId)

  const events = await listEventsForRun(runId)
  return events
    .filter((event) => !OWNER_HIDDEN_TYPES.has(event.type))
    .map((event, index) =>
      toView(event, index + 1, ownerPayload(event.type, event.payload, access)),
    )
}

// ---------------------------------------------------------------------------------------------
// The export (FR-240 to FR-243, FR-170)
// ---------------------------------------------------------------------------------------------

/**
 * The run's trace as one file, in the course or the record form (10 §10, PRD §12).
 *
 * It takes no actor, like `readEvents` above and for the same reason (D-340): it applies no view
 * rule of its own beyond the one difference between the two forms, and both callers name their
 * guard — `records.exportRecord` asks for the owner or a reviewer and refuses before `confirmed`,
 * and `records.writeCourseExport` is reached only from inside the confirmation that produces it.
 *
 * It does take the tenant the guard proved, and that is D-389's correction to D-374. A run id that
 * names no run *in that tenant* is `RUN_NOT_FOUND` here, before a single row of the run is loaded,
 * so the file cannot be assembled from a run the caller was never entitled to. The guard is still
 * the only place the permission is decided; this is the tenancy filter D-006 puts under it, and
 * without it a caller that forgot the guard would get no protection at all from the repository.
 *
 * The document is parsed against its own form's schema before it is returned. That is not
 * belt-and-braces on a shape we just built: every object in `export-schema.ts` is a `strictObject`,
 * so the parse is what makes FR-170 a property of the code rather than of the reviewer's attention
 * — a `weight`, a `mapping` or a `points` key that ever reached the record form would fail here,
 * loudly, on our side of the wire.
 *
 * `dbx` is the transaction when there is one, and it matters: `records.writeCourseExport` runs
 * inside the confirmation that produces the file, so the `band_decision` events and the confirmed
 * points it must carry are written but not yet committed. Reading them through the pool instead
 * would file an export of the run as it was a moment before the decision it records.
 */
export async function buildExport(
  tenantId: string,
  runId: string,
  form: TraceExportForm,
  dbx?: DbOrTx,
): Promise<TraceExport> {
  const run = await findExportRun(tenantId, runId, dbx)
  if (!run) runNotFound()

  const [events, confirmations, readiness, claims, actionsByClaim, score] = await Promise.all([
    // The record as written, with the clock reading every event was stamped at. `readEvents` is the
    // seam other modules take and does not carry that column; inside this module the repository is
    // where the trace is read from.
    listEventsForRun(runId, dbx),
    listExportConfirmations(run.packageVersionId, run.organizationId, dbx),
    listExportReadiness(runId, dbx),
    listExportClaims(runId, run.packageVersionId, run.variantId, dbx),
    listExportActionsByClaim(runId, dbx),
    findExportScore(runId, dbx),
  ])

  const document = buildTraceExport(
    {
      run: {
        runId: run.runId,
        packageId: run.packageId,
        packageVersion: run.packageVersion,
        variantKey: run.variantKey,
        mode: run.mode,
        isWalkthrough: run.isWalkthrough,
        workingClockSeconds: run.workingClockSeconds,
        confidenceAtFrame: run.confidenceAtFrame,
        confidenceAtLock: run.confidenceAtLock,
        confidenceAfterTurn: run.confidenceAfterTurn,
      },
      events: events.map((event) => ({
        seq: event.seq,
        type: event.type,
        occurredAt: event.occurredAt,
        clockRemainingMs: event.clockRemainingMs,
        payload: event.payload,
      })),
      confirmations,
      readiness,
      claims: claims.map((claim) => ({
        ...claim,
        actions: actionsByClaim.get(claim.claimId) ?? [],
      })),
      score: score ?? { falseChallengeRate: null, points: null, rubricVersion: null },
      exportedAt: new Date(),
    },
    form,
  )

  const parsed = traceExportSchema(form).safeParse(document)
  if (!parsed.success) exportInvalid(form, parsed.error.issues)
  return parsed.data as TraceExport
}
