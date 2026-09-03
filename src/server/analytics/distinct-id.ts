// docs/tech/17-analytics-events.md §5.2 (no `server-only`: loaded by tsx scripts and Vitest, D-143).
import { createHash } from 'node:crypto'

/** PostHog distinct id: sha256(user.id), first 16 hex characters. Never reversible to the id, stable per user. */
export function hashUserId(userId: string): string {
  return createHash('sha256').update(userId, 'utf8').digest('hex').slice(0, 16)
}
