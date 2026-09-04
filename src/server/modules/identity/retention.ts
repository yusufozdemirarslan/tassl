// Retention window of a deleted account (D-093, NFR-009, docs/tech/08-auth-authz.md §2.9).
//
// `DELETE /api/v1/me` only sets `user.deleted_at`; the daily `purge_deleted_accounts` job removes
// the person this many days later, after which nothing personal is left and the run trace stays
// attached to the organization's `deleted-user@<slug>.tassl.local` placeholder so instructor-held
// course records are unaffected (PRD §7.16).

export const PURGE_AFTER_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** Accounts whose `deleted_at` is strictly before this instant are purged on this run. */
export function purgeCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - PURGE_AFTER_DAYS * DAY_MS)
}
