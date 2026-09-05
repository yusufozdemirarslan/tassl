// Module `trace` — repository (docs/tech/10-backend-spec-modules.md §10; table run_events, 06 §3.4).
// The trace is append-only: `insertEvent` is the only write, and it takes the `seq` the service
// allocated from the locked run row (`next_event_seq`). run_events has no organization_id; it is
// scoped through the run id the service already resolved in the tenant.
//
// Three functions here read or write `runs`, which is the `runs` module's table everywhere else,
// and each has its reason:
//
//   * `allocateSeq` moves `runs.next_event_seq`. That column is not a run fact — 06 §3.4 documents
//     it as the trace's sequence allocator and it exists for nothing else. What makes the committed
//     sequence 1..N with no hole and no repeat is the compare-and-set in that one statement plus
//     the fact that a rolled-back transaction takes its allocation back with it; the run row lock
//     every mutation already holds is what makes a contending writer *wait* instead of failing.
//     Keeping the statement here is what lets the trace own that property end to end.
//   * The same statement returns the run's clock columns, so `append` never has to trust a copy of
//     the row the caller read earlier (see `service.ts`).
//   * `findRunState` reads `runs.state`, which decides what the run's own student may read back
//     (`owner-view.ts`). It is one column and it is read, never written.
import { and, asc, eq, inArray } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import { runEvents, runs, type NewRunEvent, type Run, type RunEvent } from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

export type { DbOrTx, Tx } from '@/server/db/tx'
export { withTransaction } from '@/server/db/tx'

export type RunEventType = RunEvent['type']
export type { RunEvent }

/**
 * The run columns `append` takes from its caller: the tenant, the run, and the allocator. A `Run`
 * row satisfies it, and so does any projection carrying these three — which is what a caller inside
 * a mutation already holds from `findRunForUpdate`.
 *
 * The clock columns are deliberately *not* here. They used to be, and the event's
 * `clock_remaining_ms` was computed from whatever the caller's copy of the row happened to say: a
 * mutation that charged an action's cost and then appended stamped the event from the pre-charge
 * columns, and no type, check or test could tell. `append` now reads the clock from the row the
 * transaction itself returns (`allocateSeq`), so there is no copy left to go stale.
 */
export type TraceRun = Pick<Run, 'id' | 'organizationId' | 'nextEventSeq'>

/**
 * The run's clock, as the transaction sees it at the instant of an append (D-042, D-132). Returned
 * by `allocateSeq` and consumed by `service.clockReadingFor`; a `Run` row satisfies it too, which
 * is what lets `runs/clock.ts` read both.
 */
export type TraceClock = Pick<
  Run,
  | 'state'
  | 'workingClockSeconds'
  | 'workingStartedAt'
  | 'pausedAt'
  | 'totalPausedMs'
  | 'creditedMs'
  | 'chargedMs'
  | 'turnDeliveredAt'
  | 'turnWindowEndsAt'
  | 'turnLockedAt'
>

/** What `allocateSeq` answers: the sequence taken, and the clock it was taken at. */
export type SeqAllocation = { seq: number; clock: TraceClock }

/** One event as the service hands it over: seq, type, timestamps, actor, and the typed payload. */
export type RunEventInsert = Omit<NewRunEvent, 'id' | 'runId' | 'createdAt'>

export async function insertEvent(
  runId: string,
  event: RunEventInsert,
  dbx: DbOrTx = db,
): Promise<RunEvent> {
  const [row] = await dbx
    .insert(runEvents)
    .values({ ...event, runId })
    .returning()
  if (!row) throw new AppError('INTERNAL_ERROR', 'The insert returned no row.')
  return row
}

/**
 * Takes the next sequence for the run, moves the allocator on, and answers the run's clock — in one
 * statement.
 *
 * `expected` is `next_event_seq` as the caller read it under `select … for update`. The statement
 * is a compare-and-set, and that is what makes the committed sequence gapless: two transactions
 * cannot both take the same number, and neither can skip one, because the second's `where` no
 * longer matches. It is also what catches a caller that never held the lock — it gets `undefined`,
 * which the service turns into `SEQUENCE_CONFLICT` rather than a duplicate key from the
 * `(run_id, seq)` unique index. The lock is not what makes this correct; it is what makes it
 * *live*: under the required discipline a contending mutation blocks in `findRunForUpdate` and
 * arrives here with a fresh `expected`, so it waits rather than fails. A rollback releases the
 * allocation with everything else, so committed sequences stay 1..N.
 *
 * `returning` carries the clock columns because an `update … returning` answers the row *after* the
 * statement, which in a transaction means after every write that transaction has already made. That
 * is precisely the reading an event must be stamped with, and it is why `append` no longer takes
 * the clock from its caller: there is nothing here that a caller could hand over stale.
 */
export async function allocateSeq(
  tenantId: string,
  runId: string,
  expected: number,
  dbx: DbOrTx = db,
): Promise<SeqAllocation | undefined> {
  const [row] = await dbx
    .update(runs)
    .set({ nextEventSeq: expected + 1 })
    .where(
      and(eq(runs.organizationId, tenantId), eq(runs.id, runId), eq(runs.nextEventSeq, expected)),
    )
    .returning({
      state: runs.state,
      workingClockSeconds: runs.workingClockSeconds,
      workingStartedAt: runs.workingStartedAt,
      pausedAt: runs.pausedAt,
      totalPausedMs: runs.totalPausedMs,
      creditedMs: runs.creditedMs,
      chargedMs: runs.chargedMs,
      turnDeliveredAt: runs.turnDeliveredAt,
      turnWindowEndsAt: runs.turnWindowEndsAt,
      turnLockedAt: runs.turnLockedAt,
    })
  return row ? { seq: expected, clock: row } : undefined
}

/**
 * The run's state, or `undefined` when the run is not in the tenant.
 *
 * `listEvents` needs it because what the run's own student may read back depends on where the run
 * has got to (`owner-view.ts`): the trace is sealed through the defense and opens again once the
 * run is scored. Reading it here rather than through the `runs` module's index is the same
 * resolution as `service.ts`'s import of `runs/clock` — the runs service writes trace events, so
 * the index would make the two modules a cycle.
 */
export async function findRunState(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<Run['state'] | undefined> {
  const [row] = await dbx
    .select({ state: runs.state })
    .from(runs)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
  return row?.state
}

/** The whole trace in sequence order. */
export async function listEventsForRun(runId: string, dbx: DbOrTx = db): Promise<RunEvent[]> {
  return dbx.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(asc(runEvents.seq))
}

/** Events of one or more types, in sequence order (graph builders filter this way). */
export async function listEventsByType(
  runId: string,
  types: RunEventType | readonly RunEventType[],
  dbx: DbOrTx = db,
): Promise<RunEvent[]> {
  const wanted = Array.isArray(types) ? [...types] : [types as RunEventType]
  if (wanted.length === 0) return []
  return dbx
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), inArray(runEvents.type, wanted)))
    .orderBy(asc(runEvents.seq))
}
