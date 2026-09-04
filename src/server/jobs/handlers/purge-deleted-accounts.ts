// purge_deleted_accounts handler: docs/tech/10-backend-spec.md §7 (`identity.purgeDeletedAccounts`,
// daily singleton key) and D-093. Removes every account soft-deleted more than 30 days ago; the
// service isolates one unpurgeable account so the whole day's job does not fail with it.
import { registerHandler, type JobHandler } from '@/server/jobs/handlers'
// The registry (10 §7) names `identity.purgeDeletedAccounts` as this queue's handler; the boundaries
// policy lets a job handler reach a module through its public index.ts (D-173).
import { purgeDeletedAccounts } from '@/server/modules/identity'

export const purgeDeletedAccountsHandler: JobHandler<'purge_deleted_accounts'> = async (
  _payload,
  ctx,
) => {
  const { purged } = await purgeDeletedAccounts()
  ctx.logger.info({ event: 'purge_deleted_accounts', purged }, 'purged deleted accounts')
}

registerHandler('purge_deleted_accounts', purgeDeletedAccountsHandler)
