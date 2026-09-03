// Module `trace` — repository (docs/tech/10-backend-spec-modules.md §10; table run_events, 06 §3.4).
// The trace is append-only: `insertEvent` is the only write, and it takes the `seq` the service
// allocated from the locked run row (`next_event_seq`). run_events has no organization_id; it is
// scoped through the run id the service already resolved in the tenant.
import { and, asc, eq, inArray } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import { runEvents, type NewRunEvent, type RunEvent } from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

export type RunEventType = RunEvent['type']

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
