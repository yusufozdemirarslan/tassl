// Module `assistant` — repository (docs/tech/10-backend-spec-modules.md §7; table run_delegations,
// 06 §3.4). A delegation row is inserted empty before the stream starts and completed or failed when
// it ends; `why` and reviewer flags are edited later. run_delegations has no organization_id; every
// function is scoped through the run id the service already resolved in the tenant.
import { and, asc, eq, sql } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import { runDelegations, type NewRunDelegation, type RunDelegation } from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

/**
 * The request as it is stored before streaming. `seq` may be supplied; when omitted it is allocated
 * as `max(seq) + 1` for the run inside the insert, which is safe because the service holds the run
 * row lock for the whole mutation (10 §6).
 */
export type DelegationInsert = Omit<
  NewRunDelegation,
  'id' | 'runId' | 'seq' | 'responseText' | 'failed' | 'createdAt' | 'updatedAt'
> & { seq?: number }

/** What the completed stream produced (FR-050 to FR-056). */
export type DelegationCompletion = Pick<
  NewRunDelegation,
  'responseText' | 'claimIds' | 'flags' | 'unverifiedNumbers'
>

/** Later edits: the why line (FR-060), reviewer flags (FR-055), and claim references. */
export type DelegationPatch = Partial<
  Pick<NewRunDelegation, 'why' | 'flags' | 'claimIds' | 'unverifiedNumbers'>
>

export async function insertDelegation(
  runId: string,
  values: DelegationInsert,
  dbx: DbOrTx = db,
): Promise<RunDelegation> {
  const { seq, ...rest } = values
  const [row] = await dbx
    .insert(runDelegations)
    .values({
      ...rest,
      runId,
      seq:
        seq ??
        sql<number>`(select coalesce(max(${runDelegations.seq}), 0) + 1 from ${runDelegations} where ${runDelegations.runId} = ${runId})`,
    })
    .returning()
  if (!row) throw new AppError('INTERNAL_ERROR', 'The insert returned no row.')
  return row
}

/** Stores the reply once the stream has ended; `undefined` when the delegation is not on the run. */
export async function completeDelegation(
  runId: string,
  delegationId: string,
  completion: DelegationCompletion,
  dbx: DbOrTx = db,
): Promise<RunDelegation | undefined> {
  const [row] = await dbx
    .update(runDelegations)
    .set(completion)
    .where(and(eq(runDelegations.runId, runId), eq(runDelegations.id, delegationId)))
    .returning()
  return row
}

/** Marks a delegation whose stream failed; the response stays empty (FR-001). */
export async function failDelegation(
  runId: string,
  delegationId: string,
  dbx: DbOrTx = db,
): Promise<RunDelegation | undefined> {
  const [row] = await dbx
    .update(runDelegations)
    .set({ failed: true })
    .where(and(eq(runDelegations.runId, runId), eq(runDelegations.id, delegationId)))
    .returning()
  return row
}

/** The Delegation Log in request order. */
export async function listDelegations(runId: string, dbx: DbOrTx = db): Promise<RunDelegation[]> {
  return dbx
    .select()
    .from(runDelegations)
    .where(eq(runDelegations.runId, runId))
    .orderBy(asc(runDelegations.seq))
}

export async function updateDelegation(
  runId: string,
  delegationId: string,
  patch: DelegationPatch,
  dbx: DbOrTx = db,
): Promise<RunDelegation | undefined> {
  const [row] = await dbx
    .update(runDelegations)
    .set(patch)
    .where(and(eq(runDelegations.runId, runId), eq(runDelegations.id, delegationId)))
    .returning()
  return row
}
