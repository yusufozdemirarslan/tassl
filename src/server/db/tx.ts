// Transaction boundary (docs/tech/10-backend-spec.md §6). Each writing service function runs in one
// withTransaction(); repositories accept a DbOrTx. Jobs enqueued through enqueueAfterCommit() run
// their callbacks only after the transaction committed (src/server/jobs/after-commit.ts).
import { db } from '@/server/db/client'
import { discardAfterCommit, runAfterCommit, trackTransaction } from '@/server/jobs/after-commit'

export type Db = typeof db
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbOrTx = Db | Tx

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let current: Tx | undefined
  try {
    const result = await db.transaction(async (tx) => {
      current = tx
      trackTransaction(tx)
      return fn(tx)
    })
    if (current) await runAfterCommit(current)
    return result
  } catch (error) {
    if (current) discardAfterCommit(current)
    throw error
  }
}
