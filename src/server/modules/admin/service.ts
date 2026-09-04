// Service of the `admin` module (docs/tech/10-backend-spec-modules.md §16). Phase 3 needs one
// function of it: `audit()`, the helper every module writes its audit row through (SYS-011). The
// platform screens it belongs to — user list, platform roles, flags, audit log — arrive in Phase 13.
//
// `audit()` takes the transaction rather than opening one: 08 §5 requires the audit row and the
// change it records to commit together, so the caller's `withTransaction` is the boundary.
import { getRequestContext } from '@/server/http/request-context'
import { insertAuditLog } from './repository'
import type { AuditAction, AuditLog, AuditLogMetadata, DbOrTx } from './repository'

export type { AuditAction, AuditLog, AuditLogMetadata } from './repository'

/** The request id stamped on rows written outside a request or a job (scripts, seeds). */
const NO_REQUEST_ID = 'system'

export type AuditInput = {
  /** The signed-in actor, or null for a system action (a job, the seed, a purge). */
  actorId: string | null
  /** The institution the action belongs to, or null for a platform action. */
  orgId: string | null
  action: AuditAction
  /** The table or concept the id names, e.g. `data_agreement`, `invitation`, `run`. */
  targetType: string
  targetId: string
  /** Action-specific details. Never secrets, run free text, or anything the log redacts. */
  metadata?: AuditLogMetadata
}

/**
 * Appends one audit row inside the caller's transaction, stamped with the current request id
 * (10 §2: jobs carry `job:<jobId>`, so an audited job action is traceable to its run).
 */
export async function audit(tx: DbOrTx, input: AuditInput): Promise<AuditLog> {
  return insertAuditLog(
    {
      organizationId: input.orgId,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata ?? {},
      requestId: getRequestContext()?.requestId ?? NO_REQUEST_ID,
    },
    tx,
  )
}
