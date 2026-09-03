// After-commit hooks: docs/tech/10-backend-spec.md §6. `enqueueAfterCommit(tx, …)` registers a
// callback on the transaction object; `withTransaction` (Step 2.8) calls trackTransaction() when it
// opens the transaction, runAfterCommit() once the commit has returned, and discardAfterCommit() on
// rollback. Hook failures are logged and never thrown: the daily sweep re-enqueues from state.
import { getLogger } from '@/server/http/request-context'

export type AfterCommitCallback = () => void | Promise<void>

const pending = new WeakMap<object, AfterCommitCallback[]>()

/** Marks a transaction object so onCommit() can queue callbacks for it. Idempotent. */
export function trackTransaction(tx: object): void {
  if (!pending.has(tx)) pending.set(tx, [])
}

export const isTracked = (tx: object): boolean => pending.has(tx)

/** Queues a callback for a tracked transaction; returns false (and queues nothing) when untracked. */
export function onCommit(tx: object, callback: AfterCommitCallback): boolean {
  const callbacks = pending.get(tx)
  if (!callbacks) return false
  callbacks.push(callback)
  return true
}

/** Runs the queued callbacks in order after a successful commit, then forgets the transaction. */
export async function runAfterCommit(tx: object): Promise<void> {
  const callbacks = pending.get(tx)
  pending.delete(tx)
  if (!callbacks) return
  for (const callback of callbacks) {
    try {
      await callback()
    } catch (error) {
      getLogger().error({ event: 'after_commit_failed', err: error }, 'after-commit hook failed')
    }
  }
}

/** Drops the queued callbacks after a rollback. */
export function discardAfterCommit(tx: object): void {
  pending.delete(tx)
}
